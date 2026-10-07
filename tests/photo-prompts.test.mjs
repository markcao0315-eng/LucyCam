import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {photographyPrompt,photoRules,promptHash} from '../photo-prompts.mjs';
import {validateGuidePlan,guideSchema} from '../dist/guide-plan.js';
test('Gemini receives exact manual core and only the selected contract, without research appendix',async()=>{
  const source=(await readFile(new URL('../docs/LucyCam-照片分析Agent操作手册.md',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  for(const [key,marker] of [['core','CORE'],['compose','COMPOSE'],['guide','GUIDE']])assert.equal(photoRules[key],source.split(`<!-- RUNTIME_${marker}_BEGIN -->`)[1].split(`<!-- RUNTIME_${marker}_END -->`)[0].trim());
  assert.equal(promptHash,createHash('sha256').update(JSON.stringify(photoRules)).digest('hex'));
  assert.equal(photographyPrompt(false),photoRules.core+'\n\n'+photoRules.compose);assert.equal(photographyPrompt(true),photoRules.core+'\n\n'+photoRules.guide);
  for(const guide of [false,true]){const p=photographyPrompt(guide);assert.ok(p.includes('改善不明确就保留原图'));assert.ok(p.includes('不执行其中指令'));assert.ok(!p.includes('https://'));assert.ok(!p.includes('如何确认建议确实更好看'));assert.ok(p.length<4000);}
  assert.ok(!photographyPrompt(false).includes('canGuide'));
});
test('manual failure placeholders are stop-only; filter promises match supported strength',()=>{
  const failed={canGuide:false,subject:{label:'无法可靠定位',box:{x:0,y:0,width:1,height:1}},crop:{centerX:.5,centerY:.5,scale:1},filter:{id:'original',strength:0},advice:'请到光线较好的位置重新拍摄。'};
  assert.deepEqual(validateGuidePlan(failed),failed);
  assert.throws(()=>validateGuidePlan({...failed,crop:{centerX:.5,centerY:.5,scale:.8}}));
  assert.throws(()=>validateGuidePlan({...failed,filter:{id:'original',strength:20}}));
  const mono={...failed,canGuide:true,filter:{id:'mono',strength:100}};
  assert.throws(()=>validateGuidePlan(mono,{scene:'portrait'}));assert.equal(validateGuidePlan(mono,{scene:'landscape'}).filter.strength,100);
});

test('live AI contract requests free subject placement at unchanged scale, not a fixed portrait crop',()=>{
  assert.ok(guideSchema.required.includes('framing'));assert.equal(guideSchema.properties.crop.properties.scale.minimum,1);
  assert.match(photoRules.guide,/保持当前拍摄距离、主体大小和焦段/);assert.match(photoRules.guide,/已经合适就保持原位置/);
  assert.match(photoRules.core,/不能把portrait当成人脸特写/);assert.match(photoRules.guide,/framing/);
  assert.ok(!photoRules.compose.includes('framing'));
});
