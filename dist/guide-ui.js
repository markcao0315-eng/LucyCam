import {MotionSensor} from './motion-sensor.js';
import {GuideController} from './guide-controller.js';
import {TrackingClient} from './tracking-client.js';
import {drawCapture,captureCurrentFrame} from './camera-renderer.js';
import {displayPoint,referencePoint,GUIDE_TUNING} from './guide-geometry.js';
import {filters} from './photo-utils.js';
const $=id=>document.getElementById(id);

export function setupGuide({video,getCamera,ai,makePhoto,cancelCountdown}){
  let tracker=null,starting=false,epoch=0,watchdog=null,animation=null,raw=null,reviewConfig=null,lastDraw=0;
  const canvas=$('guidePreview'),motion=new MotionSensor();
  function stop(){motion.stop();tracker?.stop();tracker=null;clearInterval(watchdog);cancelAnimationFrame(animation);canvas.hidden=true;}
  const controller=new GuideController({stop,change:render,capture:async(config,signal,valid,freeze)=>{
    const frame=await captureCurrentFrame(video,config,signal,valid,freeze);
    try{
      if(!valid()||signal.aborted)throw new Error('本轮已取消。');
      await makePhoto(frame,frame.width,frame.height,{crop:false,kind:'AI 引导',filter:config.filter,valid:()=>valid()&&!signal.aborted});
      if(!valid()||signal.aborted){frame.width=frame.height=1;return;}
      clearReview();raw=frame;reviewConfig=config;$('reviewColor').hidden=false;$('reviewFilter').value=config.filter.id;$('reviewStrength').value=config.filter.strength;
    }catch(error){frame.width=frame.height=1;throw error;}
  }});
  function clearReview(){if(raw)raw.width=raw.height=1;raw=null;reviewConfig=null;$('reviewColor').hidden=true;}
  function update(){
    const camera=getCamera(),status=ai.status(),supported=typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined';
    $('liveSection').hidden=!status.live;
    $('guideButton').disabled=!status.configured||!camera.ready||camera.mirrored||!supported||starting||controller.active();
    $('guideButton').textContent=controller.state==='LOST'?'按当前画面继续':'AI 帮我拍';
    $('cancelGuide').hidden=!starting&&!controller.active()&&controller.state!=='LOST';
    $('autoCapture').disabled=starting||controller.active();
    $('motionButton').disabled=motion.enabled||motion.status==='requesting'||starting||controller.active();
    $('guideHud').hidden=!starting&&!controller.active()&&controller.state!=='LOST';
    $('guideMotion').textContent=motion.feedback(controller.coaching?.action);
    $('guideHint').textContent=starting?'正在加载本地图像追踪…':controller.message;
    const config=controller.config;
    $('guideMetrics').textContent=config?`${config.preserveScale?'保持原取景':(controller.base.sw/config.crop.sw).toFixed(2)+'× 数字裁切'} · ${Math.floor(config.crop.sw)} × ${Math.floor(config.crop.sh)}${config.crop.adjusted?' · 已适配画面':''} · ${filters.find(f=>f.id===config.filter.id).name}`:'';
    if(camera.mirrored)$('liveStatus').textContent='实时引导首版仅支持后置相机；自拍请使用普通快门。';
    else if(!supported)$('liveStatus').textContent='此浏览器不支持本地图像追踪，请使用普通快门。';
    else if(!starting&&controller.state==='IDLE')$('liveStatus').textContent=`点击上传一帧；本地跟踪，对准停稳后${$('autoCapture').checked?'自动拍一张':'按白色快门拍摄'}。AI 模式不使用倒计时。`;
  }
  function previewConfig(){
    if(!controller.config)return null;
    const config=controller.config,t=controller.state==='ZOOMING'?Math.min(1,Math.max(0,(performance.now()-controller.zoomStarted)/GUIDE_TUNING.zoomMs)):1;
    const eased=t*t*(3-2*t),crop=controller.currentCrop();
    return {...config,crop,filter:{...config.filter,strength:config.filter.strength*eased}};
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
    $('guideProgress').value=controller.state==='CORRECTING'?controller.coaching?.progress||0:progress;
    const coach=controller.coaching,show=coach&&['GUIDING','CORRECTING'].includes(controller.state);
    for(const [id,box] of [['guideSubject',coach?.actual],['guideGoal',coach?.goal]]){
      const el=$(id);el.hidden=!show;
      if(show){const x=Math.max(0,box.x),y=Math.max(0,box.y),right=Math.min(1,box.x+box.width),bottom=Math.min(1,box.y+box.height);el.style.left=`${x*100}%`;el.style.top=`${y*100}%`;el.style.width=`${Math.max(0,right-x)*100}%`;el.style.height=`${Math.max(0,bottom-y)*100}%`;}
    }
    $('guideArrow').hidden=!show||coach.action==='hold';$('guideArrow').textContent=coach?.arrow||'';
    $('guideMotion').textContent=motion.feedback(coach?.action);
  }
  function render(){
    $('viewfinder').classList.toggle('is-guiding',controller.active());
    $('liveSection').dataset.state=controller.state;$('liveStatus').textContent=controller.message;
    $('guideOverlay').dataset.state=controller.state;
    if(controller.plan&&controller.active())$('liveAdvice').textContent=`${controller.plan.subject.label}：${controller.plan.advice}${controller.coaching?' '+controller.coaching.placement:''}`;else $('liveAdvice').textContent='';
    if(!controller.config)canvas.hidden=true;
    overlay();update();
  }
  function animate(){
    if(!controller.active()||controller.state==='EXPORTING')return;
    if(controller.config&&performance.now()-lastDraw>=100&&video.readyState>=2){drawCapture(video,canvas,previewConfig(),{maxEdge:360});canvas.hidden=false;lastDraw=performance.now();}
    overlay();animation=requestAnimationFrame(animate);
  }
  function cancel(){epoch++;starting=false;controller.cancel();update();}
  async function start(){
    if(starting||controller.active())return;
    if(!ai.requireUnlock())return;
    const camera=getCamera();if(!camera.ready||camera.mirrored)return;
    cancel();clearReview();cancelCountdown();starting=true;const token=epoch;
    $('viewfinder').scrollIntoView({block:'start',behavior:'smooth'});
    $('liveStatus').textContent='正在加载本地图像追踪…';update();
    const prospective=controller.runId+1;
    tracker=new TrackingClient(video,prospective,frame=>controller.frame(frame),message=>controller.lose(message));
    try{
      await tracker.ready();if(token!==epoch)return;
      // Capture both the AI crop and tracker reference from exactly the same full frame.
      const full=document.createElement('canvas');full.width=video.videoWidth;full.height=video.videoHeight;full.getContext('2d').drawImage(video,0,0);
      const client=tracker;tracker=null; // start() cancels the previous run.
      const id=controller.start({width:full.width,height:full.height,ratio:camera.ratio,aspectRatio:camera.aspectRatio,scene:camera.scene,referenceId:crypto.randomUUID(),autoCapture:$('autoCapture').checked});
      tracker=client;motion.start();
      const tracking=tracker.sample(full,video.currentTime);tracker.start();
      const upload=document.createElement('canvas');drawCapture(full,upload,{crop:controller.base,mirrored:false,filter:{id:'original',strength:0}},{maxEdge:1024,filtered:false});
      const image=upload.toDataURL('image/jpeg',.8).split(',')[1];full.width=full.height=upload.width=upload.height=1;
      starting=false;watchdog=setInterval(()=>controller.tick(),50);animate();update();
      const data=await ai.request('/api/guide-plan',{referenceId:controller.referenceId,scene:camera.scene,aspectRatio:camera.aspectRatio,image},controller.abort.signal);
      if(controller.accept(id,data)){
        const b=data.plan.subject.box,p=referencePoint(controller.base,b.x,b.y);
        tracker?.subject({x:p.x*tracking.width/controller.width,y:p.y*tracking.height/controller.height,width:b.width*controller.base.sw*tracking.width/controller.width,height:b.height*controller.base.sh*tracking.height/controller.height});
      }
    }catch(error){if(token===epoch){starting=false;if(controller.active())controller.lose(error.name==='AbortError'?'分析已取消或超时，请重新分析。':error.message);else if(controller.state==='IDLE'){stop();controller.emit('LOST',error.message);}update();}}
  }
  $('motionButton').onclick=async()=>{
    $('motionButton').disabled=true;const enabled=await motion.enable();
    $('motionStatus').textContent=enabled?'动作辅助已开启；仍以实际画面确认方向和主体大小。':motion.status==='unsupported'?'此浏览器未提供动作数据，继续使用画面引导。':'未获得动作权限，继续使用画面引导。';
    $('motionButton').disabled=enabled;$('motionButton').textContent=enabled?'动作辅助已开启':'开启动作辅助（可选）';
    if(!controller.active())motion.stop();
  };
  $('guideButton').onclick=start;$('cancelGuide').onclick=$('cancelInView').onclick=cancel;$('autoCapture').onchange=update;
  async function recolor(){
    if(!raw||!reviewConfig)return;
    const saved=raw,id=epoch;$('reviewFilter').disabled=$('reviewStrength').disabled=true;
    try{await makePhoto(saved,saved.width,saved.height,{crop:false,kind:'AI 引导',filter:{id:$('reviewFilter').value,strength:Number($('reviewStrength').value)},valid:()=>raw===saved&&id===epoch&&!document.hidden});}
    catch(error){$('saveStatus').textContent=error.message;}finally{$('reviewFilter').disabled=$('reviewStrength').disabled=false;}
  }
  $('reviewFilter').onchange=$('reviewStrength').onchange=recolor;
  document.addEventListener('ai-status',update);
  for(const name of ['orientationchange','pagehide'])window.addEventListener(name,cancel);
  screen.orientation?.addEventListener('change',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  video.addEventListener('resize',()=>{if(controller.active()&&(video.videoWidth!==controller.width||video.videoHeight!==controller.height))cancel();});
  return {update,cancel,clearReview,currentConfig:previewConfig,active:()=>starting||controller.active()};
}
