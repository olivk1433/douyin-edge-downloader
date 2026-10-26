// Serialized into MAIN. Network requests keep the playback page's normal origin,
// credentials and referrer rules. Video bytes are streamed into OPFS, not an array.
export async function fetchVideoInPage(source, requestedJobId = '') {
  const error = (code,message) => ({ok:false,code,message});
  if (location.protocol !== 'https:' || !['www.douyin.com','douyin.com'].includes(location.hostname))
    return error('PAGE_CHANGED','播放页面已离开抖音，请重新打开视频');
  const candidates=[];
  for(const value of Array.isArray(source)?source:[source]){
    try{const u=new URL(value);if(u.protocol==='https:' && !u.username && !u.password && !candidates.includes(u.href))candidates.push(u.href);}catch{}
  }
  if(!candidates.length)return error('BAD_URL','视频地址无效');
  candidates.splice(8);
  if (!navigator.storage?.getDirectory) return error('DISK_UNAVAILABLE','当前浏览器无法创建视频暂存文件，请更新 Edge 后再试');
  const registryKey=Symbol.for('shiying.disk-jobs.v1');
  const jobs=window[registryKey] instanceof Map ? window[registryKey] : (window[registryKey]=new Map());
  const jobId=requestedJobId || crypto.randomUUID();
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(jobId))return error('BAD_JOB','下载任务标识无效');
  if(jobs.has(jobId))return error('DUPLICATE_JOB','该视频已经在读取中');
  const job={jobId,phase:'reading',received:0,total:0,updatedAt:Date.now(),url:'',directory:null,filename:'',attempt:0,sourceCount:candidates.length,attemptedURLs:[]};
  jobs.set(jobId,job);
  const run=async()=>{
    const controller=new AbortController();let timer,reader,writer,closed=false,stage='network';
    const heartbeat=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),120000);job.updatedAt=Date.now();};
    const fail=(code,message)=>{const result=error(code,message);Object.assign(job,{phase:'error',code,message,updatedAt:Date.now()});return result;};
    heartbeat();
    try {
      let response,prefix=[],lastCode='PAGE_FETCH_FAILED',lastMessage='播放页面无法读取视频，可能受跨域限制或网络影响';
      sources:for(let index=0;index<candidates.length;index++){
        const candidate=candidates[index];job.attempt=index+1;job.attemptedURLs.push(candidate);heartbeat();
        const modes=new URL(candidate).origin===location.origin?['include']:['include','same-origin'];
        for(const credentials of modes){
          let current;
          try{current=await fetch(candidate,{credentials,signal:controller.signal});}
          catch(e){if(controller.signal.aborted)throw e;lastCode='PAGE_FETCH_FAILED';lastMessage='媒体地址无法读取，可能受跨域限制或网络影响';continue;}
          if(!current.ok){
            lastCode=`HTTP_${current.status}`;lastMessage=`媒体服务器返回 HTTP ${current.status}`;
            await current.body?.cancel().catch(()=>{});
            if(current.status===429)return fail(lastCode,'服务器要求降低请求频率，请稍后重试');
            if(![401,403,404,408,410,500,502,503,504].includes(current.status))return fail(lastCode,lastMessage);
            continue;
          }
          if(current.status===206){await current.body?.cancel().catch(()=>{});lastCode='PARTIAL_MEDIA';lastMessage='服务器只返回视频片段';continue;}
          if(/text\/|application\/(json|xml|vnd\.apple\.mpegurl|dash\+xml)/i.test(current.headers.get('content-type') || '')){
            await current.body?.cancel().catch(()=>{});lastCode='NOT_VIDEO';lastMessage='媒体服务器返回的不是视频文件';continue;
          }
          if(!current.body){lastCode='EMPTY_MEDIA';lastMessage='服务器没有返回视频内容';continue;}
          const next=current.body.getReader(),head=new Uint8Array(12);let headSize=0;const first=[];
          try{
            while(headSize<12){heartbeat();const part=await next.read();if(part.done)break;first.push(part.value);const count=Math.min(12-headSize,part.value.byteLength);head.set(part.value.subarray(0,count),headSize);headSize+=count;}
            if(headSize<12 || String.fromCharCode(...head.slice(4,8))!=='ftyp'){
              await next.cancel().catch(()=>{});lastCode='NOT_MP4';lastMessage='返回内容不是 MP4 文件头';continue;
            }
          }catch(e){await next.cancel().catch(()=>{});if(controller.signal.aborted)throw e;lastCode='PAGE_FETCH_FAILED';lastMessage='媒体读取中断';continue;}
          response=current;reader=next;prefix=first;job.sourceHost=new URL(candidate).hostname;break sources;
        }
      }
      if(!response)return fail(lastCode,`${lastMessage}，已尝试 ${job.attemptedURLs.length} 个同作品地址`);
      const length=Number(response.headers.get('content-length'));
      const encoding=response.headers.get('content-encoding');
      job.total=(!encoding || encoding==='identity') && Number.isSafeInteger(length) && length>0 ? length : 0;
      stage='disk';
      if(navigator.storage.estimate && job.total){
        const estimate=await navigator.storage.estimate();
        if(Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) && job.total>estimate.quota-estimate.usage)
          return fail('STORAGE_FULL','浏览器的视频暂存空间不足，请释放磁盘空间或选择较小的清晰度');
      }
      const originRoot=await navigator.storage.getDirectory();
      job.directory=await originRoot.getDirectoryHandle('shiying-download-cache-v1',{create:true});
      // Only our own prefixed files, older than 24h, are eligible for stale cleanup.
      for await(const [name,handle] of job.directory.entries()){
        if(handle.kind==='file' && /^shiying-[a-zA-Z0-9-]+\.mp4$/.test(name)){
          try{const file=await handle.getFile();if(Date.now()-file.lastModified>86400000)await job.directory.removeEntry(name);}catch{}
        }
      }
      job.filename=`shiying-${jobId}.mp4`;
      const handle=await job.directory.getFileHandle(job.filename,{create:true});
      writer=await handle.createWritable();
      for(const value of prefix){await writer.write(value);job.received+=value.byteLength;heartbeat();}
      prefix=[];
      while(true){
        stage='network';heartbeat();const {value,done}=await reader.read();
        if(done)break;
        stage='disk';await writer.write(value);
        job.received+=value.byteLength;heartbeat();
      }
      if(job.total && job.received!==job.total)return fail('INCOMPLETE_MEDIA','视频传输不完整，请检查网络后重试');
      stage='disk';await writer.close();closed=true;writer=null;
      const file=await handle.getFile();
      job.url=URL.createObjectURL(file);job.phase='ready';job.updatedAt=Date.now();
      // A file-backed Blob keeps RAM bounded. It remains until Edge completes saving.
      setTimeout(async()=>{
        if(jobs.get(jobId)!==job)return;
        URL.revokeObjectURL(job.url);
        await job.directory.removeEntry(job.filename).catch(()=>{});jobs.delete(jobId);
      },1800000);
      return {ok:true,url:job.url,size:job.received,jobId};
    }catch(e){
      if(controller.signal.aborted)return fail('FETCH_TIMEOUT','视频连续两分钟没有收到数据，请检查网络后重试');
      if(e?.name==='QuotaExceededError')return fail('STORAGE_FULL','浏览器的视频暂存空间不足，请释放磁盘空间或选择较小的清晰度');
      return stage==='disk' ? fail('DISK_WRITE_FAILED','无法写入视频暂存文件，请检查磁盘空间与浏览器存储设置')
        : fail('PAGE_FETCH_FAILED','播放页面无法读取视频，可能受跨域限制或网络影响');
    }finally{
      clearTimeout(timer);controller.abort();
      if(reader)await reader.cancel().catch(()=>{});
      if(writer && !closed)await writer.abort().catch(()=>{});
      if(job.phase!=='ready' && job.directory && job.filename)await job.directory.removeEntry(job.filename).catch(()=>{});
      // Failed records are retained briefly for the background poller, never their files.
      if(job.phase==='error')setTimeout(()=>jobs.delete(jobId),600000);
    }
  };
  if(requestedJobId){run().catch(()=>{});return {ok:true,started:true,jobId};}
  return await run();
}

export function readVideoJob(jobId) {
  const job=window[Symbol.for('shiying.disk-jobs.v1')]?.get(jobId);
  if(!job)return {phase:'missing',message:'播放页面已刷新或任务已失效，请重新下载'};
  return {jobId:job.jobId,phase:job.phase,received:job.received,total:job.total,
    updatedAt:job.updatedAt,url:job.url,code:job.code,message:job.message,attempt:job.attempt,
    sourceCount:job.sourceCount,sourceHost:job.sourceHost,attemptedURLs:job.attemptedURLs};
}

export async function releasePageBlob(url) {
  if(typeof url!=='string' || !url.startsWith(`blob:${location.origin}/`))return;
  URL.revokeObjectURL(url);
  const jobs=window[Symbol.for('shiying.disk-jobs.v1')];
  if(!(jobs instanceof Map))return;
  for(const [id,job] of jobs)if(job.url===url){
    if(job.directory && job.filename)await job.directory.removeEntry(job.filename).catch(()=>{});
    jobs.delete(id);
  }
}
