import {setupRetouch} from './retouch-ui.js';
import {setupGuide} from './guide-ui.js';
import {setupAI} from './ai-ui.js';
import {setupPhotoEditor} from './photo-editor.js';
import {renderPixels} from './photo-render-client.js';
import {filters,looks,cropRect,outputSize,cssFilter} from './photo-utils.js';
const $=id=>document.getElementById(id);
$('appVersion').textContent='v0.9.1';
const video=$('video');
let guide=null,retouch=null,editor=null;
const state={stream:null,facing:'environment',mirrored:false,ratio:0,timer:0,filter:'original',strength:70,scene:'auto',grid:true,busy:false,opening:false,request:0,countToken:0,photo:null};
const ratios=[{label:'3:4',value:3/4},{label:'1:1',value:1},{label:'9:16',value:9/16}];
const tips={portrait:'保持当前距离，AI 会结合人物、背景和留白建议镜头方向，不套用固定人像框。',travel:'保留人物与景色的关系，AI 根据当前画面决定主体位置。',landscape:'AI 根据当前画面的线条、地平线和留白建议构图。'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function tell(message){$('status').textContent=message;}
function updateControls(){const ready=!!state.stream&&video.readyState>=2&&!state.busy&&!state.opening;$('shutter').disabled=!ready;$('flipButton').disabled=!ready;$('importButton').disabled=state.busy||state.opening;$('importStartButton').disabled=state.busy||state.opening;$('startButton').disabled=state.opening||state.busy;$('ratioButton').disabled=state.busy;$('timerButton').disabled=state.busy;ai.update();guide?.update();}
function releaseStream(){guide?.cancel();if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}video.srcObject=null;video.classList.remove('mirrored');$('resolution').textContent='';updateControls();}
function cancelCountdown(){state.countToken++;$('countdown').hidden=true;}
function showStart(message='点击继续使用相机。'){$('startPanel').hidden=false;$('startMessage').textContent=message;$('cameraStatus').textContent='相机未开启';$('startButton').textContent='开启相机';}
async function startCamera(){
  if(state.opening||state.busy)return;
  state.opening=true;const request=++state.request;releaseStream();updateControls();$('startButton').textContent='正在开启…';
  try{
    if(!window.isSecureContext)throw new Error('请通过 HTTPS 演示网址打开。普通局域网 HTTP 地址无法使用 iPhone 相机。');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('此浏览器无法调用相机，请在 Safari 中打开。');
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:state.facing},width:{ideal:2560},height:{ideal:1920}}});
    if(request!==state.request||document.hidden){stream.getTracks().forEach(t=>t.stop());return;}
    state.stream=stream;const track=stream.getVideoTracks()[0];const settings=track.getSettings();
    state.mirrored=(settings.facingMode||state.facing)==='user';video.classList.toggle('mirrored',state.mirrored);
    video.srcObject=stream;await video.play();
    if(request!==state.request)return;
    if(!video.videoWidth)await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('相机画面尚未准备好，请重试。')),8000);video.addEventListener('loadeddata',()=>{clearTimeout(timeout);resolve();},{once:true});});
    if(request!==state.request)return;
    $('startPanel').hidden=true;$('cameraStatus').textContent=state.mirrored?'前置 · 镜像':'实时取景';
    $('resolution').textContent=`${video.videoWidth} × ${video.videoHeight}`;updateGuide();
    tell('调整构图后，按白色快门。普通拍照不会上传。');
    track.addEventListener('ended',()=>{if(state.stream===stream){releaseStream();showStart('相机已中断，请重新开启。');}},{once:true});
  }catch(error){if(request===state.request){releaseStream();const messages={NotAllowedError:'相机权限未获允许。请在 Safari 网站设置中允许相机，再重试；也可以先选择照片体验滤镜。',NotFoundError:'没有找到摄像头。请用 iPhone 的 Safari 打开演示网址。',NotReadableError:'摄像头暂时无法使用，请关闭其他正在用相机的应用后重试。'};showStart(messages[error.name]||error.message||'相机启动失败，请重试。');tell('仍可通过「选照片」体验滤镜和保存。');}}
  finally{if(request===state.request){state.opening=false;$('startButton').textContent='开启相机';updateControls();}}
}
function updateGuide(){
  $('grid').hidden=!state.grid;
  $('guideText').textContent=tips[state.scene]||'把眼前画面交给 AI：发现值得拍的主体，选一个更好的构图，再推荐适合的色彩。';
  $('sceneTabs').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scene===state.scene)));
}
function setFilter(id){guide?.cancel();if(!filters.some(f=>f.id===id))throw new Error('不存在的滤镜');state.filter=id;updateFilter();}
function updateFilter(){video.style.filter=cssFilter(state.filter,state.strength);$('filterName').textContent=filters.find(f=>f.id===state.filter).name;$('strength').disabled=state.filter==='original';$('filterList').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter)));$('strengthValue').textContent=state.strength+'%';}
for(const f of filters){const b=document.createElement('button');b.dataset.filter=f.id;b.setAttribute('aria-label',f.name+'滤镜');b.setAttribute('aria-pressed',String(f.id===state.filter));const swatch=document.createElement('span');swatch.className='filter-swatch';swatch.style.filter=cssFilter(f.id,100);swatch.setAttribute('aria-hidden','true');b.append(swatch,document.createTextNode(f.name));b.onclick=()=>setFilter(f.id);$('filterList').append(b);}
async function makePhoto(source,width,height,options={}){
  const {crop=true,mirrored=false,kind='拍摄',filter={id:state.filter,strength:state.strength},adjustments={},lighting={},subjectBox=null,renderOnly=false,rect:explicitRect=null,valid=()=>true}=options;
  const rect=explicitRect||(crop?cropRect(width,height,ratios[state.ratio].value):{sx:0,sy:0,sw:width,sh:height});
  if(!renderOnly&&!['AI 修图','AI 原片'].includes(kind))return editor.open(source,width,height,{...options,rect,mirrored,kind,filter});
  if(!['AI 修图','AI 原片'].includes(kind))retouch?.clear();
  const filterId=filter.id,strength=filter.strength;
  const size=outputSize(rect.sw,rect.sh);const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
  const context=canvas.getContext('2d',{willReadFrequently:filterId!=='original'});if(!context)throw new Error('无法处理照片，请关闭其他网页后重试。');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);if(mirrored){context.translate(canvas.width,0);context.scale(-1,1);}context.drawImage(source,rect.sx,rect.sy,rect.sw,rect.sh,0,0,canvas.width,canvas.height);context.setTransform(1,0,0,1,0,0);

  let lookResult={locallyAdjusted:false};
  if((filterId!=='original'&&strength>0)||Object.values(adjustments).some(v=>v)||Object.values(lighting).some(v=>v)){
    await delay(20);if(!valid()){canvas.width=canvas.height=1;throw new Error('拍摄已取消。');}
    const pixels=context.getImageData(0,0,canvas.width,canvas.height),b=subjectBox;
    const rendered=await renderPixels(pixels,filter,adjustments,{width:canvas.width,height:canvas.height,subjectBox:b?{x:(b.x-rect.sx)/rect.sw,y:(b.y-rect.sy)/rect.sh,width:b.width/rect.sw,height:b.height/rect.sh}:null,lighting},valid);
    lookResult=rendered.result;context.putImageData(rendered.pixels,0,0);
  }
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('照片导出失败，请重试。')),'image/jpeg',.95));canvas.width=1;canvas.height=1;
  const name=`LucyCam-${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`;
  if(!valid())throw new Error('拍摄已取消。');
  if(['AI 修图','AI 原片'].includes(kind))editor?.clear();
  const url=URL.createObjectURL(blob);const previous=state.photo;
  state.photo={blob,url,file:new File([blob],name,{type:'image/jpeg'}),width:size.width,height:size.height,name,kind,filter:looks.find(f=>f.id===filterId).name};
  $('photoPreview').src=url;$('lastThumbnail').replaceChildren(Object.assign(document.createElement('img'),{src:url,alt:''}));$('lastPhoto').disabled=false;
  if(previous)URL.revokeObjectURL(previous.url);showPhoto(true);return {...size,...lookResult};
}
function showPhoto(fromCapture=false){if(!fromCapture)guide?.cancel();if(!state.photo)return;const p=state.photo;$('photoMeta').textContent=`${p.kind==='本地构图'?'本地构图 · ':''}${p.width} × ${p.height} · ${['AI 修图','AI 原片'].includes(p.kind)?p.kind:p.filter} · ${(p.blob.size/1024/1024).toFixed(1)} MB`;$('saveStatus').textContent='尚未保存到相册，请使用下方按钮或长按照片。';const canShare=!!navigator.share&&!!navigator.canShare?.({files:[p.file]});$('shareButton').hidden=!canShare;$('downloadButton').textContent=canShare?'下载图片':'下载图片 / 保存备用';if(!$('photoDialog').open)$('photoDialog').showModal();video.pause();}
async function capture(){
  if(guide?.shoot())return;
  const guided=guide?.active(),config=guide?.currentConfig();guide?.cancel();
  if(state.busy||!state.stream||video.readyState<2)return;
  state.busy=true;updateControls();const token=++state.countToken;
  try{for(let n=guided?0:state.timer;n>0;n--){$('countdown').hidden=false;$('countdown').textContent=n;await delay(1000);if(token!==state.countToken||!state.stream)return;}$('countdown').hidden=true;
    if(document.hidden)return;tell('正在处理照片…');await makePhoto(video,video.videoWidth,video.videoHeight,{mirrored:state.mirrored,rect:config?.crop,filter:config?.filter,valid:()=>token===state.countToken&&!document.hidden});tell('拍摄完成，请在预览里保存。');
  }catch(error){tell(error.message||'拍照失败，请重试。');}finally{$('countdown').hidden=true;state.busy=false;updateControls();}
}
async function importPhoto(file){
  guide?.cancel();
  if(!file||state.busy)return;if(file.size>40*1024*1024){tell('这张照片过大，请选择小于 40 MB 的照片。');return;}
  state.busy=true;updateControls();tell('正在读取照片…');const url=URL.createObjectURL(file);
  try{const img=new Image();img.src=url;await img.decode();if(!img.naturalWidth)throw new Error('无法读取这张照片。');await makePhoto(img,img.naturalWidth,img.naturalHeight,{crop:false,kind:'导入'});tell('照片已处理。请在预览里保存。');}
  catch{tell('无法读取这张照片。请尝试 JPEG 或 PNG；HEIC 支持取决于浏览器。');}
  finally{URL.revokeObjectURL(url);$('fileInput').value='';state.busy=false;updateControls();}
}
$('startButton').onclick=startCamera;
$('flipButton').onclick=()=>{state.facing=state.facing==='environment'?'user':'environment';startCamera();};
$('shutter').onclick=capture;
$('gridButton').onclick=()=>{state.grid=!state.grid;$('gridButton').setAttribute('aria-pressed',String(state.grid));updateGuide();};
$('ratioButton').onclick=()=>{guide?.cancel();state.ratio=(state.ratio+1)%ratios.length;$('ratioButton').textContent=ratios[state.ratio].label;$('viewfinder').style.aspectRatio=String(ratios[state.ratio].value);};
$('timerButton').onclick=()=>{guide?.cancel();state.timer=state.timer===0?3:state.timer===3?10:0;$('timerButton').textContent='定时 '+(state.timer?state.timer+'秒':'关');};
$('sceneTabs').onclick=e=>{const b=e.target.closest('[data-scene]');if(b){guide?.cancel();state.scene=b.dataset.scene;updateGuide();}};
$('strength').oninput=e=>{guide?.cancel();state.strength=Number(e.target.value);updateFilter();};
$('importButton').onclick=$('importStartButton').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>importPhoto(e.target.files[0]);
$('lastPhoto').onclick=()=>showPhoto();
$('closePhoto').onclick=$('retakeButton').onclick=()=>$('photoDialog').close();
$('photoDialog').addEventListener('close',()=>{if(state.stream&&!document.hidden)video.play().catch(()=>{releaseStream();showStart('请点开启相机继续拍照。');});});
$('shareButton').onclick=async()=>{
  const photo=state.photo;if(!photo)return;try{await navigator.share({files:[photo.file]});$('saveStatus').textContent='已返回照片预览；请到「照片」App 确认是否已保存。';}
  catch(error){$('saveStatus').textContent=error.name==='AbortError'?'已关闭分享。照片仍在这里，可以重试或长按保存。':'未能打开分享菜单，请长按照片保存，或使用下载图片。';}
};
$('downloadButton').onclick=()=>{if(!state.photo)return;const a=document.createElement('a');a.href=state.photo.url;a.download=state.photo.name;document.body.append(a);a.click();a.remove();$('saveStatus').textContent='已请求下载。iPhone 下载通常进入「文件」App；要进相册，请长按上方照片或使用分享中的「存储图像」。';};
$('helpButton').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=$('doneHelp').onclick=()=>$('helpDialog').close();
function suspend(){state.request++;state.opening=false;cancelCountdown();releaseStream();showStart('相机已暂停。返回后点击开启相机继续。');}
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});window.addEventListener('pagehide',suspend);
video.addEventListener('resize',()=>{if(state.stream)$('resolution').textContent=`${video.videoWidth} × ${video.videoHeight}`;});
const ai=setupAI({video,getCamera:()=>({active:!!state.stream,ready:!!state.stream&&video.readyState>=2&&!state.busy&&!state.opening,mirrored:state.mirrored,ratio:ratios[state.ratio].value,scene:state.scene}),beforeAnalyze:()=>guide?.cancel(),setBusy:value=>{state.busy=value;updateControls();},makePhoto});
retouch=setupRetouch({ai,makePhoto,video,setBusy:value=>{state.busy=value;updateControls();},onCancel:()=>guide?.cancel()});
editor=setupPhotoEditor({makePhoto});
guide=setupGuide({video,ai,makePhoto,cancelCountdown,getCamera:()=>({ready:!!state.stream&&video.readyState>=2&&!state.busy&&!state.opening,mirrored:state.mirrored,ratio:ratios[state.ratio].value,aspectRatio:ratios[state.ratio].label,scene:state.scene})});
updateGuide();updateFilter();updateControls();
// Optional browser agent access exposes settings only; it never captures or shares images.
const modelContext=document.modelContext;
if(modelContext?.registerTool){const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_camera_settings',description:'Read LucyCam camera and filter settings. Does not access photo pixels.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({cameraActive:!!state.stream,scene:state.scene,filter:state.filter,strength:state.strength,ratio:ratios[state.ratio].label,aiAvailable:ai.available()})});
  register({name:'set_photo_filter',description:'Set the current preview and next photo filter. Does not capture, upload or save a photo.',inputSchema:{type:'object',properties:{filter:{type:'string',enum:filters.map(f=>f.id)}},required:['filter'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='filter')||!filters.some(f=>f.id===input.filter))throw new Error('无效的滤镜');setFilter(input.filter);return {filter:state.filter};}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

document.addEventListener('ai-status',()=>{$('retouchPhoto').hidden=!ai.status().retouch;});
$('retouchPhoto').onclick=async()=>{
  if(!state.photo||state.busy||!ai.requireUnlock())return;guide?.cancel();
  const source=state.photo,img=new Image();img.src=source.url;
  try{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);try{await retouch.process(c);}finally{c.width=c.height=1;}}
  catch(error){if(error.name!=='AbortError')tell(error.message);}
};
