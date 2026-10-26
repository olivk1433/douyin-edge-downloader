import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {refreshVideoMetadataInPage} from '../refresh-media.js';
import {sameVideo} from '../utils.js';
const source=await readFile(new URL('../media-capture.js',import.meta.url),'utf8');
const id='7000000000000000001',other='7000000000000000002',key=Symbol.for('douyin.download-media-cache.v1');
const item={awemeId:id,desc:'作品',secret:'must not retain',video:{bitRateList:[{width:720,height:1280,playAddr:[{src:'https://cdn.test/720.mp4'}]}]}};
const location=new URL(`https://www.douyin.com/video/${id}`);
test('capture preserves the original Fetch promise and readable caller response; excludes unrelated requests',async()=>{
  const response=new Response(JSON.stringify({aweme_detail:item}));const pending=Promise.resolve(response);
  const window={fetch:()=>pending};
  vm.runInNewContext(source,{window,location,URL,Blob,Map,Symbol});
  assert.equal(window.fetch('/aweme/v1/web/aweme/detail/'),pending);
  await pending;
  assert.equal((await response.json()).aweme_detail.awemeId,id);
  for(let i=0;i<100&&!window[key].size;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(window[key].get(id).item.video.bitRateList.length,1);
  assert.equal(window[key].get(id).item.secret,undefined);
  const excluded={fetch:()=>Promise.resolve(new Response(JSON.stringify({aweme_detail:item})))};
  vm.runInNewContext(source,{window:excluded,location,URL,Blob,Map,Symbol});
  await excluded.fetch('https://elsewhere.test/aweme/v1/web/aweme/detail/');
  await excluded.fetch('/account/profile/');await new Promise(r=>setTimeout(r,15));assert.equal(excluded[key].size,0);
});
test('capture observes XHR JSON and adds only one load listener when reused',()=>{
  class XHR {constructor(){this.listeners=[];this.status=200;this.responseType='json';this.response={item};}open(){return 17;}addEventListener(t,fn){this.listeners.push(fn);}}
  const window={XMLHttpRequest:XHR};vm.runInNewContext(source,{window,location,URL,Blob,Map,Symbol});
  const xhr=new XHR();assert.equal(xhr.open('GET','/aweme/v1/web/aweme/detail/'),17);xhr.open('GET','/aweme/v1/web/aweme/detail/');
  assert.equal(xhr.listeners.length,1);xhr.listeners[0]();assert.equal(window[key].size,1);
});

test('normal video metadata on the observed www-hj Douyin host is captured',async()=>{
  const window={fetch:()=>Promise.resolve(new Response(JSON.stringify({aweme_detail:item})))};
  vm.runInNewContext(source,{window,location,URL,Blob,Map,Symbol});
  await window.fetch('https://www-hj.douyin.com/aweme/v1/web/aweme/detail/');
  for(let i=0;i<100&&!window[key].size;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(window[key].get(id).item.video.bitRateList.length,1);
});
async function refresh(html,status=200){
  const window={};const calls=[];
  const result=await vm.runInNewContext(`(${refreshVideoMetadataInPage.toString()})('${id}')`,{window,location,AbortController,setTimeout,clearTimeout,Blob,Map,Symbol,fetch:async(url,options)=>{calls.push({url,options});return new Response(html,{status});}});
  return {result,window,calls};
}
test('public page refresh parses encoded pace data without executing scripts or accepting other IDs',async()=>{
  const body=`<script>self.__pace_f=self.__pace_f||[];self.__pace_f.push([0]);self.__pace_f.push(${JSON.stringify([1,encodeURIComponent(JSON.stringify({items:[{...item,awemeId:other},item]}))])});throw Error('must not execute')</script>`;
  const {result,window,calls}=await refresh(body);
  assert.equal(result.ok,true);assert.equal(window[key].size,1);assert.equal(window[key].get(id).item.video.bitRateList.length,1);
  assert.equal(calls.length,1);assert.equal(calls[0].url,`https://www.douyin.com/video/${id}`);assert.equal(calls[0].options.credentials,'include');
});
test('refresh never treats challenge HTML, another work or HTTP errors as valid metadata',async()=>{
  for(const html of ['<h1>Verify</h1>',`<script type="application/json">${JSON.stringify({...item,awemeId:other})}</script>`])assert.equal((await refresh(html)).result.code,'NO_DATA');
  assert.equal((await refresh('blocked',403)).result.code,'HTTP_403');
});
test('fresh signed addresses retain the same player binding; work/source switches do not',()=>{
  const a={status:'ready',id,url:'https://cdn.test/old',playerSource:'blob:same'};
  assert.equal(sameVideo(a,{...a,url:'https://cdn.test/new'}),true);
  assert.equal(sameVideo(a,{...a,id:other}),false);
  assert.equal(sameVideo(a,{...a,playerSource:'blob:next'}),false);
});
