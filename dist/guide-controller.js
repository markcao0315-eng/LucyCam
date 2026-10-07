import {compositionStep} from './guide-coach.js';
import {cropRect} from './photo-utils.js';
import {validateGuidePlan} from './guide-plan.js';
import {point,alignmentDistance,lockCrop,fullTransform,boxCorners,GUIDE_TUNING,previewCrop,guidanceTarget} from './guide-geometry.js';
const FRAME_FRESH_MS=600,STALL_MS=2500;

export class GuideController {
  constructor({now=()=>performance.now(),change=()=>{},capture=async()=>{},stop=()=>{}}={}){
    Object.assign(this,{now,change,capture,stop});this.runId=0;this.state='IDLE';this.captureCommitted=false;
  }
  emit(state,message=''){this.state=state;this.message=message;this.change(this);}
  cancel(){this.runId++;this.abort?.abort();this.stop();this.latest=null;this.config=null;this.plan=null;this.target=null;this.coaching=null;this.emit('IDLE');}
  start(options){
    this.cancel();Object.assign(this,options);this.abort=new AbortController();this.started=this.now();this.captureCommitted=false;this.stableSince=null;this.lockTransform=null;this.latest=null;this.unsafeSince=null;this.coaching=null;this.recoverySince=null;this.receivedTime=null;
    this.base=cropRect(options.width,options.height,options.ratio);this.emit('ANALYZING','分析中，请保持片刻；可随时取消。');return this.runId;
  }
  active(id=this.runId){return id===this.runId&&!this.abort?.signal.aborted&&!['IDLE','LOST','REVIEW'].includes(this.state);}
  lose(message){if(!this.active())return;this.abort.abort();this.stop();this.config=null;this.coaching=null;this.target=null;this.emit('LOST',message);}
  tick(){
    if(!this.active()||this.state==='EXPORTING')return;
    if(this.now()-this.started>(this.state==='READY'?60000:20000))this.lose('请先让主体完整进入画面并留出边缘，再点「按当前画面继续」更新构图（本轮参考已过期）。');
    else if(this.recoverySince!==null&&this.now()-this.recoverySince>2500)this.lose('请缓慢转回刚才的方向，让主体完整进入画面；停稳后点「按当前画面继续」确认新位置。');
    else if(this.now()-(this.receivedTime??this.latest?.time??this.started)>STALL_MS)this.lose('相机持续没有送来新画面，请重新开启相机后再点「AI 帮我拍」。');
    else if(this.now()-(this.receivedTime??this.latest?.time??this.started)>FRAME_FRESH_MS&&this.plan&&this.state!=='CAPTURING'){
      this.config=null;this.target=null;this.coaching=null;this.stableSince=null;
      this.emit('WAITING','正在等相机更新画面，恢复后会自动继续，请保持当前方向。');
    }
  }
  accept(id,data){
    if(!this.active(id))return false;this.tick();if(!this.active(id))return false;
    if(data.schemaVersion!==1||data.referenceId!==this.referenceId){this.lose('参考画面不匹配，请重新分析。');return false;}
    try{this.plan=validateGuidePlan(data.plan,{scene:this.scene});}catch(error){this.lose(error.message);return false;}
    if(!this.plan.canGuide){this.lose(this.plan.advice);return false;}
    if(this.latest&&this.transform){this.target=guidanceTarget(this.base,this.plan,this.transform);this.updateCoaching();}
    this.emit(this.coaching?.required?'CORRECTING':'GUIDING',this.coaching?.message||'轻转手机，让目标圈靠近中心准星。');return true;
  }
  frame(frame){
    if(!this.active(frame.runId)||this.state==='EXPORTING'||!Number.isFinite(frame.time)||this.now()-frame.time>FRAME_FRESH_MS||frame.time>this.now()+1)return;
    if(this.latest&&(frame.frameId<=this.latest.frameId||frame.mediaTime<=this.latest.mediaTime))return;
    this.receivedTime=frame.time;
    if(!frame.valid){
      if(frame.initial)return;
      if(this.plan&&frame.recoverable&&this.state!=='CAPTURING'){
        this.recoverySince??=frame.time;this.config=null;this.target=null;this.coaching=null;this.stableSince=null;
        this.emit('RECOVERING','先停下，再缓慢转回刚才的方向，让主体回到画面；正在找回追踪。');this.tick();
      }else this.lose('暂时看不清主体：请移开遮挡、让主体和周围纹理进入画面，停稳后点「按当前画面继续」。');
      return;
    }
    if(this.recoverySince!==null){this.recoverySince=null;this.stableSince=null;this.emit('GUIDING','已找回画面，继续按方向提示调整。');}
    frame={...frame,velocity:frame.velocity*Math.min(this.width,this.height)/Math.min(this.base.sw,this.base.sh)};
    const previous=this.latest;this.latest=frame;
    this.transform=fullTransform(frame.transform,{width:this.width,height:this.height},{width:frame.width,height:frame.height});
    if(this.state==='ANALYZING')return;
    if(!frame.subjectKnown)return;
    if(!frame.subjectSafe){
      this.unsafeSince??=frame.time;
      if(this.state==='CAPTURING'){this.lose('拍摄时追踪不确定，本轮已取消。');return;}
      if(frame.time-this.unsafeSince>=GUIDE_TUNING.subjectGraceMs){this.lose('请让主体停在画面内，并留出周围背景；手机停稳后点「按当前画面继续」确认主体位置。');return;}
      this.config=null;this.lockTransform=null;this.stableSince=null;this.coaching=null;this.target=null;this.emit('GUIDING','请先停下，让主体和周围背景保持在画面内；正在确认位置。');return;
    }
    this.unsafeSince=null;
    this.target=guidanceTarget(this.base,this.plan,this.transform);
    this.updateCoaching();
    const distance=alignmentDistance(this.target,this.currentCrop(frame.time)),still=frame.velocity<GUIDE_TUNING.maxVelocity;
    const continuous=previous&&frame.time-previous.time<=FRAME_FRESH_MS;
    const clipped=this.config&&!this.subjectFits();
    if(this.state==='CAPTURING'){
      if(!still||!continuous||clipped||distance>GUIDE_TUNING.radius)this.lose('拍摄时画面移动，本轮已取消。');return;
    }
    if(['ZOOMING','SETTLING','READY'].includes(this.state)){
      if(!still||!continuous||clipped||distance>GUIDE_TUNING.radius){this.config=null;this.lockTransform=null;this.stableSince=null;this.emit('GUIDING','画面移动，请重新对准。');return;}
      if(this.state==='ZOOMING'&&frame.time-this.zoomStarted>=GUIDE_TUNING.zoomMs){this.stableSince=frame.time;this.emit('SETTLING','保持在圈内，即将拍摄。');}
      else if(this.state==='SETTLING'&&frame.time-this.stableSince>=GUIDE_TUNING.settleMs){
        if(this.autoCapture)this.commit();else this.emit('READY','构图和色彩已就绪，按白色快门拍摄。');
      }else this.change(this);
      return;
    }
    if(this.coaching.required){this.config=null;this.stableSince=null;this.emit('CORRECTING',this.coaching.message);return;}
    if(!still||!continuous||distance>GUIDE_TUNING.radius){
      this.stableSince=null;this.emit('GUIDING',!still?'移动慢一点，跟随目标圈调整。':this.coaching.message);return;
    }
    if(this.stableSince===null)this.stableSince=frame.time;
    if(frame.time-this.stableSince<GUIDE_TUNING.alignMs){this.emit('ALIGNING','已对准，保持在圈内。');return;}
    try{
      const crop=lockCrop({width:this.width,height:this.height,ratio:this.ratio,base:this.base,plan:this.plan,transform:this.transform,zoomMode:this.zoomMode});
      if(alignmentDistance(this.target,crop)>GUIDE_TUNING.radius)throw new Error('请微调镜头方向，让主体靠近绿色参考框。');
      this.config=Object.freeze({runId:this.runId,sourceWidth:this.width,sourceHeight:this.height,crop,mirrored:false,
        filter:Object.freeze({...this.plan.filter}),adjustments:Object.freeze({...this.plan.adjustments}),aspectRatio:this.aspectRatio,preserveScale:!!this.plan.framing,lockedFrameId:frame.frameId});
      this.lockTransform=[...this.transform];this.zoomStarted=frame.time;this.stableSince=null;this.emit('ZOOMING','正在放大选定区域，并应用 AI 推荐色彩…');
    }catch{this.config=null;this.stableSince=null;this.emit('CORRECTING',this.coaching.action==='hold'?'稍往后退，让主体与画面边缘留一点空隙，再保持镜头方向。':this.coaching.message);}
  }
  updateCoaching(){
    const previous=this.coaching,next=compositionStep(this.base,this.plan,this.transform,previous?.action);
    const same=previous?.action===next.action;
    const baseline=same?previous.baseline:next.error;
    const improved=same&&baseline-next.error>.015;
    this.coaching={...next,baseline,progress:baseline>0?Math.max(0,Math.min(1,1-next.error/baseline)):0};
    if(improved&&next.action!=='hold')this.coaching.message=`方向对了，${next.message}`;
  }
  currentCrop(time=this.now()){return previewCrop(this.base,this.config,this.state,this.zoomStarted,time);}
  subjectFits(){
    if(!this.config)return false;
    const {sx,sy,sw,sh}=this.config.crop;
    return boxCorners(this.base,this.plan.subject.box).map(p=>point(this.transform,p)).every(p=>p.x>=sx-1e-5&&p.x<=sx+sw+1e-5&&p.y>=sy-1e-5&&p.y<=sy+sh+1e-5);
  }
  canCapture(id){return this.active(id)&&this.state==='CAPTURING'&&this.now()-this.latest.time<=FRAME_FRESH_MS&&this.latest.subjectSafe&&this.latest.velocity<GUIDE_TUNING.maxVelocity&&alignmentDistance(this.target,this.currentCrop())<=GUIDE_TUNING.radius&&this.subjectFits();}
  // Called synchronously after copying the fresh video frame. Export validity is
  // now about cancellation/run identity, never the age of the live camera frame.
  freezeCapture(id){
    if(!this.active(id)||this.state!=='CAPTURING')return false;
    this.stop();this.target=null;this.emit('EXPORTING','已拍下，正在处理照片…');return true;
  }
  commit(){
    if(this.captureCommitted||!this.active()||!this.config||!['READY','SETTLING'].includes(this.state)||this.now()-this.latest.time>FRAME_FRESH_MS)return;
    this.captureCommitted=true;const id=this.runId,config=this.config;this.emit('CAPTURING','正在拍摄…');
    Promise.resolve().then(()=>{if(this.canCapture(id))return this.capture(config,this.abort.signal,()=>this.active(id)&&(this.state==='EXPORTING'||this.canCapture(id)),()=>this.freezeCapture(id));throw new Error('本轮拍摄已取消。');})
      .then(()=>{if(!this.active(id))return;this.stop();this.emit('REVIEW','拍摄完成，请保存到相册。');})
      .catch(error=>{if(this.active(id))this.lose(error.message||'请保持主体在画面内并停稳，再点「按当前画面继续」完成拍摄。');});
  }
  setLook(filter,adjustments){
    if(!this.config||!['READY','SETTLING'].includes(this.state))return false;
    this.config=Object.freeze({...this.config,filter:Object.freeze({...filter}),adjustments:Object.freeze({...adjustments})});this.change(this);return true;
  }
  setZoomMode(mode){
    if(!this.config||!['READY','SETTLING'].includes(this.state)||!['compose','quality'].includes(mode))return;
    this.zoomMode=mode;this.config=null;this.stableSince=null;this.lockTransform=null;this.emit('GUIDING','保持当前方向，正在切换构图大小。');
  }
}
