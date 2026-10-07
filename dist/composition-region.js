// People / objects require their entire visible box. Structural lines can extend
// beyond a composition; retain the core of the overlap instead of protecting the
// whole room and preventing every crop or slight camera rotation.
export function protectedRegion(plan){
  const b=plan.subject.box;
  if(plan.compositionKind!=='structure')return b;
  const c=plan.crop,left=Math.max(b.x,c.centerX-c.scale/2),top=Math.max(b.y,c.centerY-c.scale/2);
  const width=Math.min(b.x+b.width,c.centerX+c.scale/2)-left;
  const height=Math.min(b.y+b.height,c.centerY+c.scale/2)-top;
  return {x:left+width*.1,y:top+height*.1,width:width*.8,height:height*.8};
}
