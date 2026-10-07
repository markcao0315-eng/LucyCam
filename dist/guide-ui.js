import {localComposition} from './local-composition.js';
import {MotionSensor} from './motion-sensor.js';
import {GuideController} from './guide-controller.js';
import {TrackingClient} from './tracking-client.js';
import {captureComposition} from './photo-composition.js';
import {drawCapture,captureCurrentFrame} from './camera-renderer.js';
import {displayPoint,referencePoint,boxCorners,point,GUIDE_TUNING} from './guide-geometry.js';
import {looks,neutralAdjustments} from './photo-utils.js';
const $=id=>document.getElementById(id);

export function setupGuide({video,getCamera,ai,makePhoto,cancelCountdown}){
  let tracker=null,starting=false,epoch=0,watchdog=null,animation=null,lastDraw=0,lastLookConfig=null,lastRecovery=0,lastRecoveryMedia=-1;
  const canvas=$('guidePreview'),motion=new MotionSensor();
  $('liveFilter').replaceChildren(...looks.map(f=>new Option(f.name,f.id)));
  function stop(){motion.stop();tracker?.stop();tracker=null;clearInterval(watchdog);cancelAnimationFrame(animation);canvas.hidden=true;}
  const controller=new GuideController({stop,change:render,capture:async(config,signal,valid,freeze)=>{
    const frame=await captureCurrentFrame(video,config,signal,valid,freeze);
    try{
      if(!valid()||signal.aborted)throw new Error('本轮已取消。');
      const composition=captureComposition(controller);
      await makePhoto(frame,frame.width,frame.height,{crop:false,rect:config.crop,kind:controller.source==='local'?'本地构图':'AI 引导',sourceWidth:config.sourceWidth,sourceHeight:config.sourceHeight,filter:config.filter,adjustments:config.adjustments,lighting:config.lighting,subjectBox:composition.subjectBox,crops:composition.crops,diagnostics:composition,recommended:true,reason:controller.plan.lookReason||controller.plan.advice,valid:()=>valid()&&!signal.aborted});
    }finally{frame.width=frame.height=1;}
  }});
  function update(){
    const camera=getCamera(),status=ai.status(),supported=typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined';
    $('liveSection').hidden=!status.live;
    $('retouchNotice').textContent='AI 从当前画面选择主体、构图和色彩；拍后可调整风格与曝光。';
    $('guideButton').disabled=!status.configured||!camera.ready||camera.mirrored||!supported||starting||controller.active();
    $('guideButton').textContent=controller.state==='LOST'?'按当前画面继续':'AI 帮我拍';
    $('cancelGuide').hidden=!starting&&!controller.active()&&controller.state!=='LOST';
    $('autoCapture').disabled=starting||controller.active();
    $('zoomMode').disabled=starting||(controller.active()&&!['READY','SETTLING'].includes(controller.state));
    $('liveLook').hidden=!controller.config||!['READY','SETTLING'].includes(controller.state);
    $('motionButton').disabled=motion.enabled||motion.status==='requesting'||starting||controller.active();
    $('guideHud').hidden=!starting&&!controller.active()&&controller.state!=='LOST';
    $('liveRecommend').textContent=controller.source==='local'?'恢复本地建议':'恢复 AI 推荐';
    $('guideMotion').textContent=motion.feedback(controller.coaching?.action);
    $('guideHint').textContent=starting?'正在加载本地图像追踪…':controller.message;
    const config=controller.config;
    $('guideMetrics').textContent=config?`${(controller.base.sw/config.crop.sw).toFixed(2)}× 数字裁切 · ${Math.floor(config.crop.sw)} × ${Math.floor(config.crop.sh)} · ${looks.find(f=>f.id===config.filter.id).name} · 曝光 ${config.adjustments?.exposure||0}`:'';
    if(camera.mirrored)$('liveStatus').textContent='实时引导首版仅支持后置相机；自拍请使用普通快门。';
    else if(!supported)$('liveStatus').textContent='此浏览器不支持本地图像追踪，请使用普通快门。';
    else if(!starting&&controller.state==='IDLE')$('liveStatus').textContent=`点击上传一帧；本地跟踪，对准停稳后${$('autoCapture').checked?'自动拍一张':'按白色快门拍摄'}。AI 模式不使用倒计时。`;
  }
  function previewConfig(){
    if(!controller.config)return null;
    const config=controller.config,t=controller.state==='ZOOMING'?Math.min(1,Math.max(0,(performance.now()-controller.zoomStarted)/GUIDE_TUNING.zoomMs)):1;
    const eased=t*t*(3-2*t),crop=controller.currentCrop();
    return {...config,crop,subjectBox:captureComposition(controller).subjectBox,filter:{...config.filter,strength:config.filter.strength*eased},adjustments:Object.fromEntries(Object.entries(config.adjustments||{}).map(([k,v])=>[k,v*eased])),lighting:Object.fromEntries(Object.entries(config.lighting||{}).map(([k,v])=>[k,v*eased]))};
  }
  function overlay(){
    if(!controller.target||!controller.active()||!controller.plan){$('guideOverlay').hidden=true;return;}
    $('guideOverlay').hidden=false;
    const rect=$('viewfinder').getBoundingClientRect(),crop=previewConfig()?.crop||controller.base;
    const p=displayPoint(controller.target,crop,rect.width,rect.height);
    const outside=p.x<0||p.y<0||p.x>rect.width||p.y>rect.height;
    const target=$('guideTarget'),diameter=2*GUIDE_TUNING.radius*Math.min(rect.width,rect.height);target.style.width=target.style.height=`${diameter}px`;target.style.left=`${Math.max(20,Math.min(rect.width-20,p.x))}px`;target.style.top=`${Math.max(20,Math.min(rect.height-20,p.y))}px`;
    target.classList.toggle('outside',outside);target.textContent=outside?'➜':'';target.style.transform=`translate(-50%,-50%) ${outside?`rotate(${Math.atan2(p.y-rect.height/2,p.x-rect.width/2)}rad)`:''}`;
    const progress=controller.state==='ALIGNING'?Math.min(1,(controller.latest.time-controller.stableSince)/GUIDE_TUNING.alignMs):0;
    $('guideProgress').hidden=!['ALIGNING','CORRECTING'].includes(controller.state);$('guideProgress').value=controller.state==='CORRECTING'?controller.coaching?.progress||0:progress;
    const coach=controller.coaching,show=coach&&['GUIDING','CORRECTING'].includes(controller.state);
    for(const [id,box] of [['guideSubject',coach?.actual],['guideGoal',coach?.goal]]){
      const el=$(id);el.hidden=!show||(id==='guideGoal'&&!controller.plan.framing&&controller.state!=='CORRECTING');
      if(show){const x=Math.max(0,box.x),y=Math.max(0,box.y),right=Math.min(1,box.x+box.width),bottom=Math.min(1,box.y+box.height);el.style.left=`${x*100}%`;el.style.top=`${y*100}%`;el.style.width=`${Math.max(0,right-x)*100}%`;el.style.height=`${Math.max(0,bottom-y)*100}%`;}
    }
    const choice=$('guideCrop'),c=controller.plan.crop;
    choice.hidden=!!controller.plan.framing||!['GUIDING','ALIGNING','ZOOMING'].includes(controller.state);
    if(!choice.hidden){const corners=boxCorners(controller.base,{x:c.centerX-c.scale/2,y:c.centerY-c.scale/2,width:c.scale,height:c.scale}).map(p=>displayPoint(point(controller.transform,p),crop,rect.width,rect.height));
      const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));choice.style.left=left+'px';choice.style.top=top+'px';choice.style.width=(Math.max(...corners.map(p=>p.x))-left)+'px';choice.style.height=(Math.max(...corners.map(p=>p.y))-top)+'px';}
    $('guideArrow').hidden=!show||coach.action==='hold';$('guideArrow').textContent=coach?.arrow||'';
    $('guideMotion').textContent=motion.feedback(coach?.action);
  }
  function render(){
    $('viewfinder').classList.toggle('is-guiding',controller.active());
    $('liveSection').dataset.state=controller.state;$('liveStatus').textContent=controller.message;
    $('guideOverlay').dataset.state=controller.state;
    if(controller.plan&&controller.active())$('liveAdvice').textContent=`${controller.source==='local'?'本地构图 · ':''}${controller.plan.subject.label}：${controller.plan.advice}${controller.coaching?' '+controller.coaching.placement:''}`;else $('liveAdvice').textContent='';
    if(controller.config&&controller.config!==lastLookConfig&&['SETTLING','READY'].includes(controller.state)){lastLookConfig=controller.config;writeLook('live',controller.config);$('liveReason').textContent=controller.plan.lookReason||(controller.source==='local'?'已应用本地建议，可调整或还原。':'已应用 AI 推荐，可调整或还原。');}
    if(!controller.config)canvas.hidden=true;
    overlay();update();
  }
  function localReference(source){
    const local=document.createElement('canvas');drawCapture(source,local,{crop:controller.base,filter:{id:'original',strength:0}},{maxEdge:96,filtered:false});
    try{return localComposition(local.getContext('2d',{willReadFrequently:true}).getImageData(0,0,local.width,local.height),{scene:controller.scene});}
    finally{local.width=local.height=1;}
  }
  function resumeTexture(){
    if(controller.state!=='FRAMING'||!tracker||tracker.busy||video.paused||video.readyState<2||video.currentTime===lastRecoveryMedia||performance.now()-lastRecovery<1000)return;
    lastRecovery=performance.now();lastRecoveryMedia=video.currentTime;
    const full=document.createElement('canvas');full.width=video.videoWidth;full.height=video.videoHeight;full.getContext('2d').drawImage(video,0,0);
    try{
      const fallback=localReference(full);if(!fallback.textured)return;
      const sample=tracker.sample(full,video.currentTime,{rebase:true});
      if(sample)controller.resumeLocal(fallback,sample.frameId);
    }finally{full.width=full.height=1;}
  }
  function animate(){
    if(!controller.active()||controller.state==='EXPORTING')return;
    resumeTexture();
    if(controller.config&&performance.now()-lastDraw>=100&&video.readyState>=2){drawCapture(video,canvas,previewConfig(),{maxEdge:360});canvas.hidden=false;lastDraw=performance.now();}
    overlay();animation=requestAnimationFrame(animate);
  }
  function cancel(){epoch++;starting=false;controller.cancel();update();}
  async function start(){
    if(starting||controller.active())return;
    if(!ai.requireUnlock())return;
    const camera=getCamera();if(!camera.ready||camera.mirrored)return;
    cancel();cancelCountdown();starting=true;const token=epoch;
    $('viewfinder').scrollIntoView({block:'start',behavior:'smooth'});
    $('liveStatus').textContent='正在加载本地图像追踪…';update();
    const prospective=controller.runId+1;
    tracker=new TrackingClient(video,prospective,frame=>controller.frame(frame),message=>controller.lose(message));
    let id;
    try{
      await tracker.ready();if(token!==epoch)return;
      // Capture both the AI crop and tracker reference from exactly the same full frame.
      const full=document.createElement('canvas');full.width=video.videoWidth;full.height=video.videoHeight;full.getContext('2d').drawImage(video,0,0);
      const client=tracker;tracker=null; // start() cancels the previous run.
      id=controller.start({width:full.width,height:full.height,ratio:camera.ratio,aspectRatio:camera.aspectRatio,scene:camera.scene,referenceId:crypto.randomUUID(),autoCapture:$('autoCapture').checked,zoomMode:$('zoomMode').value});
      tracker=client;motion.start();
      const tracking=tracker.sample(full,video.currentTime);tracker.start();
      const upload=document.createElement('canvas');drawCapture(full,upload,{crop:controller.base,mirrored:false,filter:{id:'original',strength:0}},{maxEdge:1024,filtered:false});
      controller.fallback=localReference(full);
      const image=upload.toDataURL('image/jpeg',.8).split(',')[1];full.width=full.height=upload.width=upload.height=1;
      starting=false;watchdog=setInterval(()=>controller.tick(),50);animate();update();
      const data=await ai.request('/api/guide-plan',{referenceId:controller.referenceId,scene:camera.scene,aspectRatio:camera.aspectRatio,image,zoomMode:$('zoomMode').value,source:{width:Math.floor(controller.base.sw),height:Math.floor(controller.base.sh)}},controller.abort.signal);
      if(controller.accept(id,data)&&!controller.frameOnly&&controller.plan.compositionKind!=='structure'){
        const b=controller.plan.subject.box,p=referencePoint(controller.base,b.x,b.y);
        tracker?.subject({x:p.x*tracking.width/controller.width,y:p.y*tracking.height/controller.height,width:b.width*controller.base.sw*tracking.width/controller.width,height:b.height*controller.base.sh*tracking.height/controller.height});
      }
    }catch(error){if(token===epoch){starting=false;
      if(controller.active(id)&&controller.fallback&&!controller.abort.signal.aborted&&(error.status>=500||error instanceof TypeError)){
        controller.accept(id,{schemaVersion:1,referenceId:controller.referenceId,plan:null});update();return;
      }
      if(controller.active())controller.lose(error.name==='AbortError'?'分析已取消或超时，请重新分析。':error.message);else if(controller.state==='IDLE'){stop();controller.emit('LOST',error.message);}update();}}
  }
  $('motionButton').onclick=async()=>{
    $('motionButton').disabled=true;const enabled=await motion.enable();
    $('motionStatus').textContent=enabled?'动作辅助已开启；仍以实际画面确认方向和主体大小。':motion.status==='unsupported'?'此浏览器未提供动作数据，继续使用画面引导。':'未获得动作权限，继续使用画面引导。';
    $('motionButton').disabled=enabled;$('motionButton').textContent=enabled?'动作辅助已开启':'开启动作辅助（可选）';
    if(!controller.active())motion.stop();
  };
  $('guideButton').onclick=start;$('cancelGuide').onclick=$('cancelInView').onclick=cancel;$('autoCapture').onchange=update;
  function writeLook(prefix,look){
    $(prefix+'Filter').value=look.filter.id;$(prefix+'Strength').value=look.filter.strength;
    for(const key of ['exposure','contrast','saturation']){const name=key[0].toUpperCase()+key.slice(1);$(prefix+name).value=look.adjustments?.[key]||0;$(prefix+name+'Value').textContent=look.adjustments?.[key]||0;}
  }
  function readLook(prefix){return {filter:{id:$(prefix+'Filter').value,strength:Number($(prefix+'Strength').value)},adjustments:{exposure:Number($(prefix+'Exposure').value),contrast:Number($(prefix+'Contrast').value),saturation:Number($(prefix+'Saturation').value)}};}
  for(const prefix of ['live']){
    const change=()=>{const look=readLook(prefix);writeLook(prefix,look);controller.setLook(look.filter,look.adjustments);};
    for(const suffix of ['Filter','Strength','Exposure','Contrast','Saturation'])$(prefix+suffix).onchange=change;
    $(prefix+'Reset').onclick=()=>{const look={filter:{id:'original',strength:0},adjustments:neutralAdjustments()};writeLook(prefix,look);controller.setLook(look.filter,look.adjustments,{subjectEV:0,backgroundEV:0});};
    $(prefix+'Recommend').onclick=()=>{writeLook(prefix,controller.plan);controller.setLook(controller.plan.filter,controller.plan.adjustments,controller.plan.lighting);};
    $(prefix+'Filter').onchange=()=>{if($(prefix+'Filter').value!=='original'&&Number($(prefix+'Strength').value)===0)$(prefix+'Strength').value=70;change();};
  }
  $('zoomMode').onchange=()=>controller.setZoomMode($('zoomMode').value);
  document.addEventListener('ai-status',update);
  for(const name of ['orientationchange','pagehide'])window.addEventListener(name,cancel);
  screen.orientation?.addEventListener('change',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  video.addEventListener('resize',()=>{if(controller.active()&&(video.videoWidth!==controller.width||video.videoHeight!==controller.height))cancel();});
  return {update,cancel,currentConfig:previewConfig,active:()=>starting||controller.active(),shoot:()=>{if(!controller.active())return false;if(['READY','SETTLING','FRAMING'].includes(controller.state))controller.commit();else $('guideHint').textContent='请先对准目标圈，放大完成后按快门；也可以取消后普通拍摄。';return true;}};
}
