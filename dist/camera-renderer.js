import {applyPixels,outputSize} from './photo-utils.js';

export function drawCapture(source,canvas,config,{maxEdge=Infinity,filtered=true}={}){
  const {crop,mirrored,filter}=config,size=outputSize(crop.sw,crop.sh),scale=Math.min(1,maxEdge/Math.max(size.width,size.height));
  canvas.width=Math.max(1,Math.floor(size.width*scale));canvas.height=Math.max(1,Math.floor(size.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(mirrored){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
  ctx.drawImage(source,crop.sx,crop.sy,crop.sw,crop.sh,0,0,canvas.width,canvas.height);ctx.resetTransform();
  if(filtered&&filter.id!=='original'&&filter.strength){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);applyPixels(pixels.data,filter.id,filter.strength);ctx.putImageData(pixels,0,0);}
  return canvas;
}
export function clarity(canvas){
  const small=document.createElement('canvas');small.width=160;small.height=Math.max(1,Math.round(160*canvas.height/canvas.width));
  const c=small.getContext('2d',{willReadFrequently:true});c.drawImage(canvas,0,0,small.width,small.height);
  const p=c.getImageData(0,0,small.width,small.height).data,luma=new Float32Array(p.length/4);
  let mean=0,sum=0,square=0,n=0;for(let i=0;i<luma.length;i++){luma[i]=.213*p[4*i]+.715*p[4*i+1]+.072*p[4*i+2];mean+=luma[i];}
  for(let y=1;y<small.height-1;y++)for(let x=1;x<small.width-1;x++){const i=y*small.width+x,v=4*luma[i]-luma[i-1]-luma[i+1]-luma[i-small.width]-luma[i+small.width];sum+=v;square+=v*v;n++;}
  return {score:square/n-(sum/n)**2,mean:mean/luma.length};
}
export function nextVideoFrame(video,signal){
  return new Promise((resolve,reject)=>{
    let id,timer;const media=video.currentTime;
    const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(id);else cancelAnimationFrame(id);};
    const abort=()=>{clean();reject(new DOMException('拍摄已取消','AbortError'));};
    const tick=(_,meta)=>{if(signal?.aborted)return abort();if(video.paused)return abort();if((meta?.mediaTime??video.currentTime)!==media){clean();resolve();}else schedule();};
    const schedule=()=>{id=video.requestVideoFrameCallback?video.requestVideoFrameCallback(tick):requestAnimationFrame(tick);};
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,250);schedule();
  });
}
export async function captureBurst(video,config,signal,valid){
  let best=null,bestScore=-Infinity,mean=null;
  try{
    for(let i=0;i<3;i++){
      if(i)await new Promise((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,85),abort=()=>{clearTimeout(timer);reject(new DOMException('取消','AbortError'));};signal.addEventListener('abort',abort,{once:true});});
      await nextVideoFrame(video,signal);
      if(!valid()||signal.aborted||video.videoWidth!==config.sourceWidth||video.videoHeight!==config.sourceHeight)throw new Error('画面已改变，本轮已取消。');
      const canvas=drawCapture(video,document.createElement('canvas'),config,{filtered:false}),quality=clarity(canvas);
      if(mean!==null&&Math.abs(quality.mean-mean)>15){canvas.width=canvas.height=1;throw new Error('曝光变化过大，请重新拍摄。');}mean=quality.mean;
      if(quality.score>bestScore){if(best)best.width=best.height=1;best=canvas;bestScore=quality.score;}else canvas.width=canvas.height=1;
    }
    return best;
  }catch(error){if(best)best.width=best.height=1;throw error;}
}
