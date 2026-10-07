import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverGuidePlan} from '../dist/guide-recovery.js';
import {validateGuidePlan} from '../dist/guide-plan.js';
import {localComposition} from '../dist/local-composition.js';
import {GuideController} from '../dist/guide-controller.js';
import {identity} from '../dist/guide-geometry.js';

const plan={canGuide:true,subject:{label:'人物与环境',box:{x:.3,y:.3,width:.4,height:.4}},crop:{centerX:.5,centerY:.5,scale:.8},filter:{id:'forest',strength:85},advice:'保留人物与背景关系。'};
test('one invalid alternative cannot discard the primary composition or valid look',()=>{
  const good={label:'环境',reason:'多留环境',crop:{centerX:.5,centerY:.5,scale:1}};
  const r=recoverGuidePlan({...plan,alternatives:[{...good,crop:{centerX:.95,centerY:.5,scale:.6}},good]});
  assert.deepEqual(r.plan.crop,plan.crop);assert.deepEqual(r.plan.filter,plan.filter);assert.deepEqual(r.plan.alternatives,[good]);
  assert.deepEqual(r.recovery,{source:'repaired',issues:['alternative_0_dropped']});
});
test('repair crop jointly preserves the complete focus and stays inside the reference',()=>{
  let seed=46;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<300;i++){
    const x=rand()*.9,y=rand()*.9,width=rand()*(1-x),height=rand()*(1-y);
    const raw={...plan,subject:{label:'合影',box:{x,y,width,height}},crop:{centerX:rand()*3-1,centerY:rand()*3-1,scale:rand()*2-.5}};
    const r=recoverGuidePlan(raw);assert.ok(r.plan);assert.deepEqual(r.plan.subject.box,raw.subject.box);assert.doesNotThrow(()=>validateGuidePlan(r.plan));
  }
});
test('bad styling repairs independently; diagnostics do not echo model content',()=>{
  const r=recoverGuidePlan({...plan,filter:{id:'url(secret)',strength:NaN},adjustments:{exposure:9,contrast:NaN,saturation:-80},lighting:{subjectEV:Infinity},alternatives:null});
  assert.deepEqual(r.plan.crop,plan.crop);assert.deepEqual(r.plan.filter,{id:'original',strength:0});
  assert.deepEqual(r.plan.adjustments,{exposure:1,contrast:0,saturation:-30});assert.deepEqual(r.plan.lighting,{subjectEV:0,backgroundEV:0});
  assert.doesNotMatch(JSON.stringify(r.recovery),/secret|url/);assert.doesNotThrow(()=>validateGuidePlan(r.plan));
});
test('missing focus and refusal request local pixels instead of inventing a subject',()=>{
  for(const raw of [null,{}, {...plan,canGuide:false}, {...plan,subject:{box:{x:NaN}}}]){
    const r=recoverGuidePlan(raw);assert.equal(r.plan,null);assert.equal(r.recovery.source,'local');
  }
});
function pixels({offset=0,blank=false}={}){
  const width=72,height=96,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,value=!blank&&x>10+offset&&x<44+offset&&y>35&&y<85?((x+y)%8<4?35:160):210;
    data.set([value,value,value,255],i);
  }return {data,width,height};
}
test('local structure comes from actual pixel locations; unknown people retain full view',()=>{
  const left=localComposition(pixels(),{scene:'landscape'}),right=localComposition(pixels({offset:15}),{scene:'landscape'});
  assert.equal(left.textured,true);assert.ok(right.plan.subject.box.x>left.plan.subject.box.x+.15);
  assert.equal(left.plan.compositionKind,'structure');assert.ok(left.plan.crop.centerY>.5);
  assert.equal(localComposition(pixels()).plan.crop.scale,1);
  assert.equal(localComposition(pixels({blank:true})).textured,false);
  assert.throws(()=>localComposition({data:[],width:72,height:96}));
});
function controller(){
  let time=0,id=0,shots=0;
  const c=new GuideController({now:()=>time,capture:async()=>{shots++;}});
  c.start({width:1440,height:1920,ratio:.75,aspectRatio:'3:4',referenceId:'ref',autoCapture:true});
  const frame=(extra={})=>{time+=100;c.frame({runId:c.runId,frameId:++id,mediaTime:time/1000,time,width:360,height:480,valid:true,transform:identity(),velocity:0,subjectKnown:false,subjectSafe:false,structureSafe:true,...extra});};
  return {c,frame,shots:()=>shots,advance:ms=>{time+=ms;}};
}
test('structure uses verified scene anchors; missing structure evidence never auto shoots',async()=>{
  for(const reliable of [true,false]){
    const r=controller();r.c.accept(r.c.runId,{schemaVersion:1,referenceId:'ref',plan:{...plan,compositionKind:'structure'}});
    for(let i=0;i<25;i++)r.frame({structureSafe:reliable});await Promise.resolve();
    assert.equal(r.shots(),reliable?1:0);r.c.cancel();
  }
});
test('local recovery rejects wrong references and cannot revive a cancelled run',()=>{
  const r=controller();r.c.fallback=localComposition(pixels());
  assert.equal(r.c.accept(r.c.runId,{schemaVersion:1,referenceId:'other',plan:null}),false);assert.equal(r.c.state,'LOST');
  const id=r.c.runId;r.c.cancel();assert.equal(r.c.accept(id,{schemaVersion:1,referenceId:'ref',plan:null}),false);assert.equal(r.shots(),0);
});
test('blank reference gives live guidance and explicit fresh-frame shutter, never fake auto alignment',async()=>{
  const r=controller();r.c.fallback=localComposition(pixels({blank:true}));r.frame({valid:false,initial:true});
  r.c.accept(r.c.runId,{schemaVersion:1,referenceId:'ref',plan:null});
  for(let i=0;i<25;i++)r.frame({valid:false});assert.equal(r.c.state,'FRAMING');assert.equal(r.c.target,null);assert.equal(r.shots(),0);
  r.advance(650);r.c.commit();await Promise.resolve();assert.equal(r.shots(),0);
  r.frame({valid:false});r.c.commit();await Promise.resolve();assert.equal(r.shots(),1);r.c.cancel();
});


test('room-wide structural lines may be cropped; people keep complete protection',()=>{
  const raw={...plan,subject:{label:'空间',box:{x:0,y:0,width:1,height:1}},crop:{centerX:.5,centerY:.5,scale:.75}};
  assert.equal(recoverGuidePlan(raw).plan.crop.scale,1);
  const result=recoverGuidePlan({...raw,compositionKind:'structure'});assert.equal(result.plan.crop.scale,.75);assert.doesNotThrow(()=>validateGuidePlan(result.plan));
  assert.throws(()=>validateGuidePlan({...raw,compositionKind:'structure',subject:{label:'离开区域',box:{x:0,y:0,width:.01,height:.01}}}));
});

test('rebase accepts only new local reference packets and preserves cancellation',async()=>{
  const r=controller();r.c.fallback=localComposition(pixels({blank:true}));r.frame({valid:false,initial:true});r.c.accept(r.c.runId,{schemaVersion:1,referenceId:'ref',plan:null});
  assert.ok(r.c.resumeLocal(localComposition(pixels()),10));
  for(let i=0;i<5;i++)r.frame();assert.equal(r.c.latest,null);assert.equal(r.shots(),0);
  for(let i=0;i<30;i++)r.frame();await Promise.resolve();assert.equal(r.shots(),1);r.c.cancel();
  assert.equal(r.c.resumeLocal(localComposition(pixels()),50),false);assert.equal(r.c.state,'IDLE');
});
