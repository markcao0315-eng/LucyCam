import {applyLook} from './photo-utils.js';
self.onmessage=({data})=>{
  try{const pixels=new Uint8ClampedArray(data.buffer),result=applyLook(pixels,data.filter,data.adjustments,data.options);self.postMessage({buffer:pixels.buffer,result},[pixels.buffer]);}
  catch{self.postMessage({error:'照片调色失败，请重新选择风格。'});}
};
