import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionStep} from '../dist/guide-coach.js';
import {MotionSensor} from '../dist/motion-sensor.js';
const base={sx:0,sy:0,sw:1200,sh:1600};
const plan={subject:{box:{x:.3,y:.3,width:.4,height:.4}},crop:{centerX:.5,centerY:.5,scale:.8}};
test('image geometry chooses the correct physical camera direction, not inverted subject motion',()=>{
  for(const [tx,ty,action] of [[150,0,'right'],[-150,0,'left'],[0,-150,'up'],[0,150,'down'],[0,0,'hold']]){
    assert.equal(compositionStep(base,plan,[1,0,tx,0,1,ty]).action,action);
  }
  const large={...plan,subject:{box:{x:.01,y:.01,width:.98,height:.98}}};
  assert.equal(compositionStep(base,large,[1,0,0,0,1,0]).action,'back');
  assert.equal(compositionStep(base,large,[.9,0,60,0,.9,80],'back').action,'back');
  assert.equal(compositionStep(base,large,[.85,0,90,0,.85,120],'back').action,'hold');
});
test('composition reference preserves AI left/lower placement and fits all viewport ratios',()=>{
  const p={subject:{box:{x:.2,y:.6,width:.15,height:.25}},crop:{centerX:.5,centerY:.5,scale:1}};
  for(const sh of [1200,1600,1200*16/9]){
    const {goal,placement}=compositionStep({...base,sh},p,[1,0,0,0,1,0]);
    assert.ok(goal.x+goal.width/2<.42);assert.ok(goal.y+goal.height/2>.58);assert.match(placement,/左侧偏下/);
    assert.ok(goal.x>=0&&goal.y>=0&&goal.x+goal.width<=1&&goal.y+goal.height<=1);
  }
});
function sensorFixture(permission){
  let time=0;const listeners=new Set();
  const host={DeviceMotionEvent:{requestPermission:permission},addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn)};
  const sensor=new MotionSensor(host,()=>time);
  return {sensor,listeners,emit:e=>{for(const fn of listeners)fn(e);},advance:ms=>time+=ms};
}
test('motion permission denial, unsupported API and late permission completion install no listeners',async()=>{
  const denied=sensorFixture(async()=> 'denied');assert.equal(await denied.sensor.enable(),false);assert.equal(denied.listeners.size,0);
  assert.equal(await new MotionSensor({}).enable(),false);
  let finish;const late=sensorFixture(()=>new Promise(r=>finish=r));const pending=late.sensor.enable();late.sensor.stop();finish('granted');assert.equal(await pending,false);assert.equal(late.listeners.size,0);
});
test('motion input expires, ignores nulls, cleans up, and never claims travel distance',async()=>{
  const f=sensorFixture(async()=> 'granted');assert.equal(await f.sensor.enable(),true);
  f.emit({rotationRate:{alpha:null,beta:null,gamma:null},acceleration:{x:null,y:null,z:null}});assert.equal(f.sensor.feedback('back'),'');
  f.emit({rotationRate:{alpha:0,beta:24,gamma:0},acceleration:{x:0,y:0,z:0}});assert.match(f.sensor.feedback('back'),/保持镜头方向/);
  f.advance(501);assert.equal(f.sensor.feedback('back'),'');
  f.emit({rotationRate:{alpha:0,beta:0,gamma:0},acceleration:{x:0,y:0,z:3}});assert.match(f.sensor.feedback('back'),/主体为准/);assert.doesNotMatch(f.sensor.feedback('back'),/后退了|厘米|米/);
  f.sensor.stop();assert.equal(f.listeners.size,0);assert.equal(f.sensor.feedback('back'),'');f.sensor.start();assert.equal(f.listeners.size,1);
});

test('diagonal direction hysteresis keeps text and arrow consistent but reverses when needed',()=>{
  const first=compositionStep(base,plan,[1,0,130,0,1,135],'right');assert.equal(first.action,'right');assert.equal(first.arrow,'→');assert.match(first.message,/向右/);
  const reversed=compositionStep(base,plan,[1,0,-150,0,1,0],'right');assert.equal(reversed.action,'left');assert.equal(reversed.arrow,'←');
});

test('framing mode preserves subject size and does not ask to step back just to fit a portrait template',()=>{
  const p={subject:{box:{x:.01,y:.01,width:.98,height:.98}},crop:{centerX:.5,centerY:.5,scale:1},framing:{subjectX:.5,subjectY:.5}};
  const step=compositionStep(base,p,[1,0,0,0,1,0]);assert.equal(step.action,'hold');assert.equal(step.goal.width,.98);assert.equal(step.goal.height,.98);
  const distant={...p,subject:{box:{x:.45,y:.4,width:.1,height:.2}},framing:{subjectX:.65,subjectY:.65}};
  const small=compositionStep(base,distant,[1,0,0,0,1,0]);assert.equal(small.goal.width,.1);assert.equal(small.goal.height,.2);assert.match(small.message,/保持当前距离/);assert.match(small.placement,/右侧偏下/);
});
