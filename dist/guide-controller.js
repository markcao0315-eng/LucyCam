import {cropRect} from './photo-utils.js';
import {validateGuidePlan} from './guide-plan.js';
import {point,referencePoint,alignmentDistance,lockCrop,motionBetween,fullTransform} from './guide-geometry.js';

export class GuideController {
  constructor({now=()=>performance.now(),change=()=>{},capture=async()=>{},stop=()=>{}}={}){
    Object.assign(this,{now,change,capture,stop});this.runId=0;this.state='IDLE';this.captureCommitted=false;
  }
  emit(state,message=''){this.state=state;this.message=message;this.change(this);}
  cancel(){this.runId++;this.abort?.abort();this.stop();this.latest=null;this.config=null;this.plan=null;this.target=null;this.emit('IDLE');}
  start(options){
    this.cancel();Object.assign(this,options);this.abort=new AbortController();this.started=this.now();this.captureCommitted=false;this.stableSince=null;this.lockTransform=null;this.latest=null;
    this.base=cropRect(options.width,options.height,options.ratio);this.emit('ANALYZING','分析中，请保持片刻；可随时取消。');return this.runId;
  }
  active(id=this.runId){return id===this.runId&&!this.abort?.signal.aborted&&!['IDLE','LOST','REVIEW'].includes(this.state);}
  lose(message){if(!this.active())return;this.abort.abort();this.stop();this.config=null;this.emit('LOST',message);}
  tick(){
    if(!this.active())return;
    if(this.now()-this.started>20000)this.lose('本轮参考已过期，请重新分析。');
    else if(this.now()-(this.latest?.time??this.started)>300)this.lose('画面停顿或追踪帧过旧，请重新分析。');
  }
  accept(id,data){
    if(!this.active(id))return false;this.tick();if(!this.active(id))return false;
    if(data.schemaVersion!==1||data.referenceId!==this.referenceId){this.lose('参考画面不匹配，请重新分析。');return false;}
    try{this.plan=validateGuidePlan(data.plan,{scene:this.scene});}catch(error){this.lose(error.message);return false;}
    if(!this.plan.canGuide){this.lose(this.plan.advice);return false;}
    this.emit('GUIDING','轻转手机，让目标圈靠近中心准星。');return true;
  }
  frame(frame){
    if(!this.active(frame.runId)||!Number.isFinite(frame.time)||this.now()-frame.time>250||frame.time>this.now()+1)return;
    if(this.latest&&(frame.frameId<=this.latest.frameId||frame.mediaTime<=this.latest.mediaTime))return;
    if(!frame.valid){if(!frame.initial)this.lose(frame.reason||'暂时无法稳定跟踪，可手动拍摄。');return;}
    frame={...frame,velocity:frame.velocity*Math.min(this.width,this.height)/Math.min(this.base.sw,this.base.sh)};
    const previous=this.latest;this.latest=frame;
    this.transform=fullTransform(frame.transform,{width:this.width,height:this.height},{width:frame.width,height:frame.height});
    if(this.state==='ANALYZING')return;
    if(!frame.subjectKnown)return;
    if(!frame.subjectSafe){this.lose('主体移动或主体特征不足，请手动拍摄或重新分析。');return;}
    this.target=point(this.transform,referencePoint(this.base,this.plan.crop.centerX,this.plan.crop.centerY));
    const distance=alignmentDistance(this.target,this.base),still=frame.velocity<.01;
    const continuous=previous&&frame.time-previous.time<=250;
    const shifted=this.lockTransform&&motionBetween(this.lockTransform,this.transform,this.width,this.height)>.015;
    if(this.state==='CAPTURING'){
      if(!still||!continuous||shifted||distance>.05)this.lose('拍摄时画面移动，本轮已取消。');return;
    }
    if(['ZOOMING','SETTLING'].includes(this.state)){
      if(!still||!continuous||shifted||distance>.05){this.config=null;this.lockTransform=null;this.stableSince=null;this.emit('GUIDING','画面移动，请重新对准。');return;}
      if(this.state==='ZOOMING'&&frame.time-this.zoomStarted>=550){this.stableSince=frame.time;this.emit('SETTLING','保持不动，即将拍摄。');}
      else if(this.state==='SETTLING'&&frame.time-this.stableSince>=600){
        if(this.autoCapture)this.commit();else this.emit('SETTLING','已对准，按白色快门拍摄。');
      }else this.change(this);
      return;
    }
    if(!still||!continuous||distance> (this.state==='ALIGNING'?.05:.03)){
      this.stableSince=null;this.emit('GUIDING','轻转手机，让目标圈靠近中心准星。');return;
    }
    if(this.stableSince===null)this.stableSince=frame.time;
    if(frame.time-this.stableSince<800){this.emit('ALIGNING','已对准，请停稳。');return;}
    try{
      const crop=lockCrop({width:this.width,height:this.height,ratio:this.ratio,base:this.base,plan:this.plan,transform:this.transform});
      this.config=Object.freeze({runId:this.runId,sourceWidth:this.width,sourceHeight:this.height,crop,mirrored:false,
        filter:Object.freeze({...this.plan.filter}),aspectRatio:this.aspectRatio,lockedFrameId:frame.frameId});
      this.lockTransform=[...this.transform];this.zoomStarted=frame.time;this.stableSince=null;this.emit('ZOOMING','正在调整构图和色彩…');
    }catch(error){this.stableSince=null;this.emit('GUIDING',error.message);}
  }
  canCapture(id){return this.active(id)&&this.state==='CAPTURING'&&this.now()-this.latest.time<=250&&this.latest.subjectSafe&&this.latest.velocity<.01;}
  commit(){
    if(this.captureCommitted||!this.active()||this.now()-this.latest.time>250)return;
    this.captureCommitted=true;const id=this.runId,config=this.config;this.emit('CAPTURING','正在选取清晰的一帧…');
    Promise.resolve().then(()=>{if(this.canCapture(id))return this.capture(config,this.abort.signal,()=>this.canCapture(id));throw new Error('本轮拍摄已取消。');})
      .then(()=>{if(!this.active(id))return;this.stop();this.emit('REVIEW','拍摄完成，请保存到相册。');})
      .catch(error=>{if(this.active(id))this.lose(error.message||'拍摄失败，请手动重试。');});
  }
}
