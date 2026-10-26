// Serialized into MAIN; helpers must remain inside this function.
export function scanCurrentVideo() {
  const fail=(code,message)=>({status:'unavailable',code,message});
  const page=new URL(location.href);
  if(page.protocol!=='https:' || !['www.douyin.com','douyin.com'].includes(page.hostname))return fail('SITE','请在抖音网页版打开一个视频');
  const validId=v=>typeof v==='string' && /^\d{5,30}$/.test(v)?v:'';
  const number=v=>Number.isFinite(Number(v)) && Number(v)>0?Number(v):0;
  const flag=v=>v===true || v===1 || v==='1';
  const unique=values=>[...new Set(values.filter(Boolean))];
  const url=value=>{
    if(typeof value!=='string')return '';
    try{const u=new URL(value.startsWith('//')?`https:${value}`:value);
      return u.protocol==='https:' && !u.username && !u.password && !/\.(m3u8|mpd)(?:$|\/)/i.test(u.pathname)?u.href:'';
    }catch{return '';}
  };
  const urls=(value,depth=0)=>{
    if(depth>5 || !value)return [];
    if(typeof value==='string')return [url(value)].filter(Boolean);
    if(Array.isArray(value))return unique(value.slice(0,32).flatMap(v=>urls(v,depth+1)));
    if(typeof value==='object')return unique(['src','url','url_list','urlList'].flatMap(k=>urls(value[k],depth+1)));
    return [];
  };
  const addresses=v=>unique(['play_addr','playAddr','playApi','play_api','playAddrH264','play_addr_h264','playAddrH265','play_addr_h265'].flatMap(k=>urls(v?.[k])));
  const progressive=v=>v && !flag(v.is_dash) && !flag(v.isDash) && !flag(v.is_encrypt) && !flag(v.isEncrypt) && !/dash|m3u8|mpegurl/i.test(String(v.format || v.mime_type || ''));
  const videos=[...document.querySelectorAll('video')].map(video=>{
    const r=video.getBoundingClientRect(),s=getComputedStyle(video);
    const w=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0));
    const h=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));
    if(s.display==='none' || s.visibility!=='visible' || Number(s.opacity)===0 || r.width<120 || r.height<100 || w*h/(r.width*r.height)<.35)return null;
    for(let el=video.parentElement;el;el=el.parentElement){const style=getComputedStyle(el);if(el.hidden || style.display==='none' || style.visibility==='hidden' || Number(style.opacity)===0)return null;}
    const top=document.elementFromPoint(Math.max(r.left,0)+w/2,Math.max(r.top,0)+h/2);
    const dialog=top?.closest('[role="dialog"], [aria-modal="true"]');if(dialog && !dialog.contains(video))return null;
    return {video,score:w*h*(!video.paused && !video.ended?1.5:1)};
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  if(!videos.length)return fail('NO_VIDEO','尚未找到播放器，打开视频并播放后重试');
  const playing=videos.filter(v=>!v.video.paused && !v.video.ended && !v.video.error && (typeof v.video.readyState!=='number' || v.video.readyState>=2));
  if(playing.length!==1 && videos[1] && videos[1].score>videos[0].score*.85)return fail('AMBIGUOUS','有多个可见播放器，请打开单个作品再识别');
  const video=playing.length===1?playing[0].video:videos[0].video;
  if(video.mediaKeys)return fail('PROTECTED','当前视频使用受保护的播放方式，暂不支持下载');
  const playerSource=video.currentSrc || video.src || video.querySelector('source')?.src || '';
  const direct=url(playerSource),records=new Map(),seen=new WeakSet(),textSeen=new Set(),dataSources=new Set();
  let budget=65000,parseBudget=80,textBudget=14*1048576;
  const hash=value=>{let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return (n>>>0).toString(36);};
  function tier(v,base=false){
    if(!progressive(v))return null;
    const sources=addresses(v);if(!sources.length)return null;
    const addr=v.play_addr || v.playAddr;
    const meta=Array.isArray(addr)?addr.find(a=>a && typeof a==='object' && (a.width || a.height)):addr;
    const width=number(meta?.width || v.width),height=number(meta?.height || v.height);
    const bitrate=number(v.bit_rate || v.bitRate),resolution=Math.min(width,height);
    const codec=String(v.codec_type || v.codecType || v.videoFormat || (flag(v.is_bytevc1)?'HEVC':'')).slice(0,24);
    const ratio=typeof v.ratio==='string' && /^\d{3,4}p$/.test(v.ratio)?v.ratio:'';
    const label=resolution?`${resolution}p`:ratio || (bitrate?`${(bitrate/1e6).toFixed(1)} Mbps`:base?'默认播放源':'可用播放源');
    const key=width && height || bitrate || ratio?`q:${width}x${height}:${bitrate}:${codec}:${ratio}`:`q:url:${hash(sources[0])}`;
    return {key,url:sources[0],urls:sources.slice(0,8),label,width,height,bitrate,codec,base,
      detail:[width && height?`${width} × ${height}`:'',bitrate?`${(bitrate/1e6).toFixed(1)} Mbps`:'',codec].filter(Boolean).join(' · ')};
  }
  function mergeTiers(items){
    const map=new Map();
    for(const q of items){if(!q)continue;const old=map.get(q.key);if(old){old.urls=unique([...old.urls,...q.urls]).slice(0,8);old.url=old.urls[0];}else map.set(q.key,{...q,urls:[...q.urls]});}
    return [...map.values()];
  }
  function visit(root,depth,proximity=999,priority=0,source='SSR'){
    if(typeof root==='string'){parseText(root,depth,priority,source);return;}
    if(!root || typeof root!=='object' || seen.has(root) || depth<0 || budget--<=0 || root instanceof Node)return;
    seen.add(root);
    const id=validId(root.aweme_id)||validId(root.awemeId)||validId(root.item_id)||validId(root.itemId),data=root.video;
    if(id && data && typeof data==='object'){
      const rateItems=['bit_rate','bitRate','bitRateList'].flatMap(k=>Array.isArray(data[k])?data[k]:[]).filter(progressive);
      const allTiers=progressive(data)?mergeTiers(rateItems.map(v=>tier(v))):[];
      const defaults=progressive(data)?addresses(data):[];
      const base=tier(data,true);
      if(base && (base.width && base.height || data.ratio) && !allTiers.some(q=>q.label===base.label || q.urls.some(u=>base.urls.includes(u))))allTiers.push(base);
      const record={id,title:typeof root.desc==='string'?root.desc.slice(0,300):typeof root.caption==='string'?root.caption.slice(0,300):'',
        author:typeof (root.author?.nickname || root.authorInfo?.nickname)==='string'?(root.author?.nickname || root.authorInfo?.nickname).slice(0,100):'',
        defaults,qualities:allTiers,urls:unique([...defaults,...allTiers.flatMap(q=>q.urls)]),proximity,priority};
      const old=records.get(id);
      if(!old)records.set(id,record);
      else{const preferred=priority>old.priority?record:old;const other=preferred===record?old:record;
        records.set(id,{...preferred,title:preferred.title || other.title,author:preferred.author || other.author,
          proximity:Math.min(proximity,old.proximity),defaults:unique([...preferred.defaults,...other.defaults]),
          urls:unique([...preferred.urls,...other.urls]),qualities:mergeTiers([...preferred.qualities,...other.qualities])});}
      dataSources.add(source);
    }
    for(const [k,d]of Object.entries(Object.getOwnPropertyDescriptors(root))){
      if(['return','alternate','stateNode','_owner','sibling','child'].includes(k))continue;
      if('value'in d)visit(d.value,depth-1,proximity,priority,source);
    }
  }
  function parseText(text,depth=12,priority=0,source='SSR'){
    if(depth<0 || typeof text!=='string' || text.length<30 || text.length>6*1048576 || textSeen.has(text) || textBudget<text.length || parseBudget<=0)return;
    if(!/awemeId|aweme_id|videoDetail|bitRateList|%22aweme|%22videoDetail/i.test(text))return;
    textSeen.add(text);textBudget-=text.length;
    let raw=text.trim();
    for(let decode=0;decode<3;decode++){
      try{const parsed=JSON.parse(raw);if(typeof parsed==='string' && parsed!==raw){raw=parsed;continue;}visit(parsed,depth-1,999,priority,source);return;}catch{}
      let pushed=false;
      for(const match of raw.matchAll(/\.push\s*\(\s*(?=\[)/g)){
        const a=match.index+match[0].length;let level=0,quoted=false,escaped=false;
        for(let i=a;i<raw.length;i++){const c=raw[i];
          if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
          if(c==='"'){quoted=true;continue;}if(c==='[')level++;
          if(c===']' && --level===0){try{visit(JSON.parse(raw.slice(a,i+1)),depth-1,999,priority,source);pushed=true;}catch{}break;}
        }
      }
      if(pushed)return;
      if(/%7[bB]|%22/.test(raw)){try{const decoded=decodeURIComponent(raw);if(decoded!==raw){raw=decoded;continue;}}catch{}}
      break;
    }
    // Parse balanced JSON objects inside RSC/pace chunks; never execute script text.
    const stack=[];let quoted=false,escaped=false;
    for(let i=0;i<raw.length && parseBudget>0;i++){
      const c=raw[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{')stack.push(i);
      else if(c==='}' && stack.length){const start=stack.pop();if(i-start>1200000)continue;
        const candidate=raw.slice(start,i+1);if(!/"(?:aweme_id|awemeId|itemId|item_id)"\s*:/.test(candidate))continue;
        parseBudget--;try{visit(JSON.parse(candidate),depth-1,999,priority,source);}catch{}
      }
    }
  }
  let domId='',level=0;
  for(let el=video;el && level<12;el=el.parentElement,level++){
    domId ||= validId(el.getAttribute('data-aweme-id'))||validId(el.getAttribute('data-item-id'));
    for(const key of Object.keys(el)){
      if(key.startsWith('__reactProps$'))visit(el[key],9,level,5,'播放器属性');
      if(key.startsWith('__reactFiber$')){let fiber=el[key];for(let i=0;fiber && i<12;i++,fiber=fiber.return)visit(fiber.memoizedProps,9,level+i,5,'播放器属性');}
    }
  }
  const routeId=validId(page.searchParams.get('modal_id'))||validId(page.searchParams.get('vid'))||validId(page.pathname.match(/\/video\/(\d+)/)?.[1]);
  const local=[...records.values()].filter(r=>r.proximity<999),exact=direct?local.filter(r=>r.urls.includes(direct)):[];
  const nearest=local.filter(r=>r.proximity===Math.min(...local.map(r=>r.proximity)));
  const sourceId=direct?validId(new URL(direct).searchParams.get('__vid')):'';
  const playerId=sourceId || domId || (exact.length===1?exact[0].id:'') || (nearest.length===1?nearest[0].id:'');
  let id=playerId || routeId;
  for(const key of ['_ROUTER_DATA','__INITIAL_STATE__','__NEXT_DATA__','__pace_f','__next_f']){
    const d=Object.getOwnPropertyDescriptor(window,key);if(d && 'value'in d)visit(d.value,18,999,1,'SSR');
  }
  for(const script of document.querySelectorAll('script'))parseText(script.textContent,16,1,'SSR');
  const cache=window[Symbol.for('douyin.download-media-cache.v1')];
  if(cache && typeof cache.values==='function')for(const captured of cache.values())if(captured?.item)visit(captured.item,10,999,20,'页面接口');
  if(!playerId && direct){const bound=[...records.values()].filter(r=>r.urls.includes(direct));if(bound.length===1)id=bound[0].id;}
  const record=records.get(id);
  let tiers=record?.qualities || [];
  if(direct && video.videoWidth && video.videoHeight && !tiers.some(q=>q.urls.includes(direct))){
    tiers=[...tiers,tier({play_addr:{url_list:[direct]},width:video.videoWidth,height:video.videoHeight},true)];
  }
  tiers=mergeTiers(tiers).sort((a,b)=>Math.min(b.width,b.height)-Math.min(a.width,a.height) || b.bitrate-a.bitrate);
  // One user-facing option per resolution; bitrate/codec variants stay internal.
  const groups=new Map();
  for(const q of tiers){
    const resolution=Math.min(q.width,q.height) || Number(q.label.match(/^(\d+)p$/)?.[1]) || 0;
    const key=resolution?`r:${resolution}`:'r:other';
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(q);
  }
  tiers=[...groups].map(([key,variants])=>{
    const first=variants[0],playing=variants.find(q=>q.urls.includes(direct));
    const backups=[];
    for(let i=0;i<8;i++)for(const q of variants)if(q.urls[i])backups.push(q.urls[i]);
    const sources=unique([playing?direct:'',...backups]).slice(0,8);
    return {...(playing || first),key,label:key==='r:other'?'其他可用画质':`${key.slice(2)}p`,url:sources[0],urls:sources,
      variants:variants.length,detail:`${first.width && first.height?`${first.width} × ${first.height} · `:''}自动选择该分辨率的可用播放版本`};
  });
  const currentTier=tiers.find(q=>q.urls.includes(direct)) || tiers.find(q=>q.width===video.videoWidth && q.height===video.videoHeight);
  const candidates=unique([direct,...(currentTier?.urls || []),...(record?.defaults || []),...tiers.flatMap(q=>q.urls)]).slice(0,16);
  if(!candidates.length)return fail('NO_URL',playerSource.startsWith('blob:')?'播放器使用分段播放，尚未匹配到完整视频地址。请播放几秒或刷新页面后重试':'尚未取得视频地址，请等待视频播放后重新识别');
  const selected=candidates[0],qualities=[{key:'current',url:selected,urls:candidates,label:'自动选择',detail:'优先当前播放器匹配源，失败后尝试同一作品的备用地址',kind:'auto'},...tiers.map(q=>({...q,kind:'quality'}))];
  return {status:'ready',id:id || '',url:selected,playerSource,binding:playerId?'player':'route',qualities,qualityCount:tiers.length,
    floatingEligible:playing.length===1 && video===playing[0].video && video.duration!==Infinity,playingCount:playing.length,
    title:record?.title || '当前抖音视频',author:record?.author || '',duration:Number.isFinite(video.duration)?Math.round(video.duration):0,
    method:direct?'播放器直连':record?.priority===20?'页面接口匹配':'作品 ID 匹配',dataSources:[...dataSources],page:page.href};
}
