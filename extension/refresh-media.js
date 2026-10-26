// One bounded refresh of the public video page. No private API, signing or eval.
export async function refreshVideoMetadataInPage(id) {
  if(location.protocol!=='https:' || !['www.douyin.com','douyin.com'].includes(location.hostname) || typeof id!=='string' || !/^\d{5,30}$/.test(id))return {ok:false,code:'PAGE_CHANGED'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(`${location.origin}/video/${id}`,{credentials:'include',cache:'reload',signal:controller.signal});
    if(!response.ok)return {ok:false,code:`HTTP_${response.status}`};
    const reader=response.body?.getReader();if(!reader)return {ok:false,code:'NO_DATA'};
    const chunks=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1048576)return {ok:false,code:'PAGE_TOO_LARGE'};chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    const html=await new Blob(chunks).text();
    const fields=['play_addr','playAddr','playApi','play_api','playAddrH264','playAddrH265','play_addr_h264','play_addr_h265','bit_rate','bitRate','bitRateList','width','height','duration','ratio','is_dash','isDash','is_encrypt','isEncrypt','format','mime_type','codec_type','codecType','videoFormat','is_bytevc1'];
    let item=null,score=-1,budget=35000,parseBudget=100;const seen=new Set();
    function walk(value,depth){
      if(depth<0 || budget--<=0)return;
      if(typeof value==='string'){parse(value,depth-1);return;}
      if(!value || typeof value!=='object')return;
      const candidateId=value.aweme_id || value.awemeId || value.item_id || value.itemId;
      if(candidateId===id && value.video && typeof value.video==='object'){
        const video={};for(const field of fields)if(value.video[field]!==undefined)video[field]=value.video[field];
        const weight=['bit_rate','bitRate','bitRateList'].reduce((n,k)=>n+(Array.isArray(video[k])?video[k].length:0),0);
        if(weight>=score && JSON.stringify(video).length<160000){score=weight;item={aweme_id:id,desc:typeof value.desc==='string'?value.desc.slice(0,300):'',author:{nickname:String(value.author?.nickname || value.authorInfo?.nickname || '').slice(0,100)},video};}
      }
      for(const child of Object.values(value))walk(child,depth-1);
    }
    function parse(input,depth=18){
      if(typeof input!=='string' || input.length<30 || input.length>8*1048576 || seen.has(input) || parseBudget<=0 || depth<0)return;
      if(!input.includes(id))return;seen.add(input);
      let raw=input.trim();
      for(let n=0;n<3;n++){
        try{const parsed=JSON.parse(raw);if(typeof parsed==='string' && parsed!==raw){raw=parsed;continue;}walk(parsed,depth-1);return;}catch{}
        let pushed=false;
        for(const match of raw.matchAll(/\.push\s*\(\s*(?=\[)/g)){
          const a=match.index+match[0].length;let level=0,quoted=false,escaped=false;
          for(let i=a;i<raw.length;i++){const c=raw[i];
            if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
            if(c==='"'){quoted=true;continue;}if(c==='[')level++;
            if(c===']' && --level===0){try{walk(JSON.parse(raw.slice(a,i+1)),depth-1);pushed=true;}catch{}break;}
          }
        }
        if(pushed)return;
        if(/%7[bB]|%22/.test(raw)){try{const next=decodeURIComponent(raw);if(next!==raw){raw=next;continue;}}catch{}}
        break;
      }
      const stack=[];let quoted=false,escaped=false;
      for(let i=0;i<raw.length && parseBudget>0;i++){
        const c=raw[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
        if(c==='"'){quoted=true;continue;}if(c==='{')stack.push(i);
        else if(c==='}' && stack.length){const start=stack.pop();if(i-start>1200000)continue;const value=raw.slice(start,i+1);
          if(!value.includes(id) || !/"(?:aweme_id|awemeId|itemId|item_id)"\s*:/.test(value))continue;
          parseBudget--;try{walk(JSON.parse(value),depth-1);}catch{}
        }
      }
    }
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))parse(match[1]);
    if(!item)return {ok:false,code:'NO_DATA'};
    const key=Symbol.for('douyin.download-media-cache.v1');
    const cache=window[key] && typeof window[key].set==='function'?window[key]:(window[key]=new Map());
    cache.delete(id);cache.set(id,{item,seenAt:Date.now()});while(cache.size>64)cache.delete(cache.keys().next().value);
    return {ok:true};
  }catch{return {ok:false,code:controller.signal.aborted?'REFRESH_TIMEOUT':'REFRESH_FAILED'};}
  finally{clearTimeout(timer);controller.abort();}
}
