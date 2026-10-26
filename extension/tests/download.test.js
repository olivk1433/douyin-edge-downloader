import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fetchVideoInPage,readVideoJob,releasePageBlob} from '../page-fetch.js';
import {downloadError,canRetryInPage} from '../utils.js';
const mp4=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0]);
async function run(fetchImpl, location={protocol:'https:',hostname:'www.douyin.com',origin:'https://www.douyin.com'},config={}) {
  const calls=[];
  const stats={written:0,closed:0,aborted:0,removed:[],revoked:[],created:0};
  const directory={
    entries:async function*(){},
    removeEntry:async name=>stats.removed.push(name),
    getFileHandle:async()=>{stats.created++;return {
      createWritable:async()=>({write:async bytes=>{if(config.writeError)throw config.writeError;stats.written+=bytes.byteLength;},close:async()=>{stats.closed++;},abort:async()=>{stats.aborted++;}}),
      getFile:async()=>({size:stats.written,lastModified:Date.now()})
    };}
  };
  class FakeURL extends URL {static createObjectURL(){return 'blob:https://www.douyin.com/test';}static revokeObjectURL(){}}
  FakeURL.revokeObjectURL=url=>stats.revoked.push(url);
  const ctx=vm.createContext({location,window:{},crypto:{randomUUID:()=> 'unit-job'},
    navigator:{storage:{getDirectory:async()=>({getDirectoryHandle:async()=>directory}),estimate:async()=>({quota:config.quota ?? 1e12,usage:0})}},
    URL:FakeURL,fetch:async(u,options)=>{calls.push({url:u,...options});return fetchImpl(u,options,calls.length);},
    AbortController,Blob,Uint8Array,setTimeout:(fn,ms)=>{if(config.timeout && ms===120000)queueMicrotask(fn);return 1;},clearTimeout:()=>{}});
  const result=await vm.runInContext(`(${fetchVideoInPage.toString()})(${JSON.stringify(config.sources || 'https://v.example.test/media.mp4')}${config.jobId?`,${JSON.stringify(config.jobId)}`:''})`,ctx);
  return {result,calls,stats,ctx};
}
test('page retry streams MP4 into disk-backed file and returns a page-owned blob URL',async()=>{
  const {result,calls,stats}=await run(()=>new Response(mp4,{headers:{'Content-Type':'video/mp4'}}));
  assert.equal(result.ok,true);assert.equal(result.size,16);
  assert.equal(result.url,'blob:https://www.douyin.com/test');
  assert.equal(calls[0].credentials,'include');assert.equal(calls[0].headers,undefined);
  assert.equal(stats.written,16);assert.equal(stats.closed,1);assert.equal(stats.removed.length,0);
});
test('anonymous CORS fallback only follows a fetch exception',async()=>{
  const {result,calls}=await run((u,o,n)=>{if(n===1)throw new TypeError('CORS');return new Response(mp4);});
  assert.equal(result.ok,true);assert.equal(calls[1].credentials,'same-origin');
});
test('HTTP rejection reports exact code after a bounded credentials fallback',async()=>{
  const {result,calls}=await run(()=>new Response('denied',{status:403}));
  assert.equal(result.code,'HTTP_403');assert.equal(calls.length,2);
});
test('403 can fall back to anonymous credentials on a public CDN',async()=>{
  const {result,calls,stats}=await run((u,options)=>options.credentials==='include'?new Response('denied',{status:403}):new Response(mp4));
  assert.equal(result.ok,true);assert.equal(calls.length,2);assert.equal(stats.created,1);
});
test('403 switches to the next supplied same-tier CDN URL, never alters a URL',async()=>{
  const sources=['https://cdn-a.test/exact-signed.mp4?sig=1','https://cdn-b.test/exact-signed.mp4?sig=2'];
  const {result,calls,stats}=await run(u=>u===sources[0]?new Response('denied',{status:403}):new Response(mp4),undefined,{sources});
  assert.equal(result.ok,true);assert.deepEqual([...new Set(calls.map(c=>c.url))],sources);assert.equal(stats.created,1);
});
test('rate limits stop immediately, and invalid response bodies are not saved',async()=>{
  const limited=await run(()=>new Response('wait',{status:429}),undefined,{sources:['https://cdn-a.test/a.mp4','https://cdn-b.test/b.mp4']});
  assert.equal(limited.result.code,'HTTP_429');assert.equal(limited.calls.length,1);
  const changed=await run(u=>u.includes('cdn-a')?new Response('<html>denied</html>',{headers:{'Content-Type':'video/mp4'}}):new Response(mp4),undefined,{sources:['https://cdn-a.test/a.mp4','https://cdn-b.test/b.mp4']});
  assert.equal(changed.result.ok,true);assert.equal(changed.stats.created,1);
});
test('HTML / JSON / partial / truncated responses never become a saved MP4',async()=>{
  assert.equal((await run(()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}))).result.code,'NOT_VIDEO');
  assert.equal((await run(()=>new Response('not an mp4 despite content type',{headers:{'Content-Type':'video/mp4'}}))).result.code,'NOT_MP4');
  assert.equal((await run(()=>new Response(mp4,{status:206}))).result.code,'PARTIAL_MEDIA');
  assert.equal((await run(()=>new Response(mp4,{headers:{'Content-Length':String(257*1024*1024)}}))).result.code,'INCOMPLETE_MEDIA');
});
test('streams more than 256 MiB without retaining a video-sized chunk array',async()=>{
  const chunk=new Uint8Array(1024*1024);let count=0;
  const stream=new ReadableStream({pull(controller){if(count===0)controller.enqueue(mp4);else if(count<=257)controller.enqueue(chunk);else controller.close();count++;}});
  const size=mp4.length+257*chunk.length;
  const {result,stats}=await run(()=>new Response(stream,{headers:{'Content-Length':String(size)}}));
  assert.equal(result.ok,true);assert.equal(result.size,size);assert.equal(stats.written,size);assert.equal(stats.closed,1);
});
test('quota and disk write failures are explicit and remove partial files',async()=>{
  const limited=await run(()=>new Response(mp4,{headers:{'Content-Length':'16'}}),undefined,{quota:8});
  assert.equal(limited.result.code,'STORAGE_FULL');assert.equal(limited.stats.created,0);
  const failure=Error('quota');failure.name='QuotaExceededError';
  const broken=await run(()=>new Response(mp4),undefined,{writeError:failure});
  assert.equal(broken.result.code,'STORAGE_FULL');assert.equal(broken.stats.aborted,1);assert.equal(broken.stats.removed.length,1);
});
test('release removes both object URL and disk temporary file',async()=>{
  const {result,stats,ctx}=await run(()=>new Response(mp4));
  await vm.runInContext(`(${releasePageBlob.toString()})(${JSON.stringify(result.url)})`,ctx);
  assert.deepEqual(stats.revoked,[result.url]);assert.deepEqual(stats.removed,['shiying-unit-job.mp4']);
});
test('background job starts immediately and exposes completion through polling',async()=>{
  let resolveResponse;
  const {result,ctx,stats}=await run(()=>new Promise(resolve=>resolveResponse=resolve),undefined,{jobId:'async-job'});
  assert.equal(result.started,true);
  const read=()=>vm.runInContext(`(${readVideoJob.toString()})('async-job')`,ctx);
  assert.equal(read().phase,'reading');
  resolveResponse(new Response(mp4,{headers:{'Content-Length':String(mp4.length)}}));
  for(let n=0;n<10 && read().phase!=='ready';n++)await new Promise(setImmediate);
  assert.equal(read().phase,'ready');assert.equal(read().received,16);assert.equal(read().total,16);
  assert.equal(stats.closed,1);
});
test('inactivity timeout is explicit, not a total duration or size limit',async()=>{
  const {result}=await run((u,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))),undefined,{timeout:true});
  assert.equal(result.code,'FETCH_TIMEOUT');assert.ok(result.message.includes('连续两分钟'));
});
test('leaving the original site prevents page retry',async()=>{
  const {result,calls}=await run(()=>{throw Error('must not fetch');},{protocol:'https:',hostname:'example.com'});
  assert.equal(result.code,'PAGE_CHANGED');assert.equal(calls.length,0);
});
test('CORS / network failure is explicit',async()=>{
  assert.equal((await run(()=>{throw new TypeError('CORS');})).result.code,'PAGE_FETCH_FAILED');
});
test('download diagnostics distinguish local errors from request errors',()=>{
  assert.ok(downloadError('FILE_NO_SPACE').includes('磁盘空间不足'));
  assert.ok(downloadError('SERVER_FORBIDDEN').includes('SERVER_FORBIDDEN'));
  assert.ok(downloadError('UNRECOGNIZED').includes('UNRECOGNIZED'));
  assert.equal(canRetryInPage('SERVER_FORBIDDEN'),true);
  for(const code of ['USER_CANCELED','FILE_NO_SPACE','FILE_VIRUS_INFECTED','FILE_BLOCKED','NETWORK_DISCONNECTED']) assert.equal(canRetryInPage(code),false);
});
