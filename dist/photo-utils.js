import {styles,styleIds,applyStyle,applyLighting} from './photo-styles.js';
export const filters = [
  {id:'original',name:'原片',ops:[]},
  {id:'clear',name:'清透',ops:[['brightness',1.06],['contrast',1.04],['saturate',1.08]]},
  {id:'warm',name:'暖阳',ops:[['sepia',.28],['saturate',1.1],['brightness',1.04]]},
  {id:'film',name:'胶片',ops:[['sepia',.16],['saturate',.78],['contrast',.86],['brightness',1.08]]},
  {id:'mono',name:'黑白',ops:[['saturate',0],['contrast',1.12]]},
  {id:'vivid',name:'鲜活',ops:[['contrast',1.08],['saturate',1.3]]}
];
export const looks=[...styles,...filters];
export function cropRect(width,height,ratio){
  if(!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(ratio)||width<=0||height<=0||ratio<=0)throw new Error('无效的照片尺寸');
  let sw=width,sh=height;if(width/height>ratio)sw=height*ratio;else sh=width/ratio;
  return {sx:(width-sw)/2,sy:(height-sh)/2,sw,sh};
}
export function outputSize(width,height){const scale=Math.min(1,4096/Math.max(width,height),Math.sqrt(8_000_000/(width*height)));return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};}
export function filterOps(id,strength){const filter=filters.find(f=>f.id===id);if(!filter||!Number.isFinite(strength)||strength<0||strength>100)throw new Error('无效的滤镜设置');return filter.ops.map(([name,value])=>[name,(name==='sepia'?0:1)+(value-(name==='sepia'?0:1))*strength/100]);}
export function cssFilter(id,strength){return filterOps(id,strength).map(([name,value])=>`${name}(${value})`).join(' ')||'none';}
export function applyPixels(data,id,strength){
  const ops=filterOps(id,strength);if(!ops.length||strength===0)return;
  const clamp=v=>Math.min(255,Math.max(0,v));
  for(let i=0;i<data.length;i+=4){let r=data[i],g=data[i+1],b=data[i+2];
    for(const [name,v] of ops){
      if(name==='brightness'){r*=v;g*=v;b*=v;}
      else if(name==='contrast'){r=(r-127.5)*v+127.5;g=(g-127.5)*v+127.5;b=(b-127.5)*v+127.5;}
      else if(name==='saturate'){const l=.213*r+.715*g+.072*b;r=l+(r-l)*v;g=l+(g-l)*v;b=l+(b-l)*v;}
      else if(name==='sepia'){const nr=.393*r+.769*g+.189*b,ng=.349*r+.686*g+.168*b,nb=.272*r+.534*g+.131*b;r=r+(nr-r)*v;g=g+(ng-g)*v;b=b+(nb-b)*v;}
      r=clamp(r);g=clamp(g);b=clamp(b);
    }data[i]=r;data[i+1]=g;data[i+2]=b;
  }
}

export const neutralAdjustments=()=>({exposure:0,contrast:0,saturation:0});
// Exposure is an edit of captured pixels in linear light, not a hardware ISO or
// shutter-speed promise. Preview and export call the exact same implementation.
export function applyAdjustments(data,{exposure=0,contrast=0,saturation=0}={}){
  if(![exposure,contrast,saturation].every(Number.isFinite)||Math.abs(exposure)>2||Math.abs(contrast)>50||Math.abs(saturation)>50)throw new Error('无效的明暗或色彩设置');
  if(!exposure&&!contrast&&!saturation)return;
  const gain=2**exposure,lut=new Float64Array(256),clamp=n=>Math.max(0,Math.min(255,n));
  for(let i=0;i<256;i++){const c=i/255,l=(c<=.04045?c/12.92:((c+.055)/1.055)**2.4)*gain;lut[i]=255*(l<=.0031308?12.92*l:1.055*l**(1/2.4)-.055);}
  for(let i=0;i<data.length;i+=4){let r=lut[data[i]],g=lut[data[i+1]],b=lut[data[i+2]];
    r=(r-127.5)*(1+contrast/100)+127.5;g=(g-127.5)*(1+contrast/100)+127.5;b=(b-127.5)*(1+contrast/100)+127.5;
    const l=.213*r+.715*g+.072*b,s=1+saturation/100;
    data[i]=clamp(l+(r-l)*s);data[i+1]=clamp(l+(g-l)*s);data[i+2]=clamp(l+(b-l)*s);
  }
}
export function applyLook(data,filter,adjustments,{width,height,subjectBox,lighting}={}){
  // Learn the local mask from ungraded pixels, then use the same recipe for
  // preview, thumbnails and export. Editing always starts with the full source.
  const locallyAdjusted=applyLighting(data,width,height,subjectBox,lighting);
  applyAdjustments(data,adjustments);
  if(styleIds.includes(filter.id))applyStyle(data,filter.id,filter.strength);else applyPixels(data,filter.id,filter.strength);
  return {locallyAdjusted};
}
