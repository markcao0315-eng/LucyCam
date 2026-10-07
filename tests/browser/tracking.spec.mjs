import {test,expect} from '@playwright/test';
import {createAppServer} from '../../server.mjs';
let server,base;
test.beforeAll(async()=>{server=createAppServer({env:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
test('official OpenCV in Worker measures image translation, rotation and scale; rejects white wall',async({page})=>{
  await page.goto(base);
  const result=await page.evaluate(async()=>{
    const worker=new Worker('/tracking-worker.js');
    const receive=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker timed out')),15000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=e=>reject(new Error(e.message));});
    const ready=await receive();if(ready.type!=='ready')throw new Error(JSON.stringify(ready));
    const texture=document.createElement('canvas');texture.width=480;texture.height=360;const t=texture.getContext('2d');
    t.fillStyle='#444';t.fillRect(0,0,480,360);let seed=42;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    for(let i=0;i<1800;i++){t.fillStyle=`rgb(${50+rand()*200},${50+rand()*200},${50+rand()*200})`;t.fillRect(rand()*480,rand()*360,3+rand()*9,3+rand()*9);}
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=360;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const frames=[];
    for(let i=0;i<8;i++){
      ctx.resetTransform();ctx.fillStyle='#444';ctx.fillRect(0,0,480,360);
      const angle=i*.002,scale=1+i*.001,a=Math.cos(angle)*scale,b=Math.sin(angle)*scale;
      ctx.setTransform(a,b,-b,a,-i*2,i);ctx.drawImage(texture,0,0);ctx.resetTransform();
      const rgba=ctx.getImageData(0,0,480,360).data.buffer,received=receive();
      worker.postMessage({type:'frame',runId:1,frameId:i+1,width:480,height:360,time:i*100,rgba},[rgba]);frames.push(await received);
    }
    ctx.fillStyle='white';ctx.fillRect(0,0,480,360);const rgba=ctx.getImageData(0,0,480,360).data.buffer,received=receive();
    worker.postMessage({type:'frame',runId:1,frameId:9,width:480,height:360,time:800,rgba},[rgba]);const wall=await received;worker.terminate();
    return {ready,frames,wall};
  });
  console.log(JSON.stringify({build:result.ready.build,last:result.frames.at(-1),wall:result.wall}));
  for(const frame of result.frames.slice(1))expect(frame.valid).toBe(true);
  const m=result.frames.at(-1).transform;
  expect(m[2]).toBeCloseTo(-14,0);expect(m[5]).toBeCloseTo(7,0);
  expect(m[3]).toBeCloseTo(Math.sin(.014)*1.007,2);
  expect(result.wall.valid).toBe(false);
});

test('image blur, darkness, occlusion and sudden scene changes stop the actual tracker',async({page})=>{
  await page.goto(base);
  const results=await page.evaluate(async()=>{
    const results={};
    for(const scenario of ['blur','dark','occlusion','cut']){
      const worker=new Worker('/tracking-worker.js');
      const receive=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('worker timeout')),15000);worker.onmessage=e=>{clearTimeout(timeout);resolve(e.data);};});
      await receive();const canvas=document.createElement('canvas');canvas.width=360;canvas.height=480;const c=canvas.getContext('2d',{willReadFrequently:true});
      c.fillStyle='#444';c.fillRect(0,0,360,480);let seed=73;
      const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
      for(let i=0;i<1300;i++){c.fillStyle=`rgb(${rand()*255},${rand()*255},${rand()*255})`;c.fillRect(rand()*360,rand()*480,4+rand()*10,4+rand()*10);}
      const initial=c.getImageData(0,0,360,480);
      const send=async(i)=>{const rgba=c.getImageData(0,0,360,480).data.buffer,p=receive();worker.postMessage({type:'frame',runId:1,frameId:i+1,time:i*100,width:360,height:480,rgba},[rgba]);return p;};
      await send(0);const stable=await send(1);
      if(scenario==='blur'){const source=document.createElement('canvas');source.width=360;source.height=480;source.getContext('2d').putImageData(initial,0,0);c.filter='blur(15px)';c.drawImage(source,0,0);c.filter='none';}
      if(scenario==='dark'){c.fillStyle='#010101';c.fillRect(0,0,360,480);}
      if(scenario==='occlusion'){c.fillStyle='#111';c.fillRect(0,0,310,480);}
      if(scenario==='cut'){for(let i=0;i<initial.data.length;i+=4){initial.data[i]=rand()*255;initial.data[i+1]=rand()*255;initial.data[i+2]=rand()*255;}c.putImageData(initial,0,0);}
      const changed=await send(2);worker.terminate();results[scenario]={stable:stable.valid,changed:changed.valid};
    }return results;
  });
  for(const [name,result] of Object.entries(results)){expect(result.stable,name).toBe(true);expect(result.changed,name).toBe(false);}
});

test('shared renderer preserves all aspect ratios and mirrored landmarks; fixed color chart matches export filter',async({page})=>{
  await page.goto(base);
  const results=await page.evaluate(async()=>{
    const {drawCapture}=await import('/camera-renderer.js'),{cropRect,applyPixels}=await import('/photo-utils.js');
    const source=document.createElement('canvas');source.width=1200;source.height=1600;const c=source.getContext('2d');
    const colors=[[240,40,30],[20,230,70],[30,40,220],[180,180,180]];
    colors.forEach((rgb,i)=>{c.fillStyle=`rgb(${rgb})`;c.fillRect((i%2)*600,Math.floor(i/2)*800,600,800);});
    const results=[];
    for(const ratio of [.75,1,9/16])for(const mirrored of [false,true])for(const id of ['original','clear','warm','film','mono']){
      const base=cropRect(1200,1600,ratio),crop={sx:base.sx+base.sw*.1,sy:base.sy+base.sh*.1,sw:base.sw*.8,sh:base.sh*.8},config={crop,mirrored,filter:{id,strength:70}};
      const preview=drawCapture(source,document.createElement('canvas'),config,{maxEdge:480}),exported=drawCapture(source,document.createElement('canvas'),config);
      const sample=can=>Array.from(can.getContext('2d').getImageData(can.width*.25,can.height*.25,1,1).data);
      const expected=new Uint8ClampedArray([...colors[mirrored?1:0],255]);applyPixels(expected,id,70);
      results.push({ratio:preview.width/preview.height,expectedRatio:ratio,preview:sample(preview),exported:sample(exported),expected:[...expected]});
    }return results;
  });
  for(const r of results){expect(r.ratio).toBeCloseTo(r.expectedRatio,2);expect(r.preview).toEqual(r.expected);expect(r.exported).toEqual(r.expected);}
});

test('background angle/shear is compensated while independent subject displacement remains unsafe',async({page})=>{
  await page.goto(base);
  const frames=await page.evaluate(async()=>{
    const worker=new Worker('/tracking-worker.js');
    const receive=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker timeout')),15000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};});
    await receive();
    const texture=document.createElement('canvas');texture.width=480;texture.height=360;const t=texture.getContext('2d');
    let seed=42;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    t.fillStyle='#444';t.fillRect(0,0,480,360);
    for(let i=0;i<2000;i++){t.fillStyle=`rgb(${50+rand()*200},${50+rand()*200},${50+rand()*200})`;t.fillRect(rand()*480,rand()*360,3+rand()*9,3+rand()*9);}
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=360;const c=canvas.getContext('2d',{willReadFrequently:true}),frames=[];
    for(let i=0;i<24;i++){
      const angle=Math.min(i,15)*.004;
      c.resetTransform();c.fillStyle='#444';c.fillRect(0,0,480,360);
      c.setTransform(1-angle*.2,angle*.25,angle,1+angle*.15,-angle*180,-angle*80);c.drawImage(texture,0,0);
      if(i>=16)c.drawImage(texture,160,110,160,140,172,110,160,140);
      c.resetTransform();const rgba=c.getImageData(0,0,480,360).data.buffer,p=receive();
      worker.postMessage({type:'frame',runId:1,frameId:i+1,time:i*100,width:480,height:360,rgba},[rgba]);frames.push(await p);
      if(i===0)worker.postMessage({type:'subject',runId:1,box:{x:175,y:125,width:120,height:110}});
    }
    worker.terminate();return frames;
  });
  for(const frame of frames.slice(1,16)){expect(frame.valid).toBe(true);expect(frame.subjectKnown).toBe(true);expect(frame.subjectSafe,JSON.stringify(frame)).toBe(true);}
  expect(frames.slice(18).every(f=>!f.subjectSafe)).toBe(true);
});
