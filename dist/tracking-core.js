import {identity,multiply,inverse,point,motionBetween} from './guide-geometry.js';
import {estimateAffine,coverage,median,residual} from './tracking-math.js';

export class ImageTracker {
  constructor(cv){this.cv=cv;this.transform=identity();this.anchors=[];this.subject=null;this.previous=null;this.points=null;this.time=null;this.failed=false;this.count=0;}
  dispose(){this.previous?.delete();this.reference?.delete();this.points?.delete();this.previous=this.reference=this.points=null;this.anchors=[];}
  setSubject(box){
    this.subject=box;if(!this.reference||!this.previous)return;
    // AI can pick a tiny subject missed by the globally distributed point budget.
    // Detect in the ORIGINAL reference, then verify reference -> current -> reference
    // optical flow and agreement with camera motion before trusting those anchors.
    const cv=this.cv,mask=cv.Mat.zeros(this.reference.rows,this.reference.cols,cv.CV_8UC1),found=new cv.Mat(),next=new cv.Mat(),back=new cv.Mat(),status=new cv.Mat(),backStatus=new cv.Mat(),err=new cv.Mat(),backErr=new cv.Mat();
    try{
      for(let y=Math.max(0,Math.floor(box.y)-2);y<Math.min(mask.rows,Math.ceil(box.y+box.height)+2);y++)for(let x=Math.max(0,Math.floor(box.x)-2);x<Math.min(mask.cols,Math.ceil(box.x+box.width)+2);x++)mask.data[y*mask.cols+x]=255;
      cv.goodFeaturesToTrack(this.reference,found,24,.01,3,mask,3,false,.04);if(!found.rows)return;
      cv.calcOpticalFlowPyrLK(this.reference,this.previous,found,next,status,err,new cv.Size(21,21),3);
      cv.calcOpticalFlowPyrLK(this.previous,this.reference,next,back,backStatus,backErr,new cv.Size(21,21),3);
      const points=Array.from({length:this.points.rows},(_,i)=>({x:this.points.data32F[2*i],y:this.points.data32F[2*i+1]}));
      for(let i=0;i<found.rows;i++){
        const anchor={x:found.data32F[2*i],y:found.data32F[2*i+1],trusted:true},p={x:next.data32F[2*i],y:next.data32F[2*i+1]},expected=point(this.transform,anchor);
        if(!status.data[i]||!backStatus.data[i]||err.data32F[i]>=20||Math.hypot(anchor.x-back.data32F[2*i],anchor.y-back.data32F[2*i+1])>=1.5||Math.hypot(expected.x-p.x,expected.y-p.y)>=3||!this.inside(anchor)||points.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<3))continue;
        points.push(p);this.anchors.push(anchor);
      }
      this.points.delete();this.points=cv.matFromArray(points.length,1,cv.CV_32FC2,points.flatMap(p=>[p.x,p.y]));
    }finally{for(const m of [mask,found,next,back,status,backStatus,err,backErr])m.delete();}
  }
  inside(p){const b=this.subject;return b&&p.x>=b.x-2&&p.x<=b.x+b.width+2&&p.y>=b.y-2&&p.y<=b.y+b.height+2;}
  detect(gray,existing=[],anchors=[],initial=false){
    const cv=this.cv,found=new cv.Mat(),mask=new cv.Mat();
    try{
      cv.goodFeaturesToTrack(gray,found,500,.015,7,mask,3,false,.04);
      const points=[...existing],refs=[...anchors],cells=new Map(),inv=inverse(this.transform);
      const key=p=>Math.min(3,Math.floor(p.x/gray.cols*4))+4*Math.min(3,Math.floor(p.y/gray.rows*4));
      for(const p of points)cells.set(key(p),(cells.get(key(p))||0)+1);
      for(let i=0;i<found.rows&&points.length<120;i++){
        const p={x:found.data32F[2*i],y:found.data32F[2*i+1]},k=key(p),anchor=point(inv,p);
        if((cells.get(k)||0)>=8||(!initial&&this.inside(anchor))||points.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<7))continue;
        points.push(p);refs.push({...anchor,trusted:initial});cells.set(k,(cells.get(k)||0)+1);
      }
      this.points?.delete();this.points=cv.matFromArray(points.length,1,cv.CV_32FC2,points.flatMap(p=>[p.x,p.y]));this.anchors=refs;
    }finally{found.delete();mask.delete();}
  }
  process({rgba,width,height,time}){
    if(this.failed)return {valid:false,reason:'追踪已丢失，请重新分析。'};
    const cv=this.cv,src=cv.matFromArray(height,width,cv.CV_8UC4,new Uint8Array(rgba)),gray=new cv.Mat();
    try{cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);}finally{src.delete();}
    if(!this.previous){
      this.previous=gray;this.reference=gray.clone();this.time=time;this.detect(gray,[],[],true);
      return {valid:false,initial:true,transform:this.transform,features:this.points.rows};
    }
    const dt=(time-this.time)/1000;
    if(width!==this.previous.cols||height!==this.previous.rows||dt<=0||dt>2.5||this.points.rows<20){gray.delete();this.failed=true;return {valid:false,reason:'画面停顿或特征不足，请重新分析。'};}
    const next=new cv.Mat(),back=new cv.Mat(),status=new cv.Mat(),backStatus=new cv.Mat(),err=new cv.Mat(),backErr=new cv.Mat();
    try{
      cv.calcOpticalFlowPyrLK(this.previous,gray,this.points,next,status,err,new cv.Size(21,21),3);
      cv.calcOpticalFlowPyrLK(gray,this.previous,next,back,backStatus,backErr,new cv.Size(21,21),3);
      const pairs=[];
      for(let i=0;i<this.points.rows;i++){
        const x=this.points.data32F[2*i],y=this.points.data32F[2*i+1],u=next.data32F[2*i],v=next.data32F[2*i+1];
        const fb=Math.hypot(x-back.data32F[2*i],y-back.data32F[2*i+1]);
        if(status.data[i]&&backStatus.data[i]&&fb<1.5&&err.data32F[i]<20&&u>=3&&v>=3&&u<width-3&&v<height-3)pairs.push({x,y,u,v,fb,anchor:this.anchors[i]});
      }
      const background=this.subject?pairs.filter(p=>!this.inside(p.anchor)):pairs;
      const model=estimateAffine(background);
      const space=model?coverage(model.inliers,width,height):0;
      const scale=model?Math.hypot(model.matrix[0],model.matrix[3]):0;
      const m=model?.matrix,scaleY=m?Math.hypot(m[1],m[4]):0;
      const valid=!!model&&model.inliers.length>=20&&model.ratio>=.65&&model.residual<=2.5&&space>=.375&&scale>.92&&scale<1.08&&scaleY>.92&&scaleY<1.08&&m[0]*m[4]-m[1]*m[3]>0&&Math.abs(m[0]*m[1]+m[3]*m[4])<.12&&Math.abs(Math.atan2(m[3],m[0]))<.1;
      if(!valid){gray.delete();return {valid:false,recoverable:true,reason:'请缓慢转回刚才的方向，正在找回原画面。',inliers:model?.inliers.length||0,coverage:space};}
      const before=this.transform;this.transform=multiply(model.matrix,this.transform);
      const referenceBackground=background.filter(p=>p.anchor.trusted);
      const referenceResidual=median(referenceBackground.map(p=>residual(this.transform,{...p.anchor,u:p.u,v:p.v})));
      // A moving foreground may have dominated before the AI identified it.
      // Validate the accumulated chain against original background anchors too.
      const referenceSafe=!this.subject||(referenceBackground.length>=10&&referenceResidual<6);
      const subjectPairs=pairs.filter(p=>this.inside(p.anchor)&&p.anchor.trusted);
      const subjectDrift=median(subjectPairs.map(p=>residual(this.transform,{...p.anchor,u:p.u,v:p.v})));
      const subjectMotion=median(subjectPairs.map(p=>residual(model.matrix,p)));
      // Allow small parallax / LK accumulation error after camera compensation.
      // Independent sustained foreground motion still fails the reference check.
      const subjectSafe=!!this.subject&&referenceSafe&&subjectPairs.length>=4&&subjectDrift<8&&subjectMotion<3;
      const velocity=motionBetween(before,this.transform,width,height)/dt;
      this.previous.delete();this.previous=gray;this.time=time;this.count++;
      // Preserve reference anchors of surviving points. Newly detected background points
      // are anchored through inverse(T), never a reset of the AI reference.
      this.detect(gray,pairs.map(p=>({x:p.u,y:p.v})),pairs.map(p=>p.anchor));
      return {valid:true,transform:this.transform,inliers:model.inliers.length,inlierRatio:model.ratio,residual:model.residual,
        fbError:median(pairs.map(p=>p.fb)),coverage:space,velocity,referenceResidual,subjectKnown:!!this.subject,subjectSafe,subjectPoints:subjectPairs.length,subjectDrift,subjectMotion};
    }catch(error){if(this.previous!==gray)gray.delete();throw error;}
    finally{for(const mat of [next,back,status,backStatus,err,backErr])mat.delete();}
  }
}
