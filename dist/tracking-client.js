export class TrackingClient {
  constructor(video,runId,onResult,onError){
    this.video=video;this.runId=runId;this.onResult=onResult;this.onError=onError;this.frameId=0;this.stopped=false;this.busy=false;this.lastMedia=-1;this.lastTime=-Infinity;
    this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.worker=new Worker('/tracking-worker.js');
  }
  async ready(){
    await new Promise((resolve,reject)=>{
      this.rejectReady=reject;
      this.timeout=setTimeout(()=>reject(new Error('追踪组件加载超时。请保持当前取景，检查网络后再点「按当前画面继续」。')),12000);
      this.worker.onerror=()=>{clearTimeout(this.timeout);const e=new Error('追踪组件加载失败');reject(e);if(!this.stopped)this.onError(e.message);};
      this.worker.onmessage=({data})=>{
        if(this.stopped)return;
        if(data.type==='ready'){clearTimeout(this.timeout);resolve();return;}
        if(data.type==='error'){clearTimeout(this.timeout);reject(new Error(data.reason));this.onError(data.reason);return;}
        if(data.runId!==this.runId)return;
        this.busy=false;this.onResult(data);
      };
    });
    this.rejectReady=null;
  }
  sample(source=this.video,mediaTime=this.video.currentTime,{rebase=false}={}){
    if(this.stopped||this.busy)return;
    const width=source.videoWidth||source.width,height=source.videoHeight||source.height;
    const factor=Math.min(1,480/Math.max(width,height));
    this.canvas.width=Math.round(width*factor);this.canvas.height=Math.round(height*factor);
    this.ctx.drawImage(source,0,0,this.canvas.width,this.canvas.height);
    const rgba=this.ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data.buffer;
    const time=performance.now();this.busy=true;this.lastTime=time;this.lastMedia=mediaTime;
    this.worker.postMessage({type:'frame',rebase,runId:this.runId,frameId:++this.frameId,time,mediaTime,width:this.canvas.width,height:this.canvas.height,rgba},[rgba]);
    return {width:this.canvas.width,height:this.canvas.height,frameId:this.frameId};
  }
  start(){
    const tick=(time,meta)=>{
      if(this.stopped)return;
      const media=meta?.mediaTime??this.video.currentTime;
      if(!this.video.paused&&this.video.readyState>=2&&media!==this.lastMedia&&performance.now()-this.lastTime>=70)this.sample(this.video,media);
      this.schedule(tick);
    };this.schedule(tick);
  }
  schedule(tick){this.callback=this.video.requestVideoFrameCallback?this.video.requestVideoFrameCallback(tick):requestAnimationFrame(tick);}
  subject(box){if(!this.stopped)this.worker.postMessage({type:'subject',runId:this.runId,box});}
  stop(){
    this.stopped=true;clearTimeout(this.timeout);this.rejectReady?.(new DOMException('Cancelled','AbortError'));this.rejectReady=null;
    if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.callback);else cancelAnimationFrame(this.callback);
    this.worker.terminate();this.canvas.width=this.canvas.height=1;
  }
}
