import {cropRect} from './photo-utils.js';

export const GUIDE_TUNING=Object.freeze({radius:.075,alignMs:400,zoomMs:450,settleMs:300,subjectGraceMs:600,maxVelocity:.35});
export function previewCrop(base,config,state,zoomStarted,time){
  if(!config)return base;
  const t=state==='ZOOMING'?Math.min(1,Math.max(0,(time-zoomStarted)/GUIDE_TUNING.zoomMs)):1,eased=t*t*(3-2*t),crop={};
  for(const key of ['sx','sy','sw','sh'])crop[key]=base[key]+(config.crop[key]-base[key])*eased;
  return crop;
}

// Row-major affine matrix mapping reference pixels into current pixels.
export const identity = () => [1, 0, 0, 0, 1, 0];
export const point = (m, p) => ({x: m[0]*p.x+m[1]*p.y+m[2], y: m[3]*p.x+m[4]*p.y+m[5]});
export function multiply(a, b) {
  return [a[0]*b[0]+a[1]*b[3], a[0]*b[1]+a[1]*b[4], a[0]*b[2]+a[1]*b[5]+a[2],
    a[3]*b[0]+a[4]*b[3], a[3]*b[1]+a[4]*b[4], a[3]*b[2]+a[4]*b[5]+a[5]];
}
export function inverse(m) {
  const d=m[0]*m[4]-m[1]*m[3];
  if (!Number.isFinite(d) || Math.abs(d)<1e-10) throw new Error('不可逆的画面变换');
  return [m[4]/d,-m[1]/d,(m[1]*m[5]-m[4]*m[2])/d,-m[3]/d,m[0]/d,(m[3]*m[2]-m[0]*m[5])/d];
}
export const scaleMatrix = (x,y=x) => [x,0,0,0,y,0];
export const fullTransform = (h, source, tracking, current=source, currentTracking=tracking) =>
  multiply(scaleMatrix(current.width/currentTracking.width,current.height/currentTracking.height),
    multiply(h,scaleMatrix(tracking.width/source.width,tracking.height/source.height)));
export const referencePoint = (base,x,y) => ({x:base.sx+x*base.sw,y:base.sy+y*base.sh});
export function displayPoint(p,crop,width,height,mirrored=false) {
  const u=(p.x-crop.sx)/crop.sw,v=(p.y-crop.sy)/crop.sh;
  return {x:(mirrored?1-u:u)*width,y:v*height};
}
export function fromDisplay(p,crop,width,height,mirrored=false) {
  return referencePoint(crop,mirrored?1-p.x/width:p.x/width,p.y/height);
}
export function alignmentDistance(p,crop) {
  return Math.hypot(p.x-crop.sx-crop.sw/2,p.y-crop.sy-crop.sh/2)/Math.min(crop.sw,crop.sh);
}
export function boxCorners(base,box) {
  return [[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]].map(([x,y])=>referencePoint(base,x,y));
}
export function lockCrop({width,height,ratio,base,plan,transform}) {
  const {centerX,centerY,scale}=plan.crop;
  const center=point(transform,referencePoint(base,centerX,centerY));
  const corners=boxCorners(base,{x:centerX-scale/2,y:centerY-scale/2,width:scale,height:scale}).map(p=>point(transform,p));
  const viewport=cropRect(width,height,ratio);
  let k=Math.max(...corners.map(p=>Math.max(2*Math.abs(p.x-center.x)/viewport.sw,2*Math.abs(p.y-center.y)/viewport.sh)));
  const quality=Math.max(720/Math.min(viewport.sw,viewport.sh),Math.sqrt(1e6/(viewport.sw*viewport.sh)));
  k=Math.max(k,.5,Math.min(1,quality));
  if (k>1+1e-6) throw new Error('当前角度无法容纳建议构图，请重新分析。');
  k=Math.min(1,k);
  const sw=viewport.sw*k,sh=viewport.sh*k;
  let sx=center.x-sw/2,sy=center.y-sh/2;
  const epsilon=1e-5;
  if(sx < -epsilon || sy < -epsilon || sx+sw>width+epsilon || sy+sh>height+epsilon) throw new Error('裁切越界，请继续对准或重新分析。');
  sx=Math.max(0,Math.min(width-sw,sx));sy=Math.max(0,Math.min(height-sh,sy));
  const subject=boxCorners(base,plan.subject.box).map(p=>point(transform,p));
  if(subject.some(p=>p.x<sx-epsilon||p.x>sx+sw+epsilon||p.y<sy-epsilon||p.y>sy+sh+epsilon)) throw new Error('无法完整保留主体，请重新分析。');
  return Object.freeze({sx,sy,sw,sh});
}

export function motionBetween(a,b,width,height) {
  return Math.max(...[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height},{x:width/2,y:height/2}].map(p=>{
    const x=point(a,p),y=point(b,p);return Math.hypot(x.x-y.x,x.y-y.y);
  }))/Math.min(width,height);
}
