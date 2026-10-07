// Synthetic camera pixels, not simulated tracking results. The real Worker processes
// every sample. No production key or external provider is involved.
export async function installCamera(page,{width=1440,height=1920,structure=false,landmark={x:630,y:900,width:180,height:120}}={}){
  await page.addInitScript(({width,height,landmark,structure})=>{
    window.cameraFixture={x:0,y:0,wall:false,freeze:false,subjectX:0,jitter:false,zoom:1};
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d'),texture=document.createElement('canvas');texture.width=1440;texture.height=1920;ctx.scale(width/1440,height/1920);
    const t=texture.getContext('2d');t.fillStyle='#706040';t.fillRect(0,0,1440,1920);let seed=63;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    for(let i=0;i<1600;i++){t.fillStyle=`rgb(${40+rand()*210},${40+rand()*210},${40+rand()*210})`;t.fillRect(rand()*1440,rand()*1920,12+rand()*24,12+rand()*24);}
    // Landmarks provide a content assertion independent of the tracking algorithm.
    t.fillStyle='#ff2020';t.fillRect(landmark.x,landmark.y,landmark.width,landmark.height);
    if(structure){
      t.fillStyle='#bcb69d';t.fillRect(0,0,1440,1920);
      t.lineWidth=12;t.strokeStyle='#eee5c9';t.strokeRect(210,140,1040,840);
      t.strokeStyle='#77705e';for(let y=200;y<950;y+=115)t.strokeRect(235,y,990,12);
      t.fillStyle='#63442d';t.fillRect(60,1430,1330,80);t.fillRect(130,1480,60,430);t.fillRect(1200,1480,60,430);
      for(const x of [100,770]){t.fillStyle='#252830';t.fillRect(x,1010,570,390);t.fillStyle='#aacbd9';t.fillRect(x+20,1030,530,340);t.fillStyle='#20252a';t.fillRect(x+230,1400,100,35);}
      for(let i=0;i<40;i++){t.fillStyle=i%2?'#ded4af':'#504330';t.fillRect(100+rand()*1200,1380+rand()*55,20+rand()*35,25);}
      // Blank region is deliberately untrackable in isolation.
      t.fillStyle='#bcb69d';t.fillRect(640,660,170,150);
    }
    const draw=()=>{const f=window.cameraFixture;if(!f.freeze){ctx.fillStyle=f.wall?'#fff':'#706040';ctx.fillRect(0,0,1440,1920);if(!f.wall){const phase=performance.now()/180;ctx.save();ctx.translate(720,960);ctx.scale(f.zoom,f.zoom);ctx.translate(-720,-960);if(f.jitter)ctx.transform(1,.008*Math.sin(phase),.018*Math.cos(phase),1,12*Math.sin(phase),8*Math.cos(phase));ctx.drawImage(texture,f.x,f.y);if(f.subjectX){ctx.drawImage(texture,480,620,480,620,480+f.subjectX+f.x,620+f.y,480,620);}ctx.restore();}}requestAnimationFrame(draw);};draw();
    navigator.mediaDevices.getUserMedia=async()=>{const stream=canvas.captureStream(30);window.fixtureStream=stream;return stream;};
  },{width,height,landmark,structure});
}
