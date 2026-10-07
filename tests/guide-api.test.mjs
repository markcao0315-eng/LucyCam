import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../server.mjs';
import {photographyPrompt} from '../photo-prompts.mjs';
const plan={canGuide:true,subject:{label:'杯子',box:{x:.3,y:.3,width:.4,height:.4}},crop:{centerX:.5,centerY:.5,scale:.7},filter:{id:'warm',strength:25},advice:'保留完整杯子。'};
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,64,0,48,1,1,17,0,255,217]).toString('base64');
const payload={referenceId:'abc-123',image:jpeg,scene:'portrait',aspectRatio:'3:4'};
async function fixture(t,{enabled=true,limit='10',fetchImpl}={}){
  let calls=0,time=Date.now(),cookie='',lastRequest;
  const env={GEMINI_API_KEY:'test-key',LUCYCAM_ACCESS_CODE:'test-access-code',LIVE_GUIDANCE_ENABLED:String(enabled),AI_DAILY_LIMIT:limit};
  const server=createAppServer({env,now:()=>time,fetchImpl:async(url,request)=>{
    calls++;lastRequest=JSON.parse(request.body);if(fetchImpl)return fetchImpl(url,request);
    const guide=JSON.parse(request.body).generationConfig.responseJsonSchema.properties.canGuide;
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(guide?plan:{subject:'杯子',advice:'保留主体。',centerX:.5,centerY:.5,scale:.7})}]}}]});
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body=payload)=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  const login=async()=>{const r=await post('/api/session',{code:'test-access-code'});cookie=r.headers.get('set-cookie').split(';')[0];};
  return {base,post,login,env,calls:()=>calls,lastRequest:()=>lastRequest,advance:()=>{time+=6000;}};
}
test('guide requires feature flag and existing authentication; validates request before provider call',async t=>{
  const f=await fixture(t);assert.equal((await f.post('/api/guide-plan')).status,401);await f.login();
  for(const bad of [{referenceId:'bad_id'},{referenceId:'x'.repeat(65)},{aspectRatio:'16:9'},{aspectRatio:'1:1'},{scene:'invalid'},{image:'invalid'}])assert.equal((await f.post('/api/guide-plan',{...payload,...bad})).status,400);
  assert.equal(f.calls(),0);f.env.LIVE_GUIDANCE_ENABLED='false';assert.equal((await f.post('/api/guide-plan')).status,404);
  assert.equal((await f.post('/api/compose')).status,200);assert.equal(f.calls(),1);
});
test('guide echoes reference, fixed model, schema and conservative portrait filter; shared cooldown and daily quota',async t=>{
  const f=await fixture(t,{limit:'2'});await f.login();
  const response=await f.post('/api/guide-plan');assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.referenceId,payload.referenceId);assert.equal(data.schemaVersion,1);assert.equal(data.model,'gemini-3.1-flash-lite');assert.equal(data.plan.filter.strength,25);
  assert.equal(f.lastRequest().systemInstruction.parts[0].text,photographyPrompt(true));
  assert.equal((await f.post('/api/compose')).status,429);f.advance();assert.equal((await f.post('/api/compose')).status,200);f.advance();assert.equal((await f.post('/api/guide-plan')).status,429);assert.equal(f.calls(),2);
});
test('new and legacy paths share the same in-flight lock',async t=>{
  let release;const f=await fixture(t,{fetchImpl:()=>new Promise(r=>{release=()=>r(Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(plan)}]}}]}));})});await f.login();
  const pending=f.post('/api/guide-plan');while(!release)await new Promise(r=>setTimeout(r,2));
  assert.equal((await f.post('/api/compose')).status,429);assert.equal(f.calls(),1);release();assert.equal((await pending).status,200);
});
test('invalid provider geometry is a safe error and never silently clamped',async t=>{
  const f=await fixture(t,{fetchImpl:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...plan,crop:{centerX:.9,centerY:.5,scale:.8}})}]}}]})});await f.login();
  const response=await f.post('/api/guide-plan');assert.equal(response.status,502);assert.match((await response.json()).error,/构图数据无效/);
});
test('exact static whitelist serves modules and pinned runtime while protecting documents',async t=>{
  const f=await fixture(t);
  for(const file of ['guide-coach','motion-sensor','guide-ui','guide-controller','guide-geometry','camera-renderer','tracking-worker','tracking-client','tracking-core','tracking-math','guide-plan']){const r=await fetch(`${f.base}/${file}.js`);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);}
  const vendor=await fetch(`${f.base}/vendor/opencv-4.13.0.js`);assert.equal(vendor.status,200);assert.match(vendor.headers.get('content-type'),/javascript/);
  for(const file of ['/docs/LucyCam-实时AI拍摄技术实施书.md','/tests/guide-api.test.mjs','/vendor/unknown.js','/AGENTS.md'])assert.equal((await fetch(f.base+file)).status,404);
});
