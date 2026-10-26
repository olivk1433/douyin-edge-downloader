const $ = id => document.getElementById(id);
let current=null,busy=false,polling=false,selection='current',localError=false,lastTask='';
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.message || '操作失败，请重试');return result;}
function render(snapshot){
  const previous=current;current=snapshot;
  const ready=snapshot?.status==='ready';
  if(previous?.id!==snapshot?.id || previous?.url!==snapshot?.url){localError=false;if(previous?.id!==snapshot?.id)selection='current';}
  $('dot').classList.toggle('ready',ready);$('card-label').textContent=ready?'已识别当前视频':'等待识别';
  $('title').textContent=ready?snapshot.title:'请打开并播放一个视频';
  $('title').title=ready?snapshot.title:'';
  $('author').textContent=ready?(snapshot.author?`@${snapshot.author}`:'来自当前播放器'):(snapshot?.message || '请打开抖音网页版');
  $('meta').hidden=!ready;
  $('meta').textContent=ready?`${snapshot.duration?`${Math.floor(snapshot.duration/60)}:${String(snapshot.duration%60).padStart(2,'0')} · `:''}${snapshot.method}`:'';
  $('quality-wrap').hidden=!ready;
  const qualities=snapshot?.qualities || [];
  const signature=JSON.stringify(qualities.map(q=>[q.key,q.label,q.detail]));
  if($('quality').dataset.signature!==signature){
    $('quality').dataset.signature=signature;$('quality').replaceChildren();
    for(const q of qualities){const option=document.createElement('option');option.value=q.key;option.textContent=q.label;option.title=q.detail;$('quality').append(option);}
  }
  if(!qualities.some(q=>q.key===selection))selection='current';$('quality').value=selection;
  $('quality-note').textContent=snapshot?.qualityCount?`已识别 ${snapshot.qualityCount} 个实际档位；自动模式会尝试备用源`:'页面暂只提供一个源，可在播放器切换画质后重新识别';
  $('download').disabled=!ready || busy;
}
async function refresh(manual=false){
  if(polling)return;polling=true;
  try{
    const {snapshot,task}=await request({type:'SY_SNAPSHOT'});render(snapshot);
    const active=task && ['preparing','saving'].includes(task.phase);
    $('download').disabled=busy || active || snapshot?.status!=='ready';$('quality').disabled=busy || active;
    $('download-label').textContent=active?'正在保存…':'下载当前视频';
    const relevant=active || task && (task.videoId?task.videoId===snapshot?.id:task.source===snapshot?.url);
    const signature=JSON.stringify(task);
    if(relevant && (!localError || signature!==lastTask))status(task.message,task.phase==='error');
    else if(!localError || manual)status(snapshot?.status==='ready'?'也可以直接使用视频页面右下角的下载卡片':snapshot?.message || '请打开抖音网页版');
    lastTask=signature;
  }catch(e){
    if(!busy){render({status:'unavailable',message:e.message});status(e.message,true);}
  }finally{polling=false;}
}
$('quality').addEventListener('change',()=>{selection=$('quality').value;});
$('download').addEventListener('click',async()=>{
  if(busy || current?.status!=='ready')return;
  busy=true;localError=false;$('download').disabled=true;$('quality').disabled=true;
  status('正在读取视频，可以关闭此窗口，请保留播放页面…');
  try{await request({type:'SY_DOWNLOAD',expected:{status:current.status,id:current.id,url:current.url,playerSource:current.playerSource},qualityKey:selection,floating:false});}
  catch(e){localError=true;status(e.message,true);}
  finally{busy=false;await refresh();}
});
$('refresh').addEventListener('click',()=>refresh(true));
$('downloads').addEventListener('click',()=>chrome.tabs.create({url:'edge://downloads/'}));
refresh();setInterval(()=>refresh(),1800);
