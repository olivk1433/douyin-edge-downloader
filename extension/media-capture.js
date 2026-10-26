// MAIN world, document_start. Observe only normal Douyin video-data responses.
// Return the original Fetch promise/response and never issue a new API request.
(() => {
  const key=Symbol.for('douyin.download-media-cache.v1');
  if(window[key])return;
  const cache=new Map();Object.defineProperty(window,key,{value:cache,configurable:true});
  const fields=['play_addr','playAddr','playApi','play_api','playAddrH264','playAddrH265','play_addr_h264','play_addr_h265','bit_rate','bitRate','bitRateList','width','height','duration','ratio','is_dash','isDash','is_encrypt','isEncrypt','format','mime_type','codec_type','codecType','videoFormat','is_bytevc1'];
  const idOf=x=>typeof x==='string' && /^\d{5,30}$/.test(x)?x:'';
  function capture(data){
    let budget=30000;const seen=new WeakSet();
    function walk(value,depth){
      if(!value || typeof value!=='object' || depth<0 || budget--<=0 || seen.has(value))return;
      seen.add(value);
      const id=idOf(value.aweme_id)||idOf(value.awemeId)||idOf(value.item_id)||idOf(value.itemId);
      if(id && value.video && typeof value.video==='object'){
        const video={};for(const field of fields)if(value.video[field]!==undefined)video[field]=value.video[field];
        const item={aweme_id:id,desc:typeof value.desc==='string'?value.desc.slice(0,300):'',author:{nickname:typeof value.author?.nickname==='string'?value.author.nickname.slice(0,100):''},video};
        if(JSON.stringify(item).length<=160000){cache.delete(id);cache.set(id,{item,seenAt:Date.now()});while(cache.size>64)cache.delete(cache.keys().next().value);}
      }
      for(const child of Object.values(value))walk(child,depth-1);
    }
    walk(data,16);
  }
  function relevant(input){
    try{const u=new URL(typeof input==='string'?input:(input?.url || input?.href),location.href);
      return u.protocol==='https:' && [location.hostname,'www.douyin.com','www-hj.douyin.com'].includes(u.hostname) && /^\/aweme\/v\d+\/(?:web\/)?(?:aweme\/|general\/search|search\/)/.test(u.pathname);
    }catch{return false;}
  }
  async function fromResponse(response){
    if(!response.ok || Number(response.headers.get('content-length'))>6*1048576)return;
    const clone=response.clone(),reader=clone.body?.getReader();if(!reader)return;
    const chunks=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6*1048576)return;chunks.push(value);}
      capture(JSON.parse(await new Blob(chunks).text()));
    }catch{}finally{reader.cancel().catch(()=>{});}
  }
  if(typeof window.fetch==='function'){
    const original=window.fetch;
    window.fetch=function(...args){const pending=Reflect.apply(original,this,args);
      try{if(relevant(args[0]))pending.then(response=>fromResponse(response)).catch(()=>{});}catch{}
      return pending;
    };
  }
  if(window.XMLHttpRequest?.prototype){
    const proto=window.XMLHttpRequest.prototype,open=proto.open,urls=new WeakMap(),watched=new WeakSet();
    proto.open=function(...args){const result=Reflect.apply(open,this,args);urls.set(this,args[1]);
      if(!watched.has(this)){watched.add(this);this.addEventListener('load',()=>{
        try{if(!relevant(urls.get(this)) || this.status<200 || this.status>=300)return;
          if(this.responseType==='json')capture(this.response);
          else if((!this.responseType || this.responseType==='text') && this.responseText.length<=6*1048576)capture(JSON.parse(this.responseText));
        }catch{}
      });}return result;
    };
  }
})();
