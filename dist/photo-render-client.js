import {applyLook} from './photo-utils.js';
// Full-size editing is off the UI thread, so cancel/close remains responsive.
// Small previews share the same pixel recipe directly in camera-renderer.
export function renderPixels(pixels,filter,adjustments,options,valid){
  if(!valid())return Promise.reject(new Error('拍摄已取消。'));
  if(typeof Worker==='undefined'){const result=applyLook(pixels.data,filter,adjustments,options);return Promise.resolve({pixels,result});}
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./photo-render-worker.js',import.meta.url),{type:'module'});
    let timer,timeout;const cleanup=()=>{clearInterval(timer);clearTimeout(timeout);worker.terminate();};
    const fail=message=>{cleanup();reject(new Error(message));};
    worker.onerror=()=>fail('照片处理组件加载失败，请刷新后重试。');
    worker.onmessage=({data})=>{cleanup();if(!valid())return reject(new Error('拍摄已取消。'));if(data.error)return reject(new Error(data.error));resolve({pixels:new ImageData(new Uint8ClampedArray(data.buffer),pixels.width,pixels.height),result:data.result});};
    timer=setInterval(()=>{if(!valid())fail('拍摄已取消。');},50);timeout=setTimeout(()=>fail('照片处理超时，请重试。'),30000);
    worker.postMessage({buffer:pixels.data.buffer,filter,adjustments,options},[pixels.data.buffer]);
  });
}
