import test from 'node:test';
import assert from 'node:assert/strict';
import {cropRect,outputSize,applyPixels,cssFilter} from '../dist/photo-utils.js';
test('portrait crop matches object-fit cover, and square crops are centered',()=>{assert.deepEqual(cropRect(1920,1080,3/4),{sx:555,sy:0,sw:810,sh:1080});assert.deepEqual(cropRect(1080,1920,1),{sx:0,sy:420,sw:1080,sh:1080});});
test('export limits decoded image memory without upscaling small images',()=>{const size=outputSize(8000,6000);assert.ok(size.width*size.height<=8_000_000);assert.ok(size.width<=4096);assert.deepEqual(outputSize(640,480),{width:640,height:480});});
test('original and zero strength preserve every pixel including alpha',()=>{for(const [id,strength] of [['original',100],['warm',0]]){const p=new Uint8ClampedArray([13,42,180,255,255,0,122,128]);const original=p.slice();applyPixels(p,id,strength);assert.deepEqual(p,original);}});
test('black and white produces equal channels while retaining alpha',()=>{const p=new Uint8ClampedArray([222,44,18,217]);applyPixels(p,'mono',100);assert.equal(p[0],p[1]);assert.equal(p[1],p[2]);assert.equal(p[3],217);});
test('rejects invalid dimensions, filters and strength',()=>{assert.throws(()=>cropRect(0,20,1));assert.throws(()=>cssFilter('fake',70));assert.throws(()=>cssFilter('warm',101));});
