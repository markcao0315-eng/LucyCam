import {boxCorners,point,lockCrop} from './guide-geometry.js';
// Convert AI regions once into coordinates of the actual shutter frame.
export function captureComposition(controller){
  const {config,base,plan,transform,width,height,ratio,zoomMode}=controller;
  if(controller.frameOnly)return {subjectBox:null,crops:[{label:'完整取景',reason:plan.advice,crop:config.crop}],requestedZoom:1,actualZoom:1,adjusted:false,zoomMode};
  const points=boxCorners(base,plan.subject.box).map(p=>point(transform,p)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const subjectBox={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  const crops=[{label:controller.source==='local'?'本地建议':'AI 推荐',reason:plan.advice,crop:config.crop}];
  for(const candidate of plan.alternatives||[]){
    try{
      const crop=lockCrop({width,height,ratio,base,transform,zoomMode,plan:{...plan,crop:candidate.crop}});
      // Do not display several identical views after safety/quality expansion.
      if(crops.some(c=>Math.abs(c.crop.sx-crop.sx)+Math.abs(c.crop.sy-crop.sy)+Math.abs(c.crop.sw-crop.sw)<3))continue;
      crops.push({label:candidate.label,reason:candidate.reason,crop});
    }catch{/* A candidate can leave the sensor after the user moves; omit it. */}
  }
  return {subjectBox,crops,requestedZoom:1/plan.crop.scale,actualZoom:base.sw/config.crop.sw,adjusted:config.crop.adjusted,zoomMode};
}
