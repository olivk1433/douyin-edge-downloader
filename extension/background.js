import {scanCurrentVideo} from './scanner.js';
import {fetchVideoInPage,readVideoJob,releasePageBlob} from './page-fetch.js';
import {refreshVideoMetadataInPage} from './refresh-media.js';
import {isDouyinPage,sameVideo,filenameFor,downloadError} from './utils.js';

const locks = new Set();
const keyFor = tabId => `task:${tabId}`;
const readTask = async tabId => (await chrome.storage.session.get(keyFor(tabId)))[keyFor(tabId)] || null;
const writeTask = async (tabId,task) => chrome.storage.session.set({[keyFor(tabId)]:task});
async function tabFor(sender) {
  if (sender.id !== chrome.runtime.id) throw Error('请求来源无效');
  let tab;
  if (sender.url?.startsWith(chrome.runtime.getURL(''))) {
    [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  } else if (sender.tab) {
    if (sender.frameId !== 0 || !isDouyinPage(sender.url)) throw Error('页面来源无效');
    tab = await chrome.tabs.get(sender.tab.id);
  } else {
    throw Error('请求来源无效');
  }
  if (!tab?.id || !isDouyinPage(tab.url)) throw Error('请先在抖音网页版打开视频');
  return tab;
}
async function scan(tabId) {
  const [frame] = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:scanCurrentVideo});
  return frame?.result || {status:'unavailable',message:'页面尚未准备好'};
}
async function release(tabId,url) {
  if (url) await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:releasePageBlob,args:[url]}).catch(()=>{});
}
async function freshPlayback(tabId,task){
  let helper;
  const restore=async()=>{if(helper?.id && (await chrome.tabs.get(helper.id).catch(()=>null))?.active)await chrome.tabs.update(tabId,{active:true}).catch(()=>{});};
  try{
    const original=await chrome.tabs.get(tabId);
    helper=await chrome.tabs.create({url:`https://www.douyin.com/video/${task.videoId}`,active:original.active});
    task={...task,helperTabId:helper.id,message:'正在独立作品页重新取得播放源，请稍候…'};await writeTask(tabId,task);
    for(let i=0;i<20;i++){
      await new Promise(resolve=>setTimeout(resolve,750));
      const fresh=await scan(helper.id).catch(()=>null);
      if(fresh?.status!=='ready' || fresh.id!==task.videoId || !fresh.playerSource)continue;
      const selected=fresh.qualities?.find(q=>q.key===task.qualityKey);if(!selected)continue;
      const original=await scan(tabId);
      if(!sameVideo({status:'ready',id:task.videoId,url:task.source,playerSource:task.playerSource},original))throw Error('视频已切换，请重新选择当前作品');
      const jobId=crypto.randomUUID();
      const [frame]=await chrome.scripting.executeScript({target:{tabId:helper.id},world:'MAIN',func:fetchVideoInPage,args:[selected.urls || [selected.url],jobId]});
      if(!frame?.result?.ok)throw Error(frame?.result?.message || '独立作品页无法开始读取');
      await restore();
      return {...task,jobId,jobTabId:helper.id,received:0,total:0,message:'已从独立作品页重新取源，正在保存…'};
    }
    throw Error('独立作品页未能取得所选画质，可能需要登录或页面验证');
  }catch(e){await restore();if(helper?.id)await chrome.tabs.remove(helper.id).catch(()=>{});throw e;}
}
async function syncTask(tabId,ownLock=false) {
  let task = await readTask(tabId);
  if (!ownLock && locks.has(tabId)) return task;
  if (task?.phase === 'preparing') {
    if(!ownLock)locks.add(tabId);
    try {
      const [frame]=await chrome.scripting.executeScript({target:{tabId:task.jobTabId || tabId},world:'MAIN',func:readVideoJob,args:[task.jobId]});
      const job=frame?.result;
      if(job?.phase==='reading') {
        const mb=n=>(n/1048576).toFixed(1);
        const progress=job.total?`${Math.min(99,Math.floor(job.received/job.total*100))}% · ${mb(job.received)} / ${mb(job.total)} MB`:`已读取 ${mb(job.received || 0)} MB`;
        task={...task,received:job.received,total:job.total,message:job.attempt>1 && !job.received?`正在尝试同作品备用地址 ${job.attempt}/${job.sourceCount}…`:`正在保存 ${task.quality} · ${progress}，请保留播放页面…`};
      } else if(job?.phase==='ready') {
        if(typeof job.url!=='string' || !job.url.startsWith(`blob:${task.pageOrigin}/`))throw Error('页面返回了无效的视频地址');
        try {
          const qualitySuffix=task.qualityKey==='current'?'':`_${task.quality}`;
          const filename=filenameFor({title:task.title,id:task.videoId}).replace(/\.mp4$/,`${qualitySuffix}.mp4`);
          const downloadId=await chrome.downloads.download({url:job.url,filename,conflictAction:'uniquify',saveAs:false});
          task={...task,phase:'saving',downloadId,blobURL:job.url,message:'视频已就绪，正在保存…'};
        }catch(e){await release(task.jobTabId || tabId,job.url);throw e;}
      } else if(job?.phase==='error' && ['HTTP_401','HTTP_403','HTTP_404','HTTP_410','PAGE_FETCH_FAILED'].includes(job.code) && !task.refreshCount && task.videoId){
        task={...task,refreshCount:1,message:'正在刷新当前作品的播放地址…'};await writeTask(tabId,task);
        const [refreshed]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:refreshVideoMetadataInPage,args:[task.videoId]});
        const fresh=await scan(tabId);
        if(!sameVideo({status:'ready',id:task.videoId,url:task.source,playerSource:task.playerSource},fresh))throw Error('视频已切换，未继续下载其他作品，请重新选择');
        const selected=fresh.qualities?.find(q=>q.key===task.qualityKey);
        if(!selected)throw Error('该清晰度已更新，请重新选择下载档位');
        const tried=new Set(job.attemptedURLs || []),newURLs=refreshed?.result?.ok?(selected.urls || [selected.url]).filter(u=>!tried.has(u)):[];
        if(newURLs.length){
          const jobId=crypto.randomUUID();
          const [started]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:fetchVideoInPage,args:[newURLs,jobId]});
          if(!started?.result?.ok)throw Error(started?.result?.message || '无法开始读取新地址');
          task={...task,jobId,received:0,total:0,message:'已更新播放地址，正在重新读取…'};
        }else task=await freshPlayback(tabId,task);
      } else if(job?.phase==='error' && ['HTTP_401','HTTP_403','HTTP_404','HTTP_410','PAGE_FETCH_FAILED'].includes(job.code) && task.refreshCount && !task.helperTabId && task.videoId){
        task=await freshPlayback(tabId,task);
      } else throw Error(`${job?.message || '播放页面已刷新或任务已失效，请重新下载'}${job?.code?`（${job.code}）`:''}`);
      await writeTask(tabId,task);
    }catch(e){if(task.helperTabId)await chrome.tabs.remove(task.helperTabId).catch(()=>{});task={...task,phase:'error',message:e.message};await writeTask(tabId,task);}
    finally{if(!ownLock)locks.delete(tabId);}
  }
  if (task?.phase !== 'saving' || !task.downloadId) return task;
  const [item] = await chrome.downloads.search({id:task.downloadId});
  if (!ownLock && locks.has(tabId)) return await readTask(tabId);
  if (!item) return task;
  if (item.state === 'interrupted' || item.state === 'complete') {
    const invalid = item.state === 'complete' && /text\/|application\/(json|xml)/i.test(item.mime || '');
    const complete = item.state === 'complete' && !invalid;
    const blobURL = task.blobURL;
    task = {...task,blobURL:'',phase:complete?'complete':'error',message:complete?'已保存到下载文件夹 / Douyin':invalid?'服务器返回的不是视频':downloadError(item.error)};
    await writeTask(tabId,task);
    await release(task.jobTabId || tabId,blobURL);
    if(task.helperTabId)await chrome.tabs.remove(task.helperTabId).catch(()=>{});
  }
  return task;
}
async function start(tab,message) {
  if (locks.has(tab.id)) throw Error('这个页面正在准备下载，请稍候');
  locks.add(tab.id);
  let ownsTask = false;
  try {
    const existing = await syncTask(tab.id,true);
    if (existing && ['preparing','saving'].includes(existing.phase)) throw Error('这个页面已有下载任务，请稍候');
    const fresh = await scan(tab.id);
    if (!sameVideo(message.expected,fresh)) throw Error('视频或播放地址已切换，请确认当前作品后重新点击');
    if (message.floating && !fresh.floatingEligible) throw Error('当前没有唯一正在播放的视频，请播放单个作品后再试');
    const selected = fresh.qualities?.find(q=>q.key===message.qualityKey);
    if (!selected) throw Error('该清晰度已变化，请重新选择');
    const task = {phase:'preparing',startedAt:Date.now(),jobId:crypto.randomUUID(),pageOrigin:new URL(fresh.page).origin,title:fresh.title,videoId:fresh.id,
      source:fresh.url,playerSource:fresh.playerSource,qualityKey:selected.key,quality:selected.label,message:`正在读取 ${selected.label}，请保留播放页面…`};
    await writeTask(tab.id,task);
    ownsTask = true;
    const [frame] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:fetchVideoInPage,args:[selected.urls || [selected.url],task.jobId]});
    const result = frame?.result;
    if (!result?.ok) throw Error(`${result?.message || '读取视频失败'}（${result?.code || 'NO_RESULT'}）`);
    await chrome.tabs.sendMessage(tab.id,{type:'SY_TASK_STARTED'}).catch(()=>{});
    return task;
  } catch (e) {
    if (ownsTask) await writeTask(tab.id,{...(await readTask(tab.id)),phase:'error',blobURL:'',message:e.message});
    throw e;
  } finally { locks.delete(tab.id); }
}
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if (!['SY_SNAPSHOT','SY_DOWNLOAD','SY_DOWNLOADS'].includes(message?.type)) return;
  (async()=>{
    const tab = await tabFor(sender);
    if (message.type==='SY_DOWNLOADS') {await chrome.tabs.create({url:'edge://downloads/'});return {ok:true};}
    if (message.type==='SY_DOWNLOAD') return {ok:true,task:await start(tab,message)};
    const [snapshot,task] = await Promise.all([scan(tab.id),syncTask(tab.id)]);
    return {ok:true,snapshot,task};
  })().then(reply,e=>reply({ok:false,message:e.message || '操作失败，请刷新页面后重试'}));
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (!delta.state && !delta.error) return;
  chrome.storage.session.get(null).then(async all=>{
    for (const [key,task] of Object.entries(all)) if (key.startsWith('task:') && task.downloadId===delta.id)
      await syncTask(Number(key.slice(5)));
  }).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId => {
  readTask(tabId).then(async task=>{
    if(task?.helperTabId){await release(task.helperTabId,task.blobURL);await chrome.tabs.remove(task.helperTabId).catch(()=>{});}
    await chrome.storage.session.remove(keyFor(tabId));
  }).catch(()=>{});
});
