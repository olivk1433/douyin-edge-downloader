import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {scanCurrentVideo} from '../scanner.js';
import {isDouyinPage,mediaURL,filenameFor,sameVideo} from '../utils.js';

const A = '7000000000000000001', B = '7000000000000000002';
const clip = (id, src=`https://v.example.test/${id}.mp4`) => ({aweme_id:id,desc:`作品 ${id}`,author:{nickname:'作者'},video:{play_addr:{url_list:[src]}}});
function fixture({videos=[{}], route=`https://www.douyin.com/video/${A}`, state, scripts=[],globals={}} = {}) {
  class Node {}
  const nodes = videos.map(options => {
    const el = new Node();
    Object.assign(el, {paused:false,ended:false,duration:65,currentSrc:'blob:player',src:'',parentElement:null,
      getBoundingClientRect:() => ({left:200,top:0,right:700,bottom:700,width:500,height:700}),
      querySelector:() => null,getAttribute:() => null,...options});
    return el;
  });
  const context = {Node,URL,location:{href:route},innerWidth:1200,innerHeight:900,
    getComputedStyle:el=>({display:'block',visibility:'visible',opacity:'1',...el.style}),
    document:{querySelectorAll:s=>s==='video'?nodes:scripts, elementFromPoint:()=>({closest:()=>null})},
    window:{_ROUTER_DATA:state,...globals}};
  return vm.runInNewContext(`(${scanCurrentVideo.toString()})()`,context);
}
test('matches exact ID, never the first preloaded record',()=>{
  const r=fixture({state:{items:[clip(B),clip(A)]}});
  assert.equal(r.id,A);assert.equal(r.url,`https://v.example.test/${A}.mp4`);
});
test('active player local data outranks stale route',()=>{
  const r=fixture({videos:[{'__reactProps$x':{item:clip(B)}}],state:{items:[clip(A)]}});
  assert.equal(r.id,B);
});
test('currentSrc outranks nearby metadata media URL',()=>{
  const r=fixture({videos:[{currentSrc:'https://v.example.test/playing.mp4','__reactProps$x':{item:clip(A)}}]});
  assert.equal(r.url,'https://v.example.test/playing.mp4');
});
test('offscreen preload cannot win against visible player',()=>{
  const r=fixture({videos:[{currentSrc:'https://v.example.test/visible.mp4'},
    {currentSrc:'https://v.example.test/preload.mp4',getBoundingClientRect:()=>({left:0,right:500,top:900,bottom:1600,width:500,height:700})}]});
  assert.equal(r.url,'https://v.example.test/visible.mp4');
});
test('multiple equal visible players must not auto-select',()=>assert.equal(fixture({videos:[{},{}]}).code,'AMBIGUOUS'));
test('hidden player is not selected',()=>assert.equal(fixture({videos:[{style:{display:'none'}}]}).code,'NO_VIDEO'));
test('blob URL without matching record is unavailable',()=>assert.equal(fixture({state:{items:[clip(B)]}}).code,'NO_URL'));
test('encoded hydration JSON is supported',()=>{
  const r=fixture({scripts:[{textContent:encodeURIComponent(JSON.stringify({item:clip(A)}))}]});
  assert.equal(r.id,A);assert.equal(r.status,'ready');
});
test('camelCase playback data and modal_id are supported',()=>{
  const r=fixture({route:`https://www.douyin.com/?modal_id=${B}`,state:{awemeId:B,video:{playAddr:{urlList:['//v.example.test/camel.mp4']}}}});
  assert.equal(r.url,'https://v.example.test/camel.mp4');
});
test('protected media is unavailable',()=>assert.equal(fixture({videos:[{mediaKeys:{}}]}).code,'PROTECTED'));
test('split DASH variants cannot become complete video download',()=>{
  const r=fixture({state:{aweme_id:A,video:{bit_rate:[{is_dash:1,play_addr:{url_list:['https://v.example.test/video-only.mp4']}}]}}});
  assert.equal(r.code,'NO_URL');
});
test('HLS / DASH manifests are not downloaded as mp4',()=>{
  for (const file of ['clip.m3u8?token=secret','clip.mpd']) {
    assert.equal(fixture({videos:[{currentSrc:`https://v.example.test/${file}`}]}).code,'NO_URL');
    assert.equal(mediaURL(`https://v.example.test/${file}`),'');
  }
});
test('no visible video / other sites return clear unavailable state',()=>{
  assert.equal(fixture({videos:[]}).code,'NO_VIDEO');
  assert.equal(fixture({route:'https://example.com/'}).code,'SITE');
});
test('cyclic state is bounded and does not hang',()=>{
  const state={item:clip(A)};state.self=state;
  assert.equal(fixture({state}).status,'ready');
});
test('unsafe URLs and lookalike sites are rejected',()=>{
  for (const value of ['javascript:alert(1)','blob:abc','http://v.example.test/a.mp4','https://user:password@v.example.test/a.mp4']) assert.equal(mediaURL(value),'');
  assert.equal(isDouyinPage('https://www.douyin.com.evil.test'),false);
  assert.equal(isDouyinPage('https://www.douyin.com/video/123'),true);
});
test('Windows filenames are bounded and cannot escape download directory',()=>{
  const file=filenameFor({title:'../a\\b:<c>?*|\u202e',id:A});
  assert.equal(file.split('/').length,2);assert.ok(file.endsWith(`_${A}.mp4`));
  assert.ok(!/[<>:"\\|?*\u202e]/.test(file));
  assert.ok(filenameFor({title:'CON',id:A}).startsWith('Douyin/_CON'));
  assert.ok([...filenameFor({title:'很'.repeat(300),id:A})].length<100);
});
test('download revalidation catches video switches even when route ID is stale',()=>{
  const a={status:'ready',id:A,url:'https://v.example.test/a?sig=1'};
  assert.equal(sameVideo(a,{...a}),true);
  assert.equal(sameVideo(a,{...a,url:'https://v.example.test/b?sig=2'}),false);
  assert.equal(sameVideo(a,{...a,id:B}),false);
  assert.equal(sameVideo({...a,id:''},{...a,id:'',url:'https://v.example.test/b'}),false);
});
test('player-shaped playAddr arrays can expose progressive media',()=>{
  const r=fixture({state:{awemeId:A,video:{playAddr:[{src:'https://v.example.test/array.mp4'}]}}});
  assert.equal(r.url,'https://v.example.test/array.mp4');
});
test('floating card requires exactly one visible playing video',()=>{
  assert.equal(fixture({videos:[{currentSrc:'https://v.example.test/a.mp4'}]}).floatingEligible,true);
  assert.equal(fixture({videos:[{paused:true,currentSrc:'https://v.example.test/a.mp4'}]}).floatingEligible,false);
  assert.equal(fixture({videos:[{duration:Infinity,currentSrc:'https://v.example.test/a.mp4'}]}).floatingEligible,false);
  const result=fixture({videos:[{currentSrc:'https://v.example.test/a.mp4'},
    {paused:true,currentSrc:'https://v.example.test/b.mp4'}]});
  assert.equal(result.floatingEligible,true);assert.equal(result.url,'https://v.example.test/a.mp4');
});
test('qualities reflect real dimensions and exclude other works / DASH',()=>{
  const state={aweme_id:A,video:{play_addr:{url_list:['https://v.example.test/default.mp4']},bit_rate:[
    {bit_rate:3000000,play_addr:{width:1080,height:1920,url_list:['https://v.example.test/1080.mp4']}},
    {bit_rate:1500000,play_addr:{width:720,height:1280,url_list:['https://v.example.test/720.mp4']}},
    {bit_rate:9000000,is_dash:1,play_addr:{width:2160,height:3840,url_list:['https://v.example.test/dash.mp4']}}
  ]}};
  const r=fixture({state:{items:[clip(B),state]}});
  assert.deepEqual(Array.from(r.qualities,q=>q.label),['自动选择','1080p','720p']);
  assert.ok(!r.qualities.some(q=>q.url.includes('dash') || q.url.includes(B)));
});
test('unknown resolution is labeled by bitrate rather than an invented HD tier',()=>{
  const r=fixture({state:{aweme_id:A,video:{bit_rate:[{bit_rate:1500000,play_addr:{url_list:['https://v.example.test/unknown.mp4']}}]}}});
  assert.equal(r.qualities[0].label,'自动选择');
  assert.ok(!r.qualities.some(q=>/720|1080/.test(q.label)));
});
test('web bitRateList yields actual tiers and preserves every CDN backup and playApi',()=>{
  const item={awemeId:A,video:{playAddr:[{src:'https://v.example.test/default.mp4'}],bitRateList:[
    {width:720,height:1280,bitRate:1500000,playAddr:[{src:'https://cdn-a.test/720.mp4'},{src:'https://cdn-b.test/720.mp4'}],playApi:'//www.douyin.com/aweme/v1/play/?video_id=720'},
    {width:1080,height:1920,bitRate:3000000,playAddr:[{src:'https://cdn-a.test/1080.mp4'}]}
  ]}};
  const result=fixture({state:{videoDetail:item}});
  assert.equal(result.qualityCount,2);
  const q=result.qualities.find(q=>q.label==='720p');
  assert.equal(q.urls.length,3);assert.ok(!q.urls.some(url=>url.includes('1080')));
  assert.ok(result.qualities[0].urls.includes('https://cdn-b.test/720.mp4'));
});
test('URL encoded pace chunks and inert push scripts expose their full video detail',()=>{
  const item={awemeId:A,video:{bitRateList:[{width:720,height:1280,bitRate:1000000,playAddr:[{src:'https://v.example.test/pace720.mp4'}]}]}};
  const chunks=[1,encodeURIComponent(JSON.stringify({videoDetail:item}))];
  const fromGlobal=fixture({globals:{__pace_f:[chunks]}});
  const fromScript=fixture({scripts:[{textContent:`self.__pace_f=self.__pace_f||[];self.__pace_f.push([0]);self.__pace_f.push(${JSON.stringify(chunks)});window.DO_NOT_RUN=1;`}]});
  assert.equal(fromGlobal.qualityCount,1);assert.equal(fromScript.qualityCount,1);
  assert.equal(fromScript.qualities[1].label,'720p');
});
test('new network metadata outranks expired hydration, without adding another work',()=>{
  const old=clip(A,'https://v.example.test/expired.mp4');
  const fresh={awemeId:A,video:{playAddr:[{src:'https://v.example.test/fresh.mp4'}],bitRateList:[{width:1080,height:1920,playAddr:[{src:'https://v.example.test/fresh1080.mp4'}]}]}};
  const cache=new Map([[A,{item:fresh,seenAt:Date.now()}],[B,{item:clip(B),seenAt:Date.now()}]]);
  const result=fixture({state:old,globals:{[Symbol.for('douyin.download-media-cache.v1')]:cache}});
  assert.equal(result.url,'https://v.example.test/fresh.mp4');
  assert.ok(!result.qualities[0].urls.some(url=>url.includes(B)));
  assert.ok(result.dataSources.includes('页面接口'));
});
test('real current resolution stays explicitly selectable alongside auto mode',()=>{
  const result=fixture({videos:[{currentSrc:'https://v.example.test/current.mp4',videoWidth:720,videoHeight:1280}]});
  assert.equal(result.qualities[0].label,'自动选择');assert.equal(result.qualities[1].label,'720p');
});
test('tier keys survive reordering and changed signed URLs',()=>{
  const rate=(width,url)=>({width,height:width*2,bitRate:width*1000,playAddr:[{src:url}]});
  const one=fixture({state:{awemeId:A,video:{bitRateList:[rate(720,'https://v.example.test/720?sig=1'),rate(1080,'https://v.example.test/1080')]}}});
  const two=fixture({state:{awemeId:A,video:{bitRateList:[rate(1080,'https://v.example.test/1080'),rate(720,'https://v.example.test/720?sig=2')]}}});
  assert.equal(one.qualities.find(q=>q.label==='720p').key,two.qualities.find(q=>q.label==='720p').key);
});

test('many bitrate and codec versions collapse to one selectable resolution',()=>{
  const rates=[5100000,4300000].map(bitRate=>({width:1920,height:1080,bitRate,playAddr:[{src:`https://cdn.test/1080-${bitRate}.mp4`}]}));
  for(const bitRate of [3500000,3400000,2900000,2000000,1400000])rates.push({width:1280,height:720,bitRate,codecType:'h265',playAddr:[{src:`https://cdn.test/720-${bitRate}.mp4`}]});
  const result=fixture({state:{awemeId:A,video:{bitRateList:rates}}});
  assert.deepEqual(Array.from(result.qualities,q=>q.label),['自动选择','1080p','720p']);
  const selected=result.qualities.find(q=>q.label==='720p');assert.equal(selected.urls.length,5);
  assert.ok(selected.urls.every(u=>u.includes('720-')));assert.equal(selected.key,'r:720');
});

test('actual player __vid identifies the work on a recommendation page with stale nearby data',()=>{
  const result=fixture({route:'https://www.douyin.com/?recommend=1',state:{items:[clip(A),clip(B)]},videos:[{currentSrc:`https://cdn.test/playing.mp4?__vid=${B}`,'__reactProps$x':{item:clip(A)}}]});
  assert.equal(result.id,B);assert.equal(result.title,`作品 ${B}`);
});
