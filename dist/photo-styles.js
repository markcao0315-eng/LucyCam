// Original LucyCam looks. These are pixel recipes, not branded film simulations.
export const styles = [
  {id:'travel',name:'清透旅拍',description:'柔和亮部 · 清爽蓝绿 · 自然暖肤',curve:[0,.075,.23,.49,.77,.93,.995],sat:1.08,green:[-.015,.03,.015],shadow:[-.012,.003,.019],light:[.018,.009,-.01],warmth:.006},
  {id:'forest',name:'森系电影',description:'深绿环境 · 冷色阴影 · 温暖主体',curve:[.014,.04,.17,.41,.70,.90,.98],sat:.9,green:[-.055,-.04,.018],shadow:[-.023,.012,.03],light:[.035,.012,-.022],warmth:0},
  {id:'amber',name:'暖光胶片',description:'柔和反差 · 琥珀高光 · 微冷暗部',curve:[.035,.10,.255,.48,.71,.875,.96],sat:.87,green:[.02,-.013,-.025],shadow:[-.006,.008,.028],light:[.04,.014,-.035],warmth:.014},
  {id:'editorial',name:'都市杂志',description:'鲜明层次 · 克制杂色 · 干净肤色',curve:[.003,.027,.145,.455,.79,.945,.99],sat:.76,green:[-.005,-.022,.005],shadow:[-.014,.003,.016],light:[.014,.004,-.01],warmth:0},
  {id:'night',name:'夜色氛围',description:'深邃暗部 · 冷暖灯色 · 保留夜色',curve:[.004,.028,.13,.39,.76,.95,.997],sat:1.2,green:[-.012,-.025,.02],shadow:[-.02,.002,.055],light:[.042,.005,-.035],warmth:-.005}
];
export const styleIds=styles.map(s=>s.id);
const knots=[0,.125,.25,.5,.75,.9,1],cubes=new Map(),edge=17;
const clamp=(x,lo=0,hi=1)=>Math.min(hi,Math.max(lo,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
function curve(x,values){let i=0;while(i<knots.length-2&&x>knots[i+1])i++;const t=(x-knots[i])/(knots[i+1]-knots[i]);return values[i]+t*(values[i+1]-values[i]);}
function grade(r,g,b,s){
  const y=.213*r+.715*g+.072*b,max=Math.max(r,g,b),min=Math.min(r,g,b),chroma=max-min;
  // Protect orange/red skin-like colors, not a claim of semantic skin detection.
  const skin=smooth((r-g+.02)/.12)*smooth((g-b+.015)/.12)*smooth((.55-chroma)/.25);
  const green=smooth((g-Math.max(r,b)+.02)/.18)*(1-skin);
  let a=curve(r,s.curve),c=curve(g,s.curve),d=curve(b,s.curve);
  const l=.213*a+.715*c+.072*d,sat=1+(s.sat-1)*(1-.75*skin);
  a=l+(a-l)*sat;c=l+(c-l)*sat;d=l+(d-l)*sat;
  const sh=(1-smooth((y-.05)/.55))*.8,hi=smooth((y-.3)/.65),protect=1-.78*skin;
  return [a,c,d].map((v,i)=>clamp(v+(s.green[i]*green+s.shadow[i]*sh+s.light[i]*hi+[s.warmth,0,-s.warmth][i])*protect));
}
function cubeFor(style){
  if(cubes.has(style.id))return cubes.get(style.id);
  const cube=new Float32Array(edge**3*3);
  for(let r=0;r<edge;r++)for(let g=0;g<edge;g++)for(let b=0;b<edge;b++)cube.set(grade(r/(edge-1),g/(edge-1),b/(edge-1),style),((r*edge+g)*edge+b)*3);
  cubes.set(style.id,cube);return cube;
}
export function applyStyle(data,id,strength){
  const style=styles.find(s=>s.id===id);if(!style||!Number.isFinite(strength)||strength<0||strength>100)throw new Error('无效的风格设置');
  if(!strength)return;
  const cube=cubeFor(style),mix=strength/100,factor=(edge-1)/255;
  for(let i=0;i<data.length;i+=4){
    const r=data[i]*factor,g=data[i+1]*factor,b=data[i+2]*factor,ri=Math.min(15,Math.floor(r)),gi=Math.min(15,Math.floor(g)),bi=Math.min(15,Math.floor(b)),rf=r-ri,gf=g-gi,bf=b-bi;
    const base=((ri*edge+gi)*edge+bi)*3;
    for(let c=0;c<3;c++){
      const row=(offset)=>{const k=base+offset+c;return cube[k]*(1-bf)+cube[k+3]*bf;};
      const v=(row(0)*(1-gf)+row(edge*3)*gf)*(1-rf)+(row(edge*edge*3)*(1-gf)+row((edge*edge+edge)*3)*gf)*rf;
      data[i+c]+=mix*(255*v-data[i+c]);
    }
  }
}

// A small color-likelihood mask learned from this image's subject box and its
// surroundings. Ambiguous images disable local edits; no stock silhouette or
// face/skin segmentation claim. Bilateral smoothing follows visible edges.
export function subjectMask(data,width,height,box){
  if(!box||width*height*4!==data.length||box.width<=0||box.height<=0)return null;
  const mw=Math.min(96,width),mh=Math.max(1,Math.round(mw*height/width)),rgb=new Float32Array(mw*mh*3),histF=new Float64Array(512),histB=new Float64Array(512);
  let nf=0,nb=0;const bin=(r,g,b)=>(r>>5)*64+(g>>5)*8+(b>>5);
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
    const px=Math.min(width-1,Math.floor((x+.5)*width/mw)),py=Math.min(height-1,Math.floor((y+.5)*height/mh)),k=(py*width+px)*4,j=(y*mw+x)*3;
    rgb[j]=data[k];rgb[j+1]=data[k+1];rgb[j+2]=data[k+2];
    const nx=(x+.5)/mw,ny=(y+.5)/mh,b=bin(data[k],data[k+1],data[k+2]);
    if(nx>box.x+box.width*.1&&nx<box.x+box.width*.9&&ny>box.y+box.height*.08&&ny<box.y+box.height*.92){histF[b]++;nf++;}
    else if(nx<box.x||nx>box.x+box.width||ny<box.y||ny>box.y+box.height){histB[b]++;nb++;}
  }
  if(nf<6||nb<12)return null;
  let overlap=0;for(let i=0;i<512;i++)overlap+=Math.min(histF[i]/nf,histB[i]/nb);
  if(overlap>.88)return null;
  let mask=new Float32Array(mw*mh);
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
    const j=(y*mw+x)*3,b=bin(rgb[j],rgb[j+1],rgb[j+2]),f=histF[b]/nf,bg=histB[b]/nb;
    const nx=(x+.5)/mw,ny=(y+.5)/mh,margin=Math.min(nx-box.x,box.x+box.width-nx,ny-box.y,box.y+box.height-ny);
    mask[y*mw+x]=smooth((margin+.015)/.04)*smooth((f-.9*bg)/(f+bg+.001));
  }
  for(let pass=0;pass<2;pass++){
    const next=new Float32Array(mask.length);
    for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
      const i=y*mw+x;let sum=0,total=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||xx>=mw||yy<0||yy>=mh)continue;
        const j=yy*mw+xx,d=Math.abs(rgb[i*3]-rgb[j*3])+Math.abs(rgb[i*3+1]-rgb[j*3+1])+Math.abs(rgb[i*3+2]-rgb[j*3+2]),w=1/(1+d*d/600);
        sum+=mask[j]*w;total+=w;
      }next[i]=sum/total;
    }mask=next;
  }
  return {data:mask,width:mw,height:mh,confidence:1-overlap};
}
export function applyLighting(data,width,height,box,lighting){
  const subjectEV=lighting?.subjectEV??0,backgroundEV=lighting?.backgroundEV??0;
  if(!Number.isFinite(subjectEV)||!Number.isFinite(backgroundEV)||Math.abs(subjectEV)>.6||Math.abs(backgroundEV)>.4)throw new Error('无效的局部光影设置');
  if(!subjectEV&&!backgroundEV)return false;
  const mask=subjectMask(data,width,height,box);if(!mask)return false;
  // Precompute bounded linear-light exposure, tapering positive gain near white.
  const table=new Uint8ClampedArray(33*256);
  for(let m=0;m<=32;m++)for(let v=0;v<256;v++){
    let ev=backgroundEV+(subjectEV-backgroundEV)*m/32;if(ev>0)ev*=1-smooth((v/255-.72)/.28);
    const c=v/255,l=(c<=.04045?c/12.92:((c+.055)/1.055)**2.4)*2**ev;
    table[m*256+v]=255*(l<=.0031308?12.92*l:1.055*l**(1/2.4)-.055);
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const mx=clamp((x+.5)*mask.width/width-.5,0,mask.width-1),my=clamp((y+.5)*mask.height/height-.5,0,mask.height-1),x0=Math.floor(mx),y0=Math.floor(my),x1=Math.min(mask.width-1,x0+1),y1=Math.min(mask.height-1,y0+1),fx=mx-x0,fy=my-y0;
    const at=(xx,yy)=>mask.data[yy*mask.width+xx],w=(at(x0,y0)*(1-fx)+at(x1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x1,y1)*fx)*fy,k=(y*width+x)*4,offset=Math.round(w*32)*256;
    for(let c=0;c<3;c++)data[k+c]=table[offset+data[k+c]];
  }return true;
}
