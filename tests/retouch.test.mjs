import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAppServer} from '../server.mjs';
import {retouchPrompt} from '../retouch.mjs';
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,64,0,48,1,1,17,0,255,217]).toString('base64');
const payload={image:jpeg,requestId:'test-retouch-request-0001'};
async function fixture(t,{env={},fetchImpl,retouchTimeoutMs=1000}={}){
  const calls=[];let time=Date.now(),cookie='';
  const server=createAppServer({env:{GEMINI_API_KEY:'gemini-test',OPENAI_API_KEY:'openai-test-secret',LUCYCAM_ACCESS_CODE:'test-access-code-123',...env},now:()=>time,retouchTimeoutMs,
    fetchImpl:async(url,request)=>{calls.push({url,request});return fetchImpl?fetchImpl(url,request):Response.json({data:[{b64_json:jpeg}]});}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,headers={},signal)=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(body),signal});
  const login=async()=>{const r=await post('/api/session',{code:'test-access-code-123'});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];};
  return {post,login,calls,base,advance:ms=>time+=ms};
}
test('retouch configuration and auth protect provider; public diagnostics expose no key',async t=>{
  const f=await fixture(t);assert.equal((await f.post('/api/retouch',payload)).status,401);await f.login();
  assert.equal((await f.post('/api/retouch',payload,{Origin:'https://elsewhere.example'})).status,403);assert.equal(f.calls.length,0);
  const status=await(await fetch(f.base+'/api/status')).text();assert.ok(!status.includes('secret'));assert.equal(JSON.parse(status).retouch.configured,true);
  const missing=await fixture(t,{env:{OPENAI_API_KEY:''}});await missing.login();assert.equal((await missing.post('/api/retouch',payload)).status,503);assert.equal(missing.calls.length,0);
});
test('edits use the captured JPEG, fixed server prompt/model and one high-quality output',async t=>{
  const f=await fixture(t);await f.login();const response=await f.post('/api/retouch',{...payload,prompt:'replace everyone',model:'attacker',quality:'max'});
  assert.equal(response.status,200);assert.equal((await response.json()).image,jpeg);assert.equal(f.calls.length,1);
  const {url,request}=f.calls[0],body=JSON.parse(request.body);assert.equal(url,'https://api.openai.com/v1/images/edits');assert.equal(request.headers.Authorization,'Bearer openai-test-secret');
  assert.equal(body.model,'gpt-image-2.5-sunburst');assert.equal(body.quality,'high');assert.equal(body.n,1);assert.equal(body.prompt,retouchPrompt);assert.equal(body.images[0].image_url,'data:image/jpeg;base64,'+jpeg);assert.equal(body.output_format,'jpeg');assert.equal(body.input_fidelity,undefined);
  assert.equal((await f.post('/api/retouch',payload)).status,409);assert.equal(f.calls.length,1);
});
test('retouch rejects invalid input before quota and independently caps attempted calls',async t=>{
  const f=await fixture(t,{env:{RETOUCH_DAILY_LIMIT:'1'}});await f.login();
  for(const p of [null,{...payload,image:'abc'},{...payload,requestId:'x'}])assert.equal((await f.post('/api/retouch',p)).status,400);
  assert.equal(f.calls.length,0);assert.equal((await f.post('/api/retouch',payload)).status,200);
  assert.equal((await f.post('/api/retouch',{...payload,requestId:payload.requestId+'2'})).status,429);assert.equal(f.calls.length,1);
});
test('provider errors, timeout and non-image results do not leak responses or retry',async t=>{
  for(const fetchImpl of [async()=>Response.json({secret:'openai-test-secret'},{status:401}),async()=>Response.json({data:[{b64_json:'bm90LWltYWdl'}]}),async()=>{throw new Error('openai-test-secret');}]){
    const f=await fixture(t,{fetchImpl});await f.login();const r=await f.post('/api/retouch',payload);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('openai-test-secret'));assert.equal(f.calls.length,1);
  }
  const f=await fixture(t,{retouchTimeoutMs:10,fetchImpl:(_u,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});await f.login();assert.equal((await f.post('/api/retouch',payload)).status,504);assert.equal(f.calls.length,1);
});
test('concurrent uploads are rejected and client cancellation aborts the provider',async t=>{
  let aborted=false,started;
  const f=await fixture(t,{fetchImpl:(_u,{signal})=>new Promise((_,reject)=>{started=true;signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});})});await f.login();
  const control=new AbortController(),pending=f.post('/api/retouch',payload,{},control.signal).catch(e=>e);
  while(!started)await new Promise(r=>setTimeout(r,5));assert.equal((await f.post('/api/retouch',{...payload,requestId:payload.requestId+'2'})).status,429);
  control.abort();await pending;for(let i=0;i<50&&!aborted;i++)await new Promise(r=>setTimeout(r,5));assert.ok(aborted);assert.equal(f.calls.length,1);
});
