import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {guideSchema} from './dist/guide-plan.js';
import {recoverGuidePlan} from './dist/guide-recovery.js';
import {photographyPrompt} from './photo-prompts.mjs';

import {fail,jpegDimensions,readJson} from './request-utils.mjs';
import {createRetoucher} from './retouch.mjs';
const digest = value => createHash('sha256').update(value).digest();
const schema = {
  type: 'object', additionalProperties: false,
  required: ['subject', 'advice', 'centerX', 'centerY', 'scale'],
  properties: {
    subject: {type: 'string', description: '简短的主体描述，不识别人名'},
    advice: {type: 'string', description: '一句简体中文构图建议，不超过80字'},
    centerX: {type: 'number', minimum: 0, maximum: 1},
    centerY: {type: 'number', minimum: 0, maximum: 1},
    scale: {type: 'number', minimum: 0.65, maximum: 1},
  },
};

export function validateComposition(value) {
  if (!value || typeof value.subject !== 'string' || !value.subject.trim() || value.subject.length > 100 ||
      typeof value.advice !== 'string' || !value.advice.trim() || value.advice.length > 300 ||
      !['centerX', 'centerY', 'scale'].every(k => Number.isFinite(value[k]))) throw fail(502, 'AI 没有返回有效建议，请换个角度再试。');
  const {centerX, centerY, scale} = value;
  if (scale < .65 || scale > 1 || centerX < scale / 2 - .00001 || centerY < scale / 2 - .00001 ||
      centerX > 1 - scale / 2 + .00001 || centerY > 1 - scale / 2 + .00001) throw fail(502, 'AI 建议超出了画面范围，请重新分析。');
  return {subject: value.subject.trim(), advice: value.advice.trim(), centerX, centerY, scale};
}

export function createAI({env = process.env, fetchImpl = fetch, now = Date.now, timeoutMs = 25000, retouchTimeoutMs = 150000} = {}) {
  const retoucher=createRetoucher({env,fetchImpl,now,timeoutMs:retouchTimeoutMs});
  const key = env.GEMINI_API_KEY?.trim();
  const code = env.LUCYCAM_ACCESS_CODE || '';
  const model = env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
  // Report only validation outcomes, never credentials or their exact lengths.
  const configurationIssues = [];
  if (!key) configurationIssues.push({code: 'MISSING_API_KEY', message: '服务尚未读到 GEMINI_API_KEY，请确认变量已保存并部署。'});
  if (!code) configurationIssues.push({code: 'MISSING_ACCESS_CODE', message: '服务尚未读到 LUCYCAM_ACCESS_CODE，请设置家庭访问口令并部署。'});
  else if (code.length < 12) configurationIssues.push({code: 'ACCESS_CODE_TOO_SHORT', message: '家庭访问口令不足 12 位。请在 Render 修改 LUCYCAM_ACCESS_CODE，保存并部署。Gemini Key 无需因此更换。'});
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) configurationIssues.push({code: 'INVALID_MODEL', message: 'GEMINI_MODEL 格式不正确，请填写模型 ID 或移除此变量使用默认模型。'});
  const ready = configurationIssues.length === 0;
  const sign = value => createHmac('sha256', code).update(value).digest('hex');
  const secure = env.NODE_ENV === 'production';
  const positiveInt = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const dailyLimit = positiveInt(env.AI_DAILY_LIMIT, 200);
  const hourlyLimit = positiveInt(env.AI_HOURLY_LIMIT, 60);
  let loginWindow = 0, loginCount = 0, day = '', dayCount = 0, hour = -1, hourCount = 0, inFlight = false, lastCall = -Infinity;
  function authenticated(req) {
    const token = /(?:^|;\s*)lucycam_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token || token.length > 200) return false;
    const [expiry, nonce, signature, extra] = token.split('.');
    if (extra || !/^\d+$/.test(expiry) || !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
    if (Number(expiry) <= now() || Number(expiry) > now() + 12 * 3600000) return false;
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(`${expiry}.${nonce}`), 'hex'));
  }
  async function handle(req, res, pathname) {
    const guide=pathname==='/api/guide-plan';
    if(guide&&env.LIVE_GUIDANCE_ENABLED!=='true')throw fail(404,'实时引导尚未开启。');
    if (!ready) throw fail(503, configurationIssues.map(issue => issue.message).join(' '));
    const expectedOrigin = env.RENDER_EXTERNAL_URL ? new URL(env.RENDER_EXTERNAL_URL).origin : `${secure ? 'https' : 'http'}://${req.headers.host}`;
    if (req.headers.origin !== expectedOrigin) throw fail(403, '请从 LucyCam 页面发起请求。');
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请求格式不正确。');
    if (pathname === '/api/session') {
      const window = Math.floor(now() / 900000);
      if (loginWindow !== window) {loginWindow = window; loginCount = 0;}
      if (++loginCount > 30) throw fail(429, '口令尝试次数过多，请 15 分钟后再试。');
      const body = await readJson(req, 2048);
      if (typeof body?.code !== 'string' || !timingSafeEqual(digest(body.code), digest(code))) throw fail(401, '访问口令不正确。');
      const payload = `${now() + 12 * 3600000}.${randomBytes(16).toString('hex')}`;
      res.setHeader('Set-Cookie', `lucycam_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200${secure ? '; Secure' : ''}`);
      return {authenticated: true};
    }
    if (!authenticated(req)) throw fail(401, '请先输入家庭访问口令。');
    if(pathname==='/api/retouch')return retoucher.handle(req,res);
    // Lock before reading the body, so simultaneous uploads cannot bypass limits.
    if (inFlight || now() - lastCall < 5000) throw fail(429, '请等几秒，再分析下一张。');
    inFlight = true;
    try {
      const body = await readJson(req, 900000);
      if (!body || typeof body.image !== 'string' || body.image.length > 850000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw fail(400, '请发送有效的 JPEG 画面。');
      const bytes = Buffer.from(body.image, 'base64');
      const dimensions = jpegDimensions(bytes);
      if (!dimensions || dimensions.width < 32 || dimensions.height < 32 || Math.max(dimensions.width, dimensions.height) > 1280) throw fail(400, '画面格式或尺寸不正确，请重新开启相机。');
      const scenes = {auto: 'AI 自选：从实际画面发现值得拍的主体和环境关系', portrait: '人像', travel: '人与风景', landscape: '风景'};
      if (!Object.hasOwn(scenes, body.scene)) throw fail(400, '请选择有效的拍摄场景。');
      if(guide){
        if(body.zoomMode!==undefined&&!['compose','quality'].includes(body.zoomMode))throw fail(400,'无效的取景偏好。');
        if(body.source!==undefined&&(!body.source||!['width','height'].every(k=>Number.isInteger(body.source[k])&&body.source[k]>=32&&body.source[k]<=16384)))throw fail(400,'无效的原始画面尺寸。');
        const ratios={'3:4':3/4,'1:1':1,'9:16':9/16};
        if(typeof body.referenceId!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(body.referenceId)||!Object.hasOwn(ratios,body.aspectRatio)||
          Math.abs(dimensions.width-dimensions.height*ratios[body.aspectRatio])>1.5)throw fail(400,'参考编号或照片比例不正确。');
      }
      const currentDay = new Date(now()).toISOString().slice(0, 10), currentHour = Math.floor(now() / 3600000);
      if (day !== currentDay) {day = currentDay; dayCount = 0;}
      if (hour !== currentHour) {hour = currentHour; hourCount = 0;}
      if (dayCount >= dailyLimit || hourCount >= hourlyLimit) throw fail(429, '已达到 AI 使用上限，请稍后再试。普通拍照仍可使用。');
      dayCount++; hourCount++; lastCall = now();
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': key}, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          systemInstruction: {parts: [{text: photographyPrompt(guide)}]},
          contents: [{role: 'user', parts: [
            {text: `本轮场景：${scenes[body.scene]}。实际 JPEG ${dimensions.width}×${dimensions.height}。${guide?'照片比例：'+body.aspectRatio+'。使用实时规划合同 B2；自主选择值得拍摄的主体和环境关系，选择最佳裁切区域及最多两个有不同取景意义的备选。通过轻转镜头对准后数字放大。根据场景选择原创风格、曝光和主体/背景补光；最佳方案与备选只在本次调用返回。':'使用单帧裁切合同 B1，遵守实际 JPEG 坐标。'}${guide&&body.source?`本地原始取景 ${body.source.width}×${body.source.height}；${body.zoomMode==='compose'?'构图优先，可在有明确收益时收紧裁切，最低 scale=0.2':'画质优先，尽量保留短边720和100万像素'}。`:'原始高分辨率未提供。'}不强制近距离人像，不把所有照片变成相同风格。`},
            {inlineData: {mimeType: 'image/jpeg', data: body.image}},
          ]}],
          generationConfig: {responseMimeType: 'application/json', responseJsonSchema: guide?guideSchema:schema, maxOutputTokens: guide?2200:1500, thinkingConfig: {thinkingLevel: 'MINIMAL'}},
        }),
      });
      if (!response.ok) throw fail(response.status === 429 ? 429 : 502, response.status === 429 ? 'AI 服务额度不足或忙碌，请稍后再试。' : 'AI 服务暂时不可用，请检查 Render 中的模型、API Key 和 Google 项目权限。');
      const data = await response.json();
      const candidate = data.candidates?.[0];
      const localRecovery=code=>({schemaVersion:1,referenceId:body.referenceId,model,plan:null,recovery:{source:'local',issues:[code]}});
      if(guide&&candidate?.finishReason!=='STOP')return localRecovery('provider_incomplete');
      if (candidate?.finishReason !== 'STOP') throw fail(502, 'AI 没有完成分析，请换个画面再试。');
      const text = candidate.content?.parts?.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
      let result;
      try {result = JSON.parse(text);} catch {if(guide)return localRecovery('provider_json');throw fail(502, 'AI 返回格式不正确，请重试。');}
      if(guide){
        return {schemaVersion:1,referenceId:body.referenceId,model,...recoverGuidePlan(result)};
      }
      return {composition: validateComposition(result), model};
    } catch (error) {
      if (error.status) throw error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw fail(504, 'AI 分析超时，请稍后重试。');
      throw fail(502, '暂时无法连接 AI 服务，请稍后重试。');
    } finally {inFlight = false;}
  }
  return {ready, configurationIssues, authenticated, handle,retouch:retoucher.status};
}
