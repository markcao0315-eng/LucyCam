import {boxCorners,point,GUIDE_TUNING,guidanceTarget} from './guide-geometry.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function compositionStep(base,plan,transform,previousAction){
  const points=boxCorners(base,plan.subject.box).map(p=>point(transform,p));
  const xs=points.map(p=>(p.x-base.sx)/base.sw),ys=points.map(p=>(p.y-base.sy)/base.sh);
  const actual={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  const b=plan.subject.box,c=plan.crop;
  const goalScale=plan.framing?1:Math.min(1,.84/(b.width/c.scale),.84/(b.height/c.scale));
  const width=b.width/c.scale*goalScale,height=b.height/c.scale*goalScale;
  const cx=plan.framing?.subjectX??clamp((b.x+b.width/2-c.centerX)/c.scale+.5,width/2+.04,.96-width/2);
  const cy=plan.framing?.subjectY??clamp((b.y+b.height/2-c.centerY)/c.scale+.5,height/2+.04,.96-height/2);
  const goal={x:cx-width/2,y:cy-height/2,width,height};
  const target=guidanceTarget(base,plan,transform);
  const dx=(target.x-base.sx-base.sw/2)/Math.min(base.sw,base.sh),dy=(target.y-base.sy-base.sh/2)/Math.min(base.sw,base.sh);
  let action='hold',error=0,required=false;
  // Keep a little room around large subjects; release with hysteresis after backing up.
  const sizeLimit=plan.framing?(previousAction==='back'?.98:1.01):(previousAction==='back'?.86:.94);
  if(Math.max(actual.width,actual.height)>sizeLimit){
    action='back';error=Math.max(actual.width,actual.height)-(plan.framing?.98:.86);required=true;
  }else{
    const edges=[['left',-actual.x],['right',actual.x+actual.width-1],['up',-actual.y],['down',actual.y+actual.height-1]].sort((a,b)=>b[1]-a[1]);
    if(edges[0][1]>1e-5){[action,error]=edges[0];required=true;}
    else if(Math.hypot(dx,dy)>GUIDE_TUNING.radius){
      let horizontal=Math.abs(dx)>Math.abs(dy);
      if(['left','right'].includes(previousAction)&&Math.abs(dx)>GUIDE_TUNING.radius&&Math.abs(dy)<Math.abs(dx)*1.25)horizontal=true;
      if(['up','down'].includes(previousAction)&&Math.abs(dy)>GUIDE_TUNING.radius&&Math.abs(dx)<Math.abs(dy)*1.25)horizontal=false;
      action=horizontal?(dx>0?'right':'left'):(dy>0?'down':'up');error=Math.hypot(dx,dy)-GUIDE_TUNING.radius;
    }
  }
  const messages={back:'确认身后有空间后，稍往后退，让主体缩小；大小合适时会提示停下。',left:'镜头稍向左转，让主体向右移动、目标圈靠近中心。',right:'镜头稍向右转，让主体向左移动、目标圈靠近中心。',up:'稍抬高镜头，让主体向下移动，收进画面。',down:'稍压低镜头，让主体向上移动，收进画面。',hold:'位置合适，保持片刻，准备自动拍摄。'};
  const placement=`主体目标位置：画面${cx<.42?'左侧':cx>.58?'右侧':'中间'}${cy<.42?'偏上':cy>.58?'偏下':''}；绿色虚线框是构图参考。`;
  return {action,error,required,actual,goal,message:(plan.framing&&['left','right','up','down'].includes(action)?'保持当前距离，':'')+messages[action],placement,arrow:{back:'↔',left:'←',right:'→',up:'↑',down:'↓',hold:'✓'}[action]};
}
