// Synthetic camera pixels, not simulated tracking results. The real Worker processes
// every sample. No production key or external provider is involved.
export async function installCamera(page){
  await page.addInitScript(()=>{
    window.cameraFixture={x:0,y:0,wall:false,freeze:false,subjectX:0,jitter:false,zoom:1};
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=1920;
    const ctx=canvas.getContext('2d'),texture=document.createElement('canvas');texture.width=1440;texture.height=1920;
    const t=texture.getContext('2d');t.fillStyle='#706040';t.fillRect(0,0,1440,1920);let seed=63;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    for(let i=0;i<1600;i++){t.fillStyle=`rgb(${40+rand()*210},${40+rand()*210},${40+rand()*210})`;t.fillRect(rand()*1440,rand()*1920,12+rand()*24,12+rand()*24);}
    // Landmarks provide a content assertion independent of the tracking algorithm.
    t.fillStyle='#ff2020';t.fillRect(630,900,180,120);
    const draw=()=>{const f=window.cameraFixture;if(!f.freeze){ctx.fillStyle=f.wall?'#fff':'#706040';ctx.fillRect(0,0,1440,1920);if(!f.wall){const phase=performance.now()/180;ctx.save();ctx.translate(720,960);ctx.scale(f.zoom,f.zoom);ctx.translate(-720,-960);if(f.jitter)ctx.transform(1,.008*Math.sin(phase),.018*Math.cos(phase),1,12*Math.sin(phase),8*Math.cos(phase));ctx.drawImage(texture,f.x,f.y);if(f.subjectX){ctx.drawImage(texture,480,620,480,620,480+f.subjectX+f.x,620+f.y,480,620);}ctx.restore();}}requestAnimationFrame(draw);};draw();
    navigator.mediaDevices.getUserMedia=async()=>{const stream=canvas.captureStream(30);window.fixtureStream=stream;return stream;};
  });
}
