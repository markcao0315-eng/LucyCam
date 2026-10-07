/* Classic worker: the official UMD runtime uses importScripts. All images stay local. */
let tracker,runId,runtime;
const ready=(async()=>{
  importScripts('/vendor/opencv-4.13.0.js');
  // This build's then() resolves with itself; awaiting it loops forever.
  // Resolve a wrapper instead, retaining compatibility with Promise builds.
  const {runtime:cv}=await new Promise((resolve,reject)=>{
    if(self.cv.Mat)resolve({runtime:self.cv});
    else if(self.cv.then)self.cv.then(runtime=>resolve({runtime}),reject);
    else self.cv.onRuntimeInitialized=()=>resolve({runtime:self.cv});
  });
  for(const name of ['Mat','goodFeaturesToTrack','calcOpticalFlowPyrLK','cvtColor'])if(typeof cv[name]!=='function')throw new Error('缺少 OpenCV 追踪函数');
  const {ImageTracker}=await import('./tracking-core.js');
  tracker=new ImageTracker(cv);
  runtime=cv;
  postMessage({type:'ready',build:cv.getBuildInformation().split('\n').slice(0,4).join('\n')});
})();
ready.catch(()=>postMessage({type:'error',reason:'图像追踪组件加载失败。请检查网络，保持当前取景，再点「按当前画面继续」。'}));
self.onmessage=async({data})=>{
  try{
    await ready;
    if(data.type==='subject'){if(data.runId===runId)tracker.setSubject(data.box);return;}
    if(data.type!=='frame')return;
    if(runId===undefined)runId=data.runId;
    if(runId!==data.runId)return;
    if(data.rebase){tracker.dispose();const {ImageTracker}=await import('./tracking-core.js');tracker=new ImageTracker(runtime);}
    const start=performance.now();
    const result=tracker.process(data);
    postMessage({...result,type:'result',runId,frameId:data.frameId,time:data.time,mediaTime:data.mediaTime,width:data.width,height:data.height,processingMs:performance.now()-start,heapBytes:runtime.HEAPU8?.buffer.byteLength});
  }catch{tracker?.dispose();postMessage({type:'error',runId,reason:'追踪计算失败。请让主体完整进入画面并停稳，再点「按当前画面继续」。'});}
};
