import {protectedRegion} from './composition-region.js';
import {filterIds,validateGuidePlan,geometryTolerance} from './guide-plan.js';

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const finite=(v,keys)=>v&&keys.every(k=>Number.isFinite(v[k]));
const label=(v,max,fallback)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):fallback;

// Repair model preferences BEFORE tracking begins. Never repair a stale reference
// or mutate geometry already being used to judge alignment / capture.
export function recoverGuidePlan(raw){
  const issues=[];
  const local=code=>({plan:null,recovery:{source:'local',issues:[...issues,code]}});
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return local('plan_missing');
  if(raw.canGuide!==true)return local('scene_unresolved');
  const b=raw.subject?.box;
  if(!finite(b,['x','y','width','height'])||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>1+geometryTolerance||b.y+b.height>1+geometryTolerance)return local('focus_invalid');
  const box={x:b.x,y:b.y,width:Math.min(b.width,1-b.x),height:Math.min(b.height,1-b.y)};
  let crop;
  if(finite(raw.crop,['centerX','centerY','scale'])){
    const structure=raw.compositionKind==='structure';
    const s=clamp(structure?raw.crop.scale:Math.max(raw.crop.scale,box.width,box.height),.2,1);
    crop=structure?{scale:s,centerX:clamp(raw.crop.centerX,s/2,1-s/2),centerY:clamp(raw.crop.centerY,s/2,1-s/2)}:{scale:s,
      centerX:clamp(raw.crop.centerX,Math.max(s/2,box.x+box.width-s/2),Math.min(1-s/2,box.x+s/2)),
      centerY:clamp(raw.crop.centerY,Math.max(s/2,box.y+box.height-s/2),Math.min(1-s/2,box.y+s/2))};
    const core=protectedRegion({...raw,subject:{box},crop});
    if(core.width<=0||core.height<=0)crop={centerX:.5,centerY:.5,scale:1};
    if(['scale','centerX','centerY'].some(k=>Math.abs(crop[k]-raw.crop[k])>geometryTolerance))issues.push('crop_fitted');
  }else{crop={centerX:.5,centerY:.5,scale:1};issues.push('crop_rebuilt');}
  let filter;
  if(filterIds.includes(raw.filter?.id)){
    filter={id:raw.filter.id,strength:raw.filter.id==='original'?0:Math.round(clamp(Number.isFinite(raw.filter.strength)?raw.filter.strength:70,0,100))};
    if(filter.strength!==raw.filter.strength)issues.push('filter_strength');
  }else{filter={id:'original',strength:0};issues.push('filter_unknown');}
  const bounded=(value,limits,code)=>{
    if(value===undefined)return undefined;
    const result={};
    for(const [key,max] of Object.entries(limits))result[key]=Number.isFinite(value?.[key])?clamp(value[key],-max,max):0;
    if(Object.keys(limits).some(k=>result[k]!==value?.[k]))issues.push(code);
    return result;
  };
  const plan={canGuide:true,subject:{label:label(raw.subject.label,100,'画面中的主要内容'),box},crop,filter,
    advice:label(raw.advice,300,'保留主要内容，按目标圈轻转镜头。')};
  if(['subject','structure'].includes(raw.compositionKind))plan.compositionKind=raw.compositionKind;
  else if(raw.compositionKind!==undefined)issues.push('composition_kind');
  for(const [key,limits] of [['adjustments',{exposure:1,contrast:30,saturation:30}],['lighting',{subjectEV:.6,backgroundEV:.4}]]){
    const value=bounded(raw[key],limits,key);if(value)plan[key]=value;
  }
  if(raw.lookReason!==undefined)plan.lookReason=label(raw.lookReason,200,'保留当前色彩，可在拍后调整风格。');
  if(raw.framing!==undefined){
    try{validateGuidePlan({...plan,framing:raw.framing});plan.framing=raw.framing;}catch{issues.push('framing_dropped');}
  }
  if(raw.alternatives!==undefined){
    plan.alternatives=[];
    if(!Array.isArray(raw.alternatives))issues.push('alternatives_invalid');
    else{
      if(raw.alternatives.length>2)issues.push('alternatives_excess');
      for(const [index,v] of raw.alternatives.slice(0,2).entries()){
        try{
          const checked=validateGuidePlan({...plan,framing:undefined,alternatives:[v]});
          plan.alternatives.push(checked.alternatives[0]);
        }catch{issues.push(`alternative_${index}_dropped`);}
      }
    }
  }
  // Unknown fields and model text never enter diagnostics. Final validation is
  // shared with the browser; repairs cannot weaken the execution contract.
  try{return {plan:validateGuidePlan(plan),recovery:{source:issues.length?'repaired':'ai',issues}};}
  catch{return local('plan_unusable');}
}
