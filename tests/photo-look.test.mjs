import test from 'node:test';import assert from 'node:assert/strict';import {applyLook,applyAdjustments} from '../dist/photo-utils.js';
test('exposure edits linear light, leaves alpha unchanged and neutral restores raw pixels',()=>{
 const raw=new Uint8ClampedArray([80,100,120,211,180,200,220,255]),p=raw.slice();applyLook(p,{id:'original',strength:0},{exposure:1,contrast:0,saturation:0});assert.ok(p[0]>105&&p[0]<120);assert.equal(p[3],211);assert.ok(p[6]>raw[6]);
 const restored=raw.slice();applyLook(restored,{id:'original',strength:0},{exposure:0,contrast:0,saturation:0});assert.deepEqual(restored,raw);
 const mono=raw.slice();applyLook(mono,{id:'mono',strength:100},{exposure:.4,contrast:10,saturation:5});assert.equal(mono[0],mono[1]);assert.equal(mono[1],mono[2]);
 assert.throws(()=>applyAdjustments(p,{exposure:Infinity}));assert.throws(()=>applyAdjustments(p,{saturation:51}));
});
