import test from 'node:test';
import assert from 'node:assert/strict';
import {styles,applyStyle,applyLighting,subjectMask} from '../dist/photo-styles.js';
import {applyLook} from '../dist/photo-utils.js';
import {validateGuidePlan} from '../dist/guide-plan.js';
const mean=(p,i=0)=>(p[i]+p[i+1]+p[i+2])/3;
test('scene looks are visibly distinct on the same colors, alpha is unchanged and zero is an exact original',()=>{
  const source=new Uint8ClampedArray([30,50,60,211,90,145,65,255,185,128,100,255,238,230,218,128]);
  const renders=styles.map(s=>{const p=source.slice();applyStyle(p,s.id,85);assert.ok([...p].every(Number.isFinite));for(let i=3;i<p.length;i+=4)assert.equal(p[i],source[i]);return p;});
  for(let i=0;i<renders.length;i++)for(let j=i+1;j<renders.length;j++)assert.ok(renders[i].reduce((sum,v,k)=>sum+(k%4===3?0:Math.abs(v-renders[j][k])),0)>35,'looks need a measurable distinction, not a renamed preset');
  for(const s of styles){const p=source.slice();applyStyle(p,s.id,0);assert.deepEqual(p,source);}
  const forest=renders[1],travel=renders[0];assert.ok(mean(forest,4)<mean(travel,4)-15,'forest foliage is deeper than airy travel');
  for(const p of renders){assert.ok(p[8]>p[9]&&p[9]>p[10],'warm skin-like colors should not turn green/blue');assert.ok(mean(p,12)>200,'bright details must remain bright');}
  assert.throws(()=>applyStyle(source,'forest',Infinity));
});
test('color curves remain ordered across a neutral ramp and avoid clipping midtones',()=>{
  const ramp=new Uint8ClampedArray(256*4);for(let i=0;i<256;i++)ramp.set([i,i,i,255],i*4);
  for(const s of styles){const p=ramp.slice();applyStyle(p,s.id,100);for(let i=1;i<256;i++)assert.ok(mean(p,i*4)>=mean(p,(i-1)*4)-.7);for(let i=32;i<225;i++)assert.ok(mean(p,i*4)>0&&mean(p,i*4)<255);}
});
test('local light follows image colors inside the subject region, skips indistinguishable scenes, preserves highlights',()=>{
  const w=100,h=100,p=new Uint8ClampedArray(w*h*4),box={x:.2,y:.2,width:.6,height:.6};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)p.set(x>35&&x<65&&y>25&&y<75?[150,98,70,240]:[40,75,100,255],(y*w+x)*4);
  const mask=subjectMask(p,w,h,box);assert.ok(mask&&mask.confidence>.1);
  const center=(50*w+50)*4,insideBackground=(50*w+25)*4,before=p.slice();
  assert.equal(applyLighting(p,w,h,box,{subjectEV:.4,backgroundEV:-.2}),true);
  assert.ok(mean(p,center)>mean(before,center));assert.ok(mean(p,insideBackground)<mean(before,insideBackground),'box background is not blindly brightened');assert.equal(p[center+3],240);
  const uniform=new Uint8ClampedArray(w*h*4).fill(150),copy=uniform.slice();assert.equal(applyLighting(uniform,w,h,box,{subjectEV:.4,backgroundEV:-.2}),false);assert.deepEqual(uniform,copy);
  assert.throws(()=>applyLighting(p,w,h,box,{subjectEV:1}));
  assert.throws(()=>applyLighting(p,w,h,box,{subjectEV:NaN}));
});
test('all edits can be removed exactly by re-rendering the retained original',()=>{
  const raw=new Uint8ClampedArray([100,160,70,255,204,152,118,255]),first=raw.slice();applyLook(first,{id:'forest',strength:85},{exposure:.2,contrast:4,saturation:0});assert.notDeepEqual(first,raw);
  const restored=raw.slice();applyLook(restored,{id:'original',strength:0},{exposure:0,contrast:0,saturation:0});assert.deepEqual(restored,raw);
});
test('candidate compositions and local edits are bounded, contained and keep legacy plans compatible',()=>{
  const plan={canGuide:true,subject:{label:'花园中的人',box:{x:.55,y:.4,width:.15,height:.3}},crop:{centerX:.55,centerY:.5,scale:.7},filter:{id:'forest',strength:85},advice:'保留人物与花丛。',lighting:{subjectEV:.3,backgroundEV:-.15},alternatives:[{label:'更多环境',reason:'保留小路的走向。',crop:{centerX:.5,centerY:.5,scale:1}}]};
  assert.equal(validateGuidePlan(plan,{scene:'portrait'}).filter.strength,85);
  for(const bad of [{lighting:{subjectEV:.7,backgroundEV:0}},{alternatives:[{...plan.alternatives[0],crop:{centerX:.2,centerY:.5,scale:.4}}]},{alternatives:[...plan.alternatives,...plan.alternatives,...plan.alternatives]}])assert.throws(()=>validateGuidePlan({...plan,...bad}));
});
