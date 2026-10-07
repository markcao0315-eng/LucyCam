import {chromium} from '@playwright/test';
import {createAppServer} from '../server.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const seconds=Number(process.env.SOAK_SECONDS||600);
if(!Number.isFinite(seconds)||seconds<10||seconds>3600)throw new Error('SOAK_SECONDS must be 10..3600');
const server=createAppServer({env:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.exposeFunction('report',s=>console.log(JSON.stringify(s)));
  const result=await page.evaluate(async seconds=>{
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=480;const c=canvas.getContext('2d',{willReadFrequently:true});
    let seed=71;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    c.fillStyle='#444';c.fillRect(0,0,360,480);for(let i=0;i<1200;i++){c.fillStyle=`rgb(${50+rand()*200},${50+rand()*200},${50+rand()*200})`;c.fillRect(rand()*360,rand()*480,3+rand()*8,3+rand()*8);}
    const original=c.getImageData(0,0,360,480),start=performance.now(),samples=[],memory=[],latencies=[];
    let count=0,valid=0,runs=0,maxHeap=0;
    while(performance.now()-start<seconds*1000){
      const worker=new Worker('/tracking-worker.js');runs++;
      const receive=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Worker timeout')),15000);worker.onmessage=e=>{clearTimeout(timeout);resolve(e.data);};worker.onerror=e=>reject(new Error(e.message));});
      const init=await receive();if(init.type!=='ready')throw new Error(JSON.stringify(init));
      const runStart=performance.now();let frameId=0;
      while(performance.now()-runStart<18000&&performance.now()-start<seconds*1000){
        const frameStart=performance.now(),rgba=original.data.slice().buffer,received=receive();
        worker.postMessage({type:'frame',runId:runs,frameId:++frameId,time:frameStart,mediaTime:frameStart/1000,width:360,height:480,rgba},[rgba]);
        const r=await received;if(!r.initial&&!r.valid)throw new Error(`Tracking failed: ${JSON.stringify(r)}`);
        count++;if(r.valid)valid++;maxHeap=Math.max(maxHeap,r.heapBytes||0);latencies.push(r.processingMs);
        if(frameId===2)memory.push({run:runs,heap:r.heapBytes});
        await new Promise(r=>setTimeout(r,Math.max(0,83-(performance.now()-frameStart))));
      }
      worker.terminate();const s={seconds:Math.round((performance.now()-start)/1000),runs,frames:count,maxWasmHeap:maxHeap};samples.push(s);await window.report(s);
    }
    latencies.sort((a,b)=>a-b);
    return {seconds:(performance.now()-start)/1000,runs,frames:count,validFrames:valid,medianProcessingMs:latencies[Math.floor(latencies.length/2)],p95ProcessingMs:latencies[Math.floor(latencies.length*.95)],maxWasmHeap:maxHeap,perRunWasmHeap:memory,samples};
  },seconds);
  await mkdir('qa-results',{recursive:true});await writeFile('qa-results/tracking-soak.json',JSON.stringify(result,null,2));console.log('Saved qa-results/tracking-soak.json');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
