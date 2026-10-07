export const geometryTolerance=1e-6;
export const filterIds=['original','clear','warm','film','mono'];
const text=value=>typeof value==='string'&&value.trim().length>0;
export function validateGuidePlan(p,{scene}={}){
  const bad=()=>{throw new Error('AI 构图数据无效，请重新分析。');};
  if(!p||typeof p.canGuide!=='boolean'||!text(p.subject?.label)||p.subject.label.length>100||!text(p.advice)||p.advice.length>300)bad();
  const b=p.subject.box,c=p.crop,f=p.filter;
  if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>1+geometryTolerance||b.y+b.height>1+geometryTolerance)bad();
  if(!c||!['centerX','centerY','scale'].every(k=>Number.isFinite(c[k]))||c.scale<.5||c.scale>1||
    c.centerX<c.scale/2-geometryTolerance||c.centerY<c.scale/2-geometryTolerance||c.centerX>1-c.scale/2+geometryTolerance||c.centerY>1-c.scale/2+geometryTolerance)bad();
  if(!f||!filterIds.includes(f.id)||!Number.isInteger(f.strength)||f.strength<0||f.strength>100)bad();
  if((f.id==='original'&&f.strength!==0)||(scene==='portrait'&&f.strength>40))bad();
  if(!p.canGuide&&(c.centerX!==.5||c.centerY!==.5||c.scale!==1||f.id!=='original'||f.strength!==0))bad();
  if(p.canGuide&&(b.x<c.centerX-c.scale/2-geometryTolerance||b.y<c.centerY-c.scale/2-geometryTolerance||b.x+b.width>c.centerX+c.scale/2+geometryTolerance||b.y+b.height>c.centerY+c.scale/2+geometryTolerance))bad();
  return {canGuide:p.canGuide,subject:{label:p.subject.label.trim(),box:{x:b.x,y:b.y,width:b.width,height:b.height}},crop:{centerX:c.centerX,centerY:c.centerY,scale:c.scale},filter:{id:f.id,strength:f.strength},advice:p.advice.trim()};
}
const number={type:'number'};
export const guideSchema={type:'object',additionalProperties:false,required:['canGuide','subject','crop','filter','advice'],properties:{
  canGuide:{type:'boolean'},advice:{type:'string',maxLength:300},
  subject:{type:'object',additionalProperties:false,required:['label','box'],properties:{label:{type:'string',maxLength:100},box:{type:'object',additionalProperties:false,required:['x','y','width','height'],properties:{x:number,y:number,width:number,height:number}}}},
  crop:{type:'object',additionalProperties:false,required:['centerX','centerY','scale'],properties:{centerX:number,centerY:number,scale:{type:'number',minimum:.5,maximum:1}}},
  filter:{type:'object',additionalProperties:false,required:['id','strength'],properties:{id:{type:'string',enum:filterIds},strength:{type:'integer',minimum:0,maximum:100}}}
}};
