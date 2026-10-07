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
