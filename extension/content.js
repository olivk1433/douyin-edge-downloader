(() => {
  if (window !== top || document.getElementById('shiying-download-widget')) return;
  const host = document.createElement('div');
  host.id = 'shiying-download-widget';
  host.style.cssText = 'position:fixed!important;right:24px!important;bottom:88px!important;z-index:2147483647!important;display:none;';
  const root = host.attachShadow({mode:'closed'});
  const mascotURL=chrome.runtime.getURL('icons/puppy-perch.png');
  const iconURL=chrome.runtime.getURL('icons/128.png');
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:light;font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#714655;line-height:1.5}
    *{box-sizing:border-box}button,select{font-family:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid #d95087;outline-offset:3px}[hidden]{display:none!important}
    .panel{width:258px;padding:20px 17px 16px;border:1px solid #ffffff;border-radius:23px;background:linear-gradient(145deg,#fffafd,#fff0f5);box-shadow:0 12px 45px #61223925,0 2px 8px #84375210;position:relative;overflow:visible}
    .perch{position:absolute;width:80px;height:auto;right:15px;top:-57px;z-index:2;pointer-events:none;user-select:none}
    .close{position:absolute;right:11px;top:13px;border:0;background:none;color:#bb93a2;font-size:18px;width:25px;height:25px;border-radius:8px}.close:hover{background:#ffe6ee}
    .title{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 26px 14px 0;color:#754356}
    .actions{display:flex;gap:7px}.select{min-width:0;width:108px;border:1px solid #f1d5e0;border-radius:11px;background:#fffafd;color:#89576b;padding:9px 5px;font-size:11px;cursor:pointer}
    .quality-info{font-size:9px;color:#b18496;margin:8px 0 0;line-height:1.5}
    .save{border:0;border-radius:11px;flex:1;background:linear-gradient(120deg,#eb8db4,#d96d9d);color:white;font-size:12px;font-weight:600;box-shadow:0 4px 10px #e78dbb27;padding:10px 8px}.save:hover{filter:brightness(1.04)}button:disabled,select:disabled{opacity:.6;cursor:wait}
    .status{font-size:10px;color:#a57c8e;line-height:1.6;margin:10px 0 0;overflow-wrap:anywhere}.status.error{color:#ad3e67}.history{border:0;background:none;padding:3px 0;color:#a86482;font-size:10px;margin-top:5px;text-decoration:underline;text-underline-offset:3px}
    .mini{width:46px;height:46px;border-radius:17px;border:2px solid #fff;background:#f9cade;padding:0;box-shadow:0 5px 24px #6c27422a;overflow:hidden}.mini img{width:42px;height:42px;object-fit:contain;display:block;border-radius:14px}
    @media(max-width:600px){.panel{width:235px}}@media(prefers-reduced-motion:no-preference){.panel{animation:appear .2s ease-out}@keyframes appear{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}}
  </style><section class="panel" aria-label="视频下载"><img class="perch" src="${mascotURL}" alt="" aria-hidden="true" draggable="false"><button class="close" aria-label="收起下载卡片" title="收起">×</button>
    <p class="title"></p><div class="actions"><select class="select" aria-label="下载清晰度"></select><button class="save">↓ 下载</button></div><p class="quality-info"></p>
    <p class="status" role="status" aria-live="polite">只下载你此刻正在看的视频</p><button class="history" hidden>查看下载记录 ↗</button></section>
    <button class="mini" aria-label="展开下载卡片" title="下载当前视频" hidden><img src="${iconURL}" alt=""></button>`;
  document.documentElement.append(host);
  const $ = s => root.querySelector(s);
  let current = null, polling = false, busy = false, taskActive = false, dismissed = '', selection = 'current', lastTask = '', localError = false, alive = true;
  const identity = item => item?.id || item?.url || '';
  const text = (message,error=false) => { $('.status').textContent=message;$('.status').classList.toggle('error',error); };
  async function request(message) {
    try { const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.message || '连接失败，请刷新页面');return r; }
    catch(e){if(!chrome.runtime?.id){alive=false;host.remove();}throw e;}
  }
  function options(snapshot) {
    const entries=snapshot.qualities || [];
    const signature=JSON.stringify(entries.map(q=>[q.key,q.label,q.detail]));
    if($('.select').dataset.signature===signature){$('.select').value=selection;return;}
    $('.select').dataset.signature=signature;$('.select').replaceChildren();
    for(const q of entries){const option=document.createElement('option');option.value=q.key;option.textContent=q.label.replace('当前播放源 · ','当前 · ');option.title=q.detail;$('.select').append(option);}
    if(!entries.some(q=>q.key===selection))selection='current';
    $('.select').value=selection;
    $('.select').title=entries.length>1?'选择该作品提供的清晰度':'页面目前只提供一个可下载播放源';
  }
  async function poll() {
    if(!alive || polling || document.hidden && !busy && !taskActive)return;
    polling=true;
    try {
      const {snapshot,task}=await request({type:'SY_SNAPSHOT'});
      const active=task && ['preparing','saving'].includes(task.phase);
      taskActive=Boolean(active);
      const eligible=snapshot?.status==='ready' && snapshot.floatingEligible;
      const oldId=identity(current);current=snapshot;
      if(oldId!==identity(current)){dismissed='';localError=false;selection='current';}
      host.style.display=eligible || active?'block':'none';
      const fullscreen=document.fullscreenElement;
      if(fullscreen && fullscreen.tagName!=='VIDEO' && host.parentElement!==fullscreen)fullscreen.append(host);
      else if(!fullscreen && host.parentElement!==document.documentElement)document.documentElement.append(host);
      const mini=dismissed===identity(current) && !active;
      $('.panel').hidden=mini;$('.mini').hidden=!mini;
      if(snapshot?.status==='ready'){
        $('.title').textContent=snapshot.title;$('.title').title=snapshot.title;options(snapshot);
        $('.quality-info').textContent=snapshot.qualityCount?`已识别 ${snapshot.qualityCount} 个实际档位`:'页面暂只提供一个源，可在播放器切换画质后重试';
      }
      $('.save').disabled=busy || active || !eligible;$('.select').disabled=busy || active;
      $('.save').textContent=active?'保存中…':'↓ 下载';
      const relevant=active || task && (task.videoId?task.videoId===snapshot?.id:task.source===snapshot?.url);
      const signature=JSON.stringify(task);
      if(relevant && (!localError || signature!==lastTask))text(task.message,task.phase==='error');
      else if(!localError)text(eligible?'只下载你此刻正在看的视频':'请播放一个视频');
      lastTask=signature;$('.history').hidden=!task;
    }catch(e){if(busy)text(e.message,true);}finally{polling=false;}
  }
  $('.select').addEventListener('change',()=>{selection=$('.select').value;});
  $('.close').addEventListener('click',()=>{dismissed=identity(current);$('.panel').hidden=true;$('.mini').hidden=false;});
  $('.mini').addEventListener('click',()=>{dismissed='';$('.panel').hidden=false;$('.mini').hidden=true;});
  $('.history').addEventListener('click',()=>request({type:'SY_DOWNLOADS'}).catch(e=>text(e.message,true)));
  $('.save').addEventListener('click',async()=>{
    if(busy || current?.status!=='ready')return;
    busy=true;taskActive=true;localError=false;$('.save').disabled=true;$('.select').disabled=true;
    text('正在准备保存，请保留此播放页面…');
    try{await request({type:'SY_DOWNLOAD',expected:{status:current.status,id:current.id,url:current.url,playerSource:current.playerSource},qualityKey:selection,floating:true});}
    catch(e){taskActive=false;localError=true;text(e.message,true);}
    finally{busy=false;await poll();}
  });
  for(const event of ['playing','pause','ended','loadedmetadata','fullscreenchange','visibilitychange'])document.addEventListener(event,()=>poll(),true);
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id===chrome.runtime.id && message?.type==='SY_TASK_STARTED'){taskActive=true;poll();}
  });
  const timer=setInterval(()=>{if(alive)poll();else clearInterval(timer);},1800);
  poll();
})();
