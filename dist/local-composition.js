import {validateGuidePlan} from './guide-plan.js';

// Local recovery only: edge distributions from the SAME reference pixels, not
// object recognition or an aesthetic score. Keep the full view unless the caller
// explicitly selected scenery and there is a nearly empty outer margin.
export function localComposition({data,width,height},{scene='auto'}={}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||data?.length!==width*height*4)throw new Error('缺少可用的相机画面。');
  const gray=new Float32Array(width*height),rows=new Float64Array(height),cols=new Float64Array(width);
  for(let i=0;i<gray.length;i++)gray[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
  let total=0,count=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,g=Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+width]-gray[i-width]);
    if(g<18)continue;
    const weight=Math.min(80,g);rows[y]+=weight;cols[x]+=weight;total+=weight;count++;
  }
  const textured=count>=24;
  const quantile=(a,q)=>{let sum=0;for(let i=0;i<a.length;i++){sum+=a[i];if(sum>=total*q)return (i+.5)/a.length;}return .5;};
  let crop={centerX:.5,centerY:.5,scale:1},box={x:0,y:0,width:1,height:1};
  if(textured){
    const x=quantile(cols,.15),y=quantile(rows,.15),right=quantile(cols,.85),bottom=quantile(rows,.85);
    box={x,y,width:Math.max(1/width,right-x),height:Math.max(1/height,bottom-y)};
    if(scene==='landscape'){
      const left=Math.max(0,quantile(cols,.005)-.04),top=Math.max(0,quantile(rows,.005)-.04);
      const r=Math.min(1,quantile(cols,.995)+.04),b=Math.min(1,quantile(rows,.995)+.04);
      const scale=Math.min(1,Math.max(.85,r-left,b-top));
      crop={scale,centerX:Math.max(scale/2,Math.min(1-scale/2,(left+r)/2)),centerY:Math.max(scale/2,Math.min(1-scale/2,(top+b)/2))};
    }
  }
  const plan=validateGuidePlan({canGuide:true,compositionKind:'structure',subject:{label:textured?'线条与空间':'色块与留白',box},crop,
    filter:{id:'original',strength:0},adjustments:{exposure:0,contrast:0,saturation:0},lighting:{subjectEV:0,backgroundEV:0},alternatives:[],
    lookReason:'本地建议先保留现场色彩，拍后可比较不同风格。',
    advice:textured?'本地构图建议：保留空间关系，按目标圈轻转镜头，再比较拍后风格。':'保留色块与留白；也可稍转镜头，把墙角、窗框或桌沿带入画面。'});
  return {plan,textured};
}
