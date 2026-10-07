const $=id=>document.getElementById(id);
export function setupRetouch({ai,makePhoto,setBusy,video,onCancel=()=>{}}){
  let original=null,edited=null,showingOriginal=false,controller=null,generation=0;
  function clear(){for(const c of [original,edited])if(c)c.width=c.height=1;original=edited=null;$('compareOriginal').hidden=true;}
  function cancel(){generation++;controller?.abort();controller=null;setBusy(false);$('retouchDialog').close();if(!document.hidden)video.play().catch(()=>{});}
  async function show(source,kind,valid=()=>true){await makePhoto(source,source.width,source.height,{crop:false,kind,filter:{id:'original',strength:0},valid});}
  async function process(source,{signal,valid=()=>true}={}){
    if(controller)throw new Error('已有照片正在修图。');
    clear();const id=++generation;controller=new AbortController();const own=controller;
    const active=()=>id===generation&&!own.signal.aborted&&!signal?.aborted&&!document.hidden&&valid();
    original=document.createElement('canvas');original.width=source.width;original.height=source.height;original.getContext('2d').drawImage(source,0,0);
    $('retouchTitle').textContent='AI 正在处理中';$('saveRetouchOriginal').hidden=true;$('retouchStatus').textContent='正在优化构图、光线和肤质，请稍候…';
    if($('photoDialog').open)$('photoDialog').close();$('retouchDialog').showModal();video.pause();setBusy(true);
    const onAbort=()=>{if(id===generation)cancel();};signal?.addEventListener('abort',onAbort,{once:true});
    try{
      if(!active())throw new DOMException('已取消','AbortError');
      const upload=document.createElement('canvas'),scale=Math.min(1,2048/Math.max(original.width,original.height));
      upload.width=Math.round(original.width*scale);upload.height=Math.round(original.height*scale);upload.getContext('2d').drawImage(original,0,0,upload.width,upload.height);
      const image=upload.toDataURL('image/jpeg',.9).split(',')[1];upload.width=upload.height=1;
      const result=await ai.request('/api/retouch',{image,requestId:crypto.randomUUID()},AbortSignal.any([own.signal,...(signal?[signal]:[]),AbortSignal.timeout(165000)]));
      if(!active())throw new DOMException('已取消','AbortError');
      const img=new Image();img.src=`data:image/jpeg;base64,${result.image}`;await img.decode();
      if(!active())throw new DOMException('已取消','AbortError');
      edited=document.createElement('canvas');edited.width=img.naturalWidth;edited.height=img.naturalHeight;edited.getContext('2d').drawImage(img,0,0);img.src='';
      await show(edited,'AI 修图',active);if(!active())throw new DOMException('已取消','AbortError');
      showingOriginal=false;$('compareOriginal').hidden=false;$('compareOriginal').textContent='查看原片';$('retouchDialog').close();
    }catch(error){
      if(active()){$('retouchTitle').textContent='修图未完成';$('retouchStatus').textContent=error.name==='TimeoutError'?'AI 修图超时，原片已保留，没有自动重试。':error.message;$('saveRetouchOriginal').hidden=false;return false;}
      throw error;
    }finally{signal?.removeEventListener('abort',onAbort);if(id===generation){controller=null;setBusy(false);}}
    return true;
  }
  const cancelByUser=()=>{cancel();onCancel();};
  $('cancelRetouch').onclick=cancelByUser;$('retouchDialog').addEventListener('cancel',event=>{event.preventDefault();cancelByUser();});
  async function showRetained(asOriginal){
    if($('compareOriginal').disabled)return;const saved=asOriginal?original:edited,id=generation;if(!saved)return;
    $('compareOriginal').disabled=$('saveRetouchOriginal').disabled=true;setBusy(true);
    try{await show(saved,asOriginal?'AI 原片':'AI 修图',()=>id===generation&&!document.hidden);showingOriginal=asOriginal;$('compareOriginal').textContent=asOriginal?'查看 AI 成片':'查看原片';$('retouchDialog').close();}
    catch(error){$('retouchStatus').textContent=$('saveStatus').textContent=error.message;}
    finally{$('compareOriginal').disabled=$('saveRetouchOriginal').disabled=false;setBusy(false);}
  }
  $('saveRetouchOriginal').onclick=()=>showRetained(true);
  $('compareOriginal').onclick=()=>showRetained(!showingOriginal);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&controller)cancel();});
  window.addEventListener('pagehide',()=>{cancel();clear();});
  return {process,clear,cancel};
}
