import test from 'node:test';
import assert from 'node:assert/strict';
import {cropRect} from '../dist/photo-utils.js';
import {identity,point,multiply,inverse,scaleMatrix,fullTransform,displayPoint,fromDisplay,referencePoint,alignmentDistance,lockCrop} from '../dist/guide-geometry.js';
import {estimateSimilarity} from '../dist/tracking-math.js';
import {GuideController} from '../dist/guide-controller.js';
import {validateGuidePlan} from '../dist/guide-plan.js';
const plan={canGuide:true,subject:{label:'静物',box:{x:.35,y:.35,width:.3,height:.3}},crop:{centerX:.5,centerY:.5,scale:.7},filter:{id:'warm',strength:30},advice:'保留完整主体。'};
const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} vs ${b}`);
test('all aspect ratios, mirror, reference/current sizes and display inverse preserve coordinates',()=>{
  for(const ratio of [.75,1,9/16])for(const mirror of [false,true]){
    const base=cropRect(1920,1080,ratio),h=[1.02,-.02,-13,.02,1.02,4];
    const transform=fullTransform(h,{width:1920,height:1080},{width:480,height:270},{width:1280,height:720},{width:480,height:270});
    const original=referencePoint(base,.7,.3),moved=point(transform,original),back=point(inverse(transform),moved);
    close(back.x,original.x);close(back.y,original.y);
    const crop=cropRect(1280,720,ratio),display=displayPoint(moved,crop,320,320/ratio,mirror),round=fromDisplay(display,crop,320,320/ratio,mirror);
    close(round.x,moved.x);close(round.y,moved.y);
    const d0=scaleMatrix(480/1920,270/1080),dt=scaleMatrix(480/1280,270/720);
    const low=point(h,point(d0,original));const converted=point(dt,moved);close(low.x,converted.x);close(low.y,converted.y);
  }
});
test('right target approaches center when actual background moves left; out of view never aligns',()=>{
  const crop=cropRect(1200,1600,.75),target=referencePoint(crop,.6,.5),moved=point([1,0,-120,0,1,0],target);
  close(alignmentDistance(moved,crop),0);assert.ok(alignmentDistance({x:1500,y:800},crop)>.05);
  assert.ok(displayPoint(target,crop,300,400,true).x<150);
});
test('transform composition and robust fitting ignore independently moving outliers',()=>{
  const pairs=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p={x:25+x*30,y:20+y*30},q=point([1.01,-.02,8,.02,1.01,-5],p);pairs.push({...p,u:q.x,v:q.y});}
  for(let i=0;i<25;i++)pairs.push({x:i*7,y:i*3,u:i*7+70,v:i*3-40});
  const fit=estimateSimilarity(pairs);close(fit.matrix[2],8);close(fit.matrix[5],-5);assert.equal(fit.inliers.length,64);
  const accumulated=multiply([1,0,5,0,1,-3],[0,-1,0,1,0,0]);assert.deepEqual(point(accumulated,{x:10,y:20}),{x:-15,y:7});
});
test('locked crop transforms target corners, respects resolution and never silently recenters',()=>{
  const base=cropRect(2400,3200,.75),args={width:2400,height:3200,ratio:.75,base,plan,transform:[1,0,100,0,1,20]};
  const crop=lockCrop(args);close(crop.sx+crop.sw/2,1300);close(crop.sy+crop.sh/2,1620);
  const low=lockCrop({width:480,height:640,ratio:.75,base:cropRect(480,640,.75),plan,transform:identity()});assert.equal(low.sw,480);
  assert.throws(()=>lockCrop({...args,transform:[1,0,900,0,1,0]}),/越界/);
  const full={...plan,crop:{centerX:.5,centerY:.5,scale:1}};
  const tiny=lockCrop({...args,plan:full,transform:[1,0,-1e-7,0,1,0]});assert.equal(tiny.sx,0);
  assert.throws(()=>lockCrop({...args,plan:full,transform:[1,0,-.01,0,1,0]}));
  const rotated=lockCrop({...args,transform:[Math.cos(.1),-Math.sin(.1),150,Math.sin(.1),Math.cos(.1),-100]});assert.ok(rotated.sw>crop.sw);
});
test('guide validation rejects malformed geometry, subject truncation and unsafe filter data',()=>{
  assert.deepEqual(validateGuidePlan(plan),plan);
  for(const mutate of [p=>p.crop.scale=.49,p=>p.crop.centerX=NaN,p=>p.subject.box.width=0,p=>p.subject.box.x=.9,p=>p.filter.id='url(evil)',p=>p.filter.strength=1.5,p=>p.subject.label='x'.repeat(101),p=>p.advice='x'.repeat(301),p=>p.crop.centerX=.2,p=>p.subject.box={x:0,y:0,width:.8,height:.8}]){const p=structuredClone(plan);mutate(p);assert.throws(()=>validateGuidePlan(p));}
});
function rig(){
  let time=0,captures=0,release;const states=[];
  const c=new GuideController({now:()=>time,change:c=>states.push(c.state),capture:()=>{captures++;return new Promise(r=>{release=r;});}});
  const start=()=>c.start({width:2400,height:3200,ratio:.75,aspectRatio:'3:4',referenceId:'test-reference',autoCapture:true});start();
  let frameId=0;
  const frame=(extra={},delta=100)=>{time+=delta;c.frame({runId:c.runId,frameId:++frameId,time,mediaTime:time/1000,width:360,height:480,transform:identity(),valid:true,velocity:0,subjectKnown:true,subjectSafe:true,...extra});};
  const accept=()=>c.accept(c.runId,{schemaVersion:1,referenceId:'test-reference',plan});
  return {c,start,frame,accept,states,advance:ms=>{time+=ms;c.tick();},captures:()=>captures,release:()=>release?.()};
}
test('fresh stable frames pass alignment, zoom and settling; one commit only',async()=>{
  const r=rig();r.frame();assert.ok(r.accept());for(let i=0;i<25;i++)r.frame();await Promise.resolve();assert.equal(r.captures(),1);assert.ok(r.states.includes('ZOOMING'));assert.ok(r.states.includes('SETTLING'));
  for(let i=0;i<8;i++)r.frame();await Promise.resolve();assert.equal(r.captures(),1);r.release();await new Promise(r=>setImmediate(r));assert.equal(r.c.state,'REVIEW');
});
test('cancelled plan, stale Worker and capture completion cannot affect the next run',async()=>{
  const r=rig(),old=r.c.runId;r.c.cancel();assert.equal(r.c.accept(old,{schemaVersion:1,referenceId:'test-reference',plan}),false);r.start();r.frame({runId:old});assert.equal(r.c.latest,null);
  r.frame();r.accept();for(let i=0;i<25;i++)r.frame();await Promise.resolve();assert.equal(r.captures(),1);r.c.cancel();r.release();await new Promise(r=>setImmediate(r));assert.equal(r.c.state,'IDLE');
});
test('paused, duplicate, stale, lost or moving subject frames cannot accumulate stability',async()=>{
  for(const failure of ['paused','duplicate','stale','invalid','subject','motion','expired']){
    const r=rig();r.frame();r.accept();for(let i=0;i<4;i++)r.frame();
    if(failure==='paused')r.advance(301);
    if(failure==='duplicate'){for(let i=0;i<10;i++)r.frame({frameId:1});r.advance(301);}
    if(failure==='stale'){r.frame({time:-500});r.advance(301);}
    if(failure==='invalid')r.frame({valid:false});
    if(failure==='subject')for(let i=0;i<8;i++)r.frame({subjectSafe:false});
    if(failure==='motion')for(let i=0;i<30;i++)r.frame({velocity:.6});
    if(failure==='expired')r.advance(20001);
    await Promise.resolve();assert.equal(r.captures(),0,failure);
    assert.equal(r.c.state,failure==='motion'?'GUIDING':'LOST',failure);
  }
});
test('movement after zoom unlocks the crop; cancellation before capture microtask prevents capture',async()=>{
  const r=rig();r.frame();r.accept();while(r.c.state!=='ZOOMING')r.frame();assert.equal(r.c.state,'ZOOMING');r.frame({velocity:.6});assert.equal(r.c.state,'GUIDING');assert.equal(r.c.config,null);
  for(let i=0;i<25&&r.c.state!=='CAPTURING';i++)r.frame();assert.equal(r.c.state,'CAPTURING');r.c.cancel();await Promise.resolve();assert.equal(r.captures(),0);
});

test('small hand shake inside visible circle permits one capture; outer edge never aligns',async()=>{
  const r=rig();r.frame();r.accept();
  for(let i=0;i<25;i++)r.frame({transform:[1,0,20+(i%2?2:-2),0,1,0],velocity:.12});
  await Promise.resolve();assert.equal(r.captures(),1);assert.equal(r.c.state,'CAPTURING');
  r.c.cancel();r.release();
  const outside=rig();outside.frame();outside.accept();
  for(let i=0;i<25;i++)outside.frame({transform:[1,0,28,0,1,0],velocity:0});
  await Promise.resolve();assert.equal(outside.captures(),0);assert.equal(outside.c.state,'GUIDING');
});
test('temporary subject uncertainty recovers with the same reference; sustained uncertainty cancels',async()=>{
  const r=rig();r.frame();r.accept();const id=r.c.runId;
  for(let i=0;i<3;i++)r.frame({subjectSafe:false});
  assert.equal(r.c.state,'GUIDING');assert.equal(r.c.runId,id);assert.equal(r.c.abort.signal.aborted,false);
  for(let i=0;i<25;i++)r.frame();await Promise.resolve();assert.equal(r.captures(),1);
  r.c.cancel();r.release();
});
