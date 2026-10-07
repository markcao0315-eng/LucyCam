import {test as base,expect} from '@playwright/test';
import {createAppServer} from '../../server.mjs';
import {installCamera} from './camera-fixture.mjs';
const defaultPlan={canGuide:true,subject:{label:'彩色静物',box:{x:.3,y:.3,width:.4,height:.4}},crop:{centerX:.5,centerY:.5,scale:.7},filter:{id:'mono',strength:100},advice:'保留静物并减少四周空白。'};
const test=base.extend({app:async({},use)=>{
  const app={calls:0,delay:0,plan:structuredClone(defaultPlan),enabled:true,time:Date.now(),failure:false};
  const env={GEMINI_API_KEY:'browser-test-key',LUCYCAM_ACCESS_CODE:'browser-test-code',LIVE_GUIDANCE_ENABLED:'true'};
  const server=createAppServer({env,now:()=>app.time,fetchImpl:async(url,request)=>{
    app.calls++;if(app.delay)await new Promise(r=>setTimeout(r,app.delay));if(app.failure)return Response.json({secret:'not exposed'},{status:500});
    const guide=JSON.parse(request.body).generationConfig.responseJsonSchema.properties.canGuide;
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(guide?app.plan:{subject:'彩色静物',advice:'保留完整主体。',centerX:.5,centerY:.5,scale:.8})}]}}]});
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));app.url=`http://127.0.0.1:${server.address().port}`;app.env=env;
  await use(app);server.closeAllConnections();await new Promise(r=>server.close(r));
}});
async function open(page,app){await installCamera(page);await page.goto(app.url);await page.locator('#startButton').click();await expect(page.locator('#guideButton')).toBeEnabled();await page.locator('[data-scene=landscape]').click();}
async function unlock(page){await page.locator('#guideButton').click();await expect(page.locator('#accessDialog')).toBeVisible();await page.locator('#accessCode').fill('wrong');await page.locator('#unlockAI').click();await expect(page.locator('#accessStatus')).toContainText('不正确');await page.locator('#accessCode').fill('browser-test-code');await page.locator('#unlockAI').click();await expect(page.locator('#accessDialog')).not.toBeVisible();}
async function state(page,value){await expect(page.locator('#liveSection')).toHaveAttribute('data-state',value,{timeout:12000});}

test('5MP automatic photo survives slow filtering and JPEG export without a second click',async({page,app})=>{
  app.plan.crop.scale=1;app.plan.framing={subjectX:.5,subjectY:.5};
  await installCamera(page,{width:1920,height:2560});await page.goto(app.url);await page.locator('#startButton').click();await page.locator('[data-scene=landscape]').click();await unlock(page);
  await page.evaluate(()=>{
    window.photoChanges=0;new MutationObserver(()=>window.photoChanges++).observe(document.getElementById('photoPreview'),{attributes:true,attributeFilter:['src']});
    const original=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){
      if(this.width*this.height>4000000){const end=performance.now()+700;while(performance.now()<end){};return original.call(this,blob=>setTimeout(()=>callback(blob),1200),...args);}
      return original.call(this,callback,...args);
    };
  });
  await page.locator('#guideButton').click();await state(page,'REVIEW');await expect(page.locator('#photoDialog')).toBeVisible();
  await expect(page.locator('#photoMeta')).toContainText('1920 × 2560');
  expect(await page.locator('#photoPreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return Math.abs(p[0]-p[1]);})).toBeLessThan(4);
  expect(app.calls).toBe(1);expect(await page.evaluate(()=>window.photoChanges)).toBe(1);
});

for(const action of ['cancel','background'])test(`${action} during delayed JPEG export prevents late photo publication`,async({page,app})=>{
  await open(page,app);await unlock(page);
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;window.exportPending=false;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){window.exportPending=true;return original.call(this,blob=>setTimeout(()=>callback(blob),1600),...args);};
  });
  await page.locator('#guideButton').click();await expect.poll(()=>page.evaluate(()=>window.exportPending)).toBe(true);await state(page,'EXPORTING');
  if(action==='cancel')await page.locator('#cancelInView').click();
  else await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await state(page,'IDLE');await page.waitForTimeout(1900);await expect(page.locator('#photoDialog')).not.toBeVisible();await expect(page.locator('#lastPhoto')).toBeDisabled();expect(app.calls).toBe(1);
});

test('brief camera stall resumes automatically and captures with the original AI request',async({page,app})=>{
  app.plan.crop.centerX=.6;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  await page.evaluate(()=>{window.cameraFixture.freeze=true;});await state(page,'WAITING');await expect(page.locator('#photoDialog')).not.toBeVisible();
  await page.evaluate(()=>{window.cameraFixture.freeze=false;});await state(page,'GUIDING');
  await page.evaluate(async()=>{for(let i=0;i<12;i++){window.cameraFixture.x-=12;await new Promise(r=>setTimeout(r,80));}});
  await state(page,'REVIEW');await expect(page.locator('#photoDialog')).toBeVisible();expect(app.calls).toBe(1);
});

test('one click runs real Worker tracking, digital crop, filter, one photo and download; original preserves crop',async({page,app})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,app);await unlock(page);expect(app.calls).toBe(0);await state(page,'IDLE');
  await page.evaluate(()=>{window.photoChanges=0;new MutationObserver(()=>window.photoChanges++).observe(document.getElementById('photoPreview'),{attributes:true,attributeFilter:['src']});});
  await page.locator('#guideButton').click();await state(page,'REVIEW');await expect(page.locator('#photoDialog')).toBeVisible();
  const photo=await page.locator('#photoPreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {width:c.width,height:c.height,pixel:[...x.getImageData(c.width/2,c.height/2,1,1).data]};});
  expect(photo.width).toBeGreaterThan(990);expect(photo.width).toBeLessThan(1020);expect(photo.width/photo.height).toBeCloseTo(.75,2);expect(Math.abs(photo.pixel[0]-photo.pixel[1])).toBeLessThan(4);
  await page.waitForTimeout(500);expect(await page.evaluate(()=>window.photoChanges)).toBe(1);expect(app.calls).toBe(1);
  await page.locator('#reviewFilter').selectOption('original');await expect(page.locator('#photoMeta')).toContainText('原片');
  const original=await page.locator('#photoPreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return {width:c.width,height:c.height,p:[...ctx.getImageData(c.width/2,c.height/2,1,1).data]};});
  expect(original.width).toBe(photo.width);expect(original.height).toBe(photo.height);expect(original.p[0]-original.p[1]).toBeGreaterThan(100);
  const download=page.waitForEvent('download');await page.locator('#downloadButton').click();expect((await download).suggestedFilename()).toMatch(/^LucyCam-.*\.jpg$/);expect(errors).toEqual([]);
  await page.screenshot({path:'qa-results/guide-review-390.png'});
});
test('AI response maps motion during analysis; target follows actual pixels; cancel prevents photo',async({page,app})=>{
  app.delay=1800;app.plan.crop.centerX=.6;await open(page,app);await unlock(page);await page.locator('#autoCapture').uncheck();await page.locator('#guideButton').click();await state(page,'ANALYZING');
  await page.evaluate(async()=>{for(let i=0;i<6;i++){window.cameraFixture.x-=6;await new Promise(r=>setTimeout(r,100));}});
  await state(page,'GUIDING');const before=await page.locator('#guideTarget').evaluate(e=>parseFloat(e.style.left));
  await page.evaluate(async()=>{for(let i=0;i<5;i++){window.cameraFixture.x-=6;await new Promise(r=>setTimeout(r,100));}});
  await expect.poll(()=>page.locator('#guideTarget').evaluate(e=>parseFloat(e.style.left))).toBeLessThan(before-4);
  const after=await page.locator('#guideTarget').evaluate(e=>parseFloat(e.style.left));expect(before).toBeLessThan(350*.6);expect(after).toBeGreaterThan(175);
  await page.screenshot({path:'qa-results/guide-tracking-390.png'});await page.locator('#cancelGuide').click();await state(page,'IDLE');await page.waitForTimeout(600);await expect(page.locator('#photoDialog')).not.toBeVisible();expect(app.calls).toBe(1);
});
test('late AI result and old Worker do not revive cancelled runs; manual shutter has no extra AI request',async({page,app})=>{
  app.delay=1200;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'ANALYZING');await expect.poll(()=>app.calls).toBe(1);
  await page.locator('#cancelGuide').click();await page.waitForTimeout(1500);await state(page,'IDLE');await expect(page.locator('#photoDialog')).not.toBeVisible();
  await page.locator('#shutter').click();await expect(page.locator('#photoDialog')).toBeVisible();expect(app.calls).toBe(1);
});
for(const action of ['wall','freeze','subject','ratio','orientation','background','flip'])test(`${action} interrupts guide and cannot auto shoot`,async({page,app})=>{
  app.plan.crop.centerX=.6;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  if(action==='wall'||action==='freeze')await page.evaluate(k=>{window.cameraFixture[k]=true;},action);
  else if(action==='subject')await page.evaluate(()=>{window.cameraFixture.subjectX=40;});
  else if(action==='ratio')await page.locator('#ratioButton').click();
  else if(action==='flip')await page.locator('#flipButton').click();
  else if(action==='orientation')await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
  else await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await state(page,['wall','freeze','subject'].includes(action)?'LOST':'IDLE');await page.waitForTimeout(600);await expect(page.locator('#photoDialog')).not.toBeVisible();expect(app.calls).toBe(1);
  if(action==='background')expect(await page.evaluate(()=>window.fixtureStream.getTracks().every(t=>t.readyState==='ended'))).toBe(true);
});
test('320px layout and feature off preserve normal photo with zero paid requests',async({page,app})=>{
  app.env.LIVE_GUIDANCE_ENABLED='false';await installCamera(page);await page.setViewportSize({width:320,height:780});await page.goto(app.url);await expect(page.locator('#liveSection')).toBeHidden();await page.locator('#startButton').click();await page.locator('#shutter').click();await expect(page.locator('#photoDialog')).toBeVisible();expect(app.calls).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'qa-results/legacy-320.png'});
});
test('safe provider error offers retry and keeps normal camera',async({page,app})=>{
  app.failure=true;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'LOST');await expect(page.locator('#liveStatus')).toContainText('暂时不可用');expect(await page.locator('#liveStatus').textContent()).not.toContain('secret');await page.locator('#shutter').click();await expect(page.locator('#photoDialog')).toBeVisible();
});

test('configuration refresh and legacy single-frame crop remain available with manual rules',async({page,app})=>{
  await installCamera(page);await page.route('**/api/status',route=>route.fulfill({json:{features:{aiComposition:false,liveTracking:false},configuration:{issues:[{message:'家庭访问口令不足 12 位。'}]}}}));await page.goto(app.url);
  await expect(page.locator('#aiStatus')).toContainText('不足 12 位');await page.unroute('**/api/status');await page.locator('#refreshAI').click();await page.locator('#startButton').click();await page.locator('[data-scene=landscape]').click();await unlock(page);
  await page.locator('#aiButton').click();await expect(page.locator('#aiResultDialog')).toBeVisible();await expect(page.locator('#aiAdvice')).toContainText('保留完整主体');expect(app.calls).toBe(1);
  await page.locator('#saveAICrop').click();await expect(page.locator('#photoDialog')).toBeVisible();await expect(page.locator('#photoMeta')).toContainText('1152 × 1536');
});

test('reference expires while provider is slow and late completion does not photograph',async({page,app})=>{
  app.delay=21000;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'ANALYZING');
  await expect(page.locator('#liveSection')).toHaveAttribute('data-state','LOST',{timeout:23000});await expect(page.locator('#liveStatus')).toContainText('过期');await page.waitForTimeout(1500);await expect(page.locator('#photoDialog')).not.toBeVisible();expect(app.calls).toBe(1);
});

test('restarting after a cancelled run requires a fresh click and uploads once for the new run',async({page,app})=>{
  app.plan.crop.centerX=.6;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  await page.locator('#cancelInView').click();await state(page,'IDLE');app.time+=6000;app.plan.crop.centerX=.5;await page.locator('#guideButton').click();await state(page,'REVIEW');expect(app.calls).toBe(2);
});

test('Worker load failure is visible and preserves manual camera without paid upload',async({page,app})=>{
  await page.route('**/vendor/opencv-4.13.0.js',route=>route.abort());await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'LOST');await expect(page.locator('#liveStatus')).toContainText('加载失败');expect(app.calls).toBe(0);
  await page.locator('#shutter').click();await expect(page.locator('#photoDialog')).toBeVisible();
});

test('cancel at CAPTURING boundary beats queued async export; repeated clicks upload once',async({page,app})=>{
  await open(page,app);await unlock(page);
  await page.evaluate(()=>{
    new MutationObserver(()=>{if(document.getElementById('liveSection').dataset.state==='CAPTURING')document.getElementById('cancelInView').click();}).observe(document.getElementById('liveSection'),{attributes:true,attributeFilter:['data-state']});
    const button=document.getElementById('guideButton');button.dispatchEvent(new Event('click'));button.dispatchEvent(new Event('click'));
  });
  await expect.poll(()=>app.calls).toBe(1);await state(page,'IDLE');await page.waitForTimeout(500);await expect(page.locator('#photoDialog')).not.toBeVisible();expect(app.calls).toBe(1);
});

test('manual canGuide=false stop placeholder never becomes an automatic target',async({page,app})=>{
  app.plan={canGuide:false,subject:{label:'无法可靠定位',box:{x:0,y:0,width:1,height:1}},crop:{centerX:.5,centerY:.5,scale:1},filter:{id:'original',strength:0},advice:'请换到明亮位置再拍。'};
  await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'LOST');await expect(page.locator('#liveStatus')).toContainText('明亮位置');await expect(page.locator('#guideOverlay')).toBeHidden();await expect(page.locator('#photoDialog')).not.toBeVisible();expect(app.calls).toBe(1);
});

test('320px live target and cancel stay within the viewport without horizontal overflow',async({page,app})=>{
  app.plan.crop.centerX=.6;await page.setViewportSize({width:320,height:780});await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const cancel=await page.locator('#cancelInView').boundingBox();expect(cancel.y).toBeGreaterThanOrEqual(0);expect(cancel.y+cancel.height).toBeLessThan(780);
  await page.screenshot({path:'qa-results/guide-tracking-320.png'});await page.locator('#cancelInView').click();
});

test('small camera tilt and hand shake still take exactly one photograph without reanalysis',async({page,app})=>{
  await open(page,app);await unlock(page);
  await page.evaluate(()=>{window.cameraFixture.jitter=true;window.photoChanges=0;new MutationObserver(()=>window.photoChanges++).observe(document.getElementById('photoPreview'),{attributes:true,attributeFilter:['src']});});
  await page.locator('#guideButton').click();await state(page,'REVIEW');
  await expect(page.locator('#photoDialog')).toBeVisible();await page.waitForTimeout(500);
  expect(app.calls).toBe(1);expect(await page.evaluate(()=>window.photoChanges)).toBe(1);
});

for(const scale of [.98,1])test(`near-full crop ${scale} survives real pixel tilt and jitter without the angle/reanalysis loop`,async({page,app})=>{
  app.plan.crop.scale=scale;app.delay=900;await open(page,app);await unlock(page);
  await page.evaluate(()=>{window.cameraFixture.jitter=true;window.guideMessages=[];new MutationObserver(()=>window.guideMessages.push(document.getElementById('liveStatus').textContent)).observe(document.getElementById('liveStatus'),{childList:true,subtree:true});});
  await page.locator('#guideButton').click();await state(page,'REVIEW');
  const size=await page.locator('#photoPreview').evaluate(async img=>{await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};});
  expect(size.width).toBeGreaterThan(1350);expect(size.width).toBeLessThanOrEqual(1440);expect(size.width/size.height).toBeCloseTo(.75,2);
  expect((await page.evaluate(()=>window.guideMessages)).join(' ')).not.toMatch(/无法容纳|重新分析|裁切越界/);
  expect(app.calls).toBe(1);
});
test('clipped subject gets live direction and automatically captures after correction without reanalysis',async({page,app})=>{
  app.plan.crop.scale=1;app.plan.subject.box={x:0,y:.3,width:.8,height:.4};app.delay=1200;
  await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'ANALYZING');
  await page.evaluate(()=>{window.cameraFixture.x=-12;});
  await state(page,'CORRECTING');await expect(page.locator('#liveStatus')).toContainText('向左');await expect(page.locator('#guideGoal')).toBeVisible();
  await page.screenshot({path:'qa-results/coaching-left-390.png'});
  await page.evaluate(()=>{window.cameraFixture.x=8;});await state(page,'REVIEW');expect(app.calls).toBe(1);
});
test('oversized subject gets backing-up guidance, measured improvement and then auto capture',async({page,app})=>{
  app.plan.crop.scale=1;app.plan.subject.box={x:.02,y:.3,width:.96,height:.4};
  await page.setViewportSize({width:320,height:780});await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'CORRECTING');
  await expect(page.locator('#liveStatus')).toContainText('后退');await expect(page.locator('#guideGoal')).toBeVisible();
  await page.screenshot({path:'qa-results/coaching-back-320.png'});
  await page.evaluate(async()=>{for(let i=0;i<12;i++){window.cameraFixture.zoom-=.006;await new Promise(r=>setTimeout(r,100));}});
  await expect(page.locator('#liveStatus')).toContainText('方向对了');
  await page.evaluate(async()=>{for(let i=0;i<10;i++){window.cameraFixture.zoom-=.006;await new Promise(r=>setTimeout(r,100));}});
  await state(page,'REVIEW');expect(app.calls).toBe(1);
});
test('brief occlusion recovers actual image tracking with no new AI upload',async({page,app})=>{
  app.plan.crop.centerX=.6;await open(page,app);await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  await page.evaluate(()=>{window.cameraFixture.wall=true;});await state(page,'RECOVERING');await expect(page.locator('#guideOverlay')).toBeHidden();await expect(page.locator('#photoDialog')).not.toBeVisible();
  await page.evaluate(()=>{window.cameraFixture.wall=false;});await state(page,'GUIDING');
  await page.evaluate(async()=>{for(let i=0;i<12;i++){window.cameraFixture.x-=6;await new Promise(r=>setTimeout(r,100));}});
  await state(page,'REVIEW');expect(app.calls).toBe(1);
});
test('denied motion permission preserves image-only guidance and capture',async({page,app})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,'DeviceMotionEvent',{configurable:true,value:{requestPermission:async()=> 'denied'}});});
  await open(page,app);await page.locator('#motionButton').click();await expect(page.locator('#motionStatus')).toContainText('未获得');
  await unlock(page);await page.locator('#guideButton').click();await state(page,'REVIEW');expect(app.calls).toBe(1);
});
test('granted motion data is only auxiliary and cannot capture or move the visual target',async({page,app})=>{
  app.plan.crop.centerX=.6;
  await page.addInitScript(()=>{Object.defineProperty(window,'DeviceMotionEvent',{configurable:true,value:{requestPermission:async()=> 'granted'}});});
  await open(page,app);await page.locator('#motionButton').click();await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  const before=await page.locator('#guideTarget').evaluate(el=>el.style.left);
  await page.evaluate(()=>{const e=new Event('devicemotion');Object.defineProperty(e,'rotationRate',{value:{alpha:0,beta:25,gamma:0}});Object.defineProperty(e,'acceleration',{value:{x:0,y:0,z:0}});window.dispatchEvent(e);});
  await expect(page.locator('#guideMotion')).toContainText('抬高');expect(await page.locator('#guideTarget').evaluate(el=>el.style.left)).toBe(before);await expect(page.locator('#photoDialog')).not.toBeVisible();
  await page.locator('#cancelGuide').click();await state(page,'IDLE');expect(app.calls).toBe(1);
});

test('portrait and scene selection have no fixed silhouette or prescribed person position',async({page,app})=>{
  await open(page,app);await page.locator('[data-scene=portrait]').click();
  await expect(page.locator('#frameGuide')).toHaveCount(0);await expect(page.locator('#frameLabel')).toHaveCount(0);await expect(page.locator('#guideText')).toContainText('保持当前距离');
  await page.locator('#gridButton').click();await page.locator('#gridButton').click();await expect(page.locator('#frameGuide')).toHaveCount(0);
  await page.setViewportSize({width:320,height:780});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'qa-results/free-portrait-320.png'});
});
for(const subjectX of [.35,.65])test(`AI-selected portrait placement ${subjectX} preserves full field and subject size`,async({page,app})=>{
  app.plan.crop={centerX:.5,centerY:.5,scale:1};app.plan.framing={subjectX,subjectY:.5};app.plan.filter={id:'original',strength:0};
  await open(page,app);await page.locator('[data-scene=portrait]').click();await unlock(page);await page.locator('#guideButton').click();await state(page,'GUIDING');
  await expect(page.locator('#liveStatus')).toContainText(subjectX>.5?'向左':'向右');await expect(page.locator('#liveStatus')).toContainText('保持当前距离');
  const direction=subjectX>.5?1:-1;
  await page.evaluate(async direction=>{for(let i=0;i<36;i++){window.cameraFixture.x+=direction*6;await new Promise(r=>setTimeout(r,80));}},direction);
  await state(page,'REVIEW');
  const photo=await page.locator('#photoPreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let count=0,sum=0;for(let i=0;i<p.length;i+=4){if(p[i]>245&&p[i+1]<60&&p[i+2]<60){count++;sum+=(i/4)%c.width;}}return {width:c.width,height:c.height,x:sum/count/c.width,redArea:count};});
  expect(photo.width).toBe(1440);expect(photo.height).toBe(1920);expect(photo.redArea).toBeGreaterThan(17000);expect(photo.redArea).toBeLessThan(27000);
  expect(photo.x).toBeGreaterThan(subjectX-.075);expect(photo.x).toBeLessThan(subjectX+.075);expect(app.calls).toBe(1);
});
