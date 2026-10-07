import {test as base,expect} from '@playwright/test';
import {createAppServer} from '../../server.mjs';
import {installCamera} from './camera-fixture.mjs';
const test=base.extend({app:async({},use)=>{
  const app={guides:0,edits:0,delay:1400,failure:false,result:null,uploaded:null};
  const server=createAppServer({env:{GEMINI_API_KEY:'test-key',OPENAI_API_KEY:'test-openai-key',LUCYCAM_ACCESS_CODE:'test-access-code',LIVE_GUIDANCE_ENABLED:'true'},fetchImpl:async(url,request)=>{
    const body=JSON.parse(request.body);
    if(url==='https://api.openai.com/v1/images/edits'){
      app.edits++;app.uploaded=body.images[0].image_url;
      await new Promise(r=>setTimeout(r,app.delay));return app.failure?Response.json({error:'private-provider-data'},{status:500}):Response.json({data:[{b64_json:app.result}]});
    }
    app.guides++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({canGuide:true,subject:{label:'静物',box:{x:.3,y:.3,width:.4,height:.4}},crop:{centerX:.5,centerY:.5,scale:.7},filter:{id:'mono',strength:100},advice:'保持主体完整。'})}]}}]});
  }});await new Promise(r=>server.listen(0,'127.0.0.1',r));app.url=`http://127.0.0.1:${server.address().port}`;
  await use(app);server.closeAllConnections();await new Promise(r=>server.close(r));
}});
async function open(page,app){
  await installCamera(page);await page.goto(app.url);await page.locator('#startButton').click();await page.locator('[data-scene=landscape]').click();
  await page.locator('#guideButton').click();await page.locator('#accessCode').fill('test-access-code');await page.locator('#unlockAI').click();await expect(page.locator('#accessDialog')).not.toBeVisible();
  // Deterministic provider output tests plumbing, not model quality.
  app.result=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1280;const ctx=c.getContext('2d');ctx.fillStyle='#2080f0';ctx.fillRect(0,0,1280,1280);return c.toDataURL('image/jpeg',.9).split(',')[1];});
}
test('one click aligns, uploads unfiltered full frame, hides raw shot and displays only provider result',async({page,app})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,app);
  await page.locator('#guideButton').click();await expect(page.locator('#retouchDialog')).toBeVisible({timeout:12000});await expect(page.locator('#photoDialog')).not.toBeVisible();await expect(page.locator('#photoPreview')).not.toHaveAttribute('src',/.+/);
  await page.screenshot({path:'qa-results/retouch-processing-390.png'});
  await expect(page.locator('#photoDialog')).toBeVisible({timeout:10000});await expect(page.locator('#photoMeta')).toContainText('1280 × 1280 · AI 修图');
  const pixels=await page.evaluate(async source=>{const i=new Image();i.src=source;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return {w:c.width,h:c.height,p:[...x.getImageData(c.width/2,c.height/2,1,1).data]};},app.uploaded);
  expect(pixels.w).toBe(1440);expect(pixels.h).toBe(1920);expect(pixels.p[0]-pixels.p[1]).toBeGreaterThan(100);expect(app.guides).toBe(1);expect(app.edits).toBe(1);
  await page.locator('#compareOriginal').click();await expect(page.locator('#photoMeta')).toContainText('1440 × 1920 · AI 原片');
  await page.locator('#compareOriginal').click();await expect(page.locator('#photoMeta')).toContainText('1280 × 1280 · AI 修图');
  const download=page.waitForEvent('download');await page.locator('#downloadButton').click();expect((await download).suggestedFilename()).toMatch(/\.jpg$/);expect(errors).toEqual([]);
});
test('failed edit retains original for explicit saving and makes no automatic retry',async({page,app})=>{
  app.failure=true;await open(page,app);await page.locator('#guideButton').click();
  await expect(page.locator('#saveRetouchOriginal')).toBeVisible({timeout:15000});await expect(page.locator('#photoDialog')).not.toBeVisible();await expect(page.locator('#retouchStatus')).not.toContainText('private-provider-data');
  await page.locator('#saveRetouchOriginal').click();await expect(page.locator('#photoMeta')).toContainText('1440 × 1920 · AI 原片');expect(app.edits).toBe(1);
});
for(const action of ['cancel','background'])test(`${action} during retouch discards late model result`,async({page,app})=>{
  app.delay=2200;await open(page,app);await page.locator('#guideButton').click();await expect.poll(()=>app.edits).toBe(1);
  if(action==='cancel')await page.locator('#cancelRetouch').click();else await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(2500);await expect(page.locator('#photoDialog')).not.toBeVisible();await expect(page.locator('#liveSection')).toHaveAttribute('data-state','IDLE');expect(app.edits).toBe(1);
});
test('existing photo can be explicitly retouched and 320px processing fits',async({page,app})=>{
  await page.setViewportSize({width:320,height:780});await open(page,app);await page.locator('#shutter').click();await expect(page.locator('#photoDialog')).toBeVisible();expect(app.edits).toBe(0);
  await page.locator('#retouchPhoto').click();await expect(page.locator('#retouchDialog')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#photoMeta')).toContainText('AI 修图',{timeout:10000});expect(app.guides).toBe(0);expect(app.edits).toBe(1);
});
