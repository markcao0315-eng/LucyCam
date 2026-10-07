import {point} from './guide-geometry.js';
export const median = a => a.length ? [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)] : Infinity;
function fit(pairs) {
  const n=pairs.length;
  if(n<2)return null;
  let x=0,y=0,u=0,v=0;
  for(const p of pairs){x+=p.x;y+=p.y;u+=p.u;v+=p.v;}
  x/=n;y/=n;u/=n;v/=n;
  let den=0,a=0,b=0;
  for(const p of pairs){const dx=p.x-x,dy=p.y-y,du=p.u-u,dv=p.v-v;den+=dx*dx+dy*dy;a+=dx*du+dy*dv;b+=dx*dv-dy*du;}
  if(den<1e-6)return null;
  a/=den;b/=den;
  return [a,-b,u-a*x+b*y,b,a,v-b*x-a*y];
}
export const residual = (m,p) => {const q=point(m,p);return Math.hypot(q.x-p.u,q.y-p.v);};
function fitAffine(pairs){
  if(pairs.length<3)return null;
  const n=pairs.length,mean=key=>pairs.reduce((s,p)=>s+p[key],0)/n;
  const x=mean('x'),y=mean('y'),u=mean('u'),v=mean('v');
  let xx=0,xy=0,yy=0,xu=0,yu=0,xv=0,yv=0;
  for(const p of pairs){const dx=p.x-x,dy=p.y-y,du=p.u-u,dv=p.v-v;xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;xu+=dx*du;yu+=dy*du;xv+=dx*dv;yv+=dy*dv;}
  const det=xx*yy-xy*xy;if(det<1e-6||det/(xx*yy)<.01)return null;
  const a=(xu*yy-yu*xy)/det,c=(yu*xx-xu*xy)/det,b=(xv*yy-yv*xy)/det,d=(yv*xx-xv*xy)/det;
  return [a,c,u-a*x-c*y,b,d,v-b*x-d*y];
}
// Background affine flow accounts for mild camera tilt/shear as well as pan/roll.
export function estimateAffine(pairs,threshold=2.5){
  if(pairs.length<6)return null;
  let best=[],seed=73;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%pairs.length;};
  for(let i=0;i<200;i++){
    const sample=[pairs[rand()],pairs[rand()],pairs[rand()]],m=fitAffine(sample);if(!m)continue;
    const inliers=pairs.filter(p=>residual(m,p)<=threshold);if(inliers.length>best.length)best=inliers;
  }
  const matrix=fitAffine(best);if(!matrix)return null;
  const inliers=pairs.filter(p=>residual(matrix,p)<=threshold),refined=fitAffine(inliers);if(!refined)return null;
  return {matrix:refined,inliers,ratio:inliers.length/pairs.length,residual:median(inliers.map(p=>residual(refined,p)))};
}
export function estimateSimilarity(pairs,threshold=2) {
  if(pairs.length<4)return null;
  let best=[],seed=73;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%pairs.length;};
  for(let i=0;i<160;i++){
    const p=pairs[rand()],q=pairs[rand()];
    if(Math.hypot(p.x-q.x,p.y-q.y)<12)continue;
    const m=fit([p,q]);if(!m)continue;
    const inliers=pairs.filter(p=>residual(m,p)<=threshold);
    if(inliers.length>best.length)best=inliers;
  }
  const matrix=fit(best);if(!matrix)return null;
  const inliers=pairs.filter(p=>residual(matrix,p)<=threshold);
  const refined=fit(inliers);if(!refined)return null;
  return {matrix:refined,inliers,ratio:inliers.length/pairs.length,residual:median(inliers.map(p=>residual(refined,p)))};
}
export function coverage(pairs,width,height) {
  const cells=new Set(pairs.map(p=>`${Math.min(3,Math.floor(p.x/width*4))}:${Math.min(3,Math.floor(p.y/height*4))}`));
  return cells.size/16;
}
