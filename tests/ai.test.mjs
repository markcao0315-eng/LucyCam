import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAppServer} from '../server.mjs';
import {validateComposition} from '../ai.mjs';

const composition = {subject: '树与步道', advice: '保留右侧步道，减少上方空白。', centerX: .55, centerY: .5, scale: .8};
// Minimal SOF/EOI fixture for server-side JPEG envelope validation (provider is mocked).
const jpeg = Buffer.from([255,216,255,192,0,11,8,0,64,0,48,1,1,17,0,255,217]).toString('base64');
const payload = {image: jpeg, scene: 'landscape'};

async function fixture(t, options = {}) {
  let time = Date.now(), calls = [];
  const server = createAppServer({env: {GEMINI_API_KEY: 'test-only-key', LUCYCAM_ACCESS_CODE: 'test-only-access-code', ...options.env}, now: () => time,
    timeoutMs: options.timeoutMs || 1000,
    fetchImpl: async (url, request) => {
      calls.push({url, request});
      if (options.fetchImpl) return options.fetchImpl(url, request);
      return Response.json({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(composition)}]}}]});
    },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const post = (path, body, headers = {}) => fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: base, Cookie: cookie, ...headers}, body: JSON.stringify(body)});
  const login = async () => {
    const response = await post('/api/session', {code: 'test-only-access-code'});
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return {base, post, login, calls, advance: ms => {time += ms;}, getCookie: () => cookie};
}

test('AI requires configuration and authentication before sending any image', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/compose', payload)).status, 401);
  assert.equal((await f.post('/api/session', {code: 'wrong'})).status, 401);
  assert.equal((await f.post('/api/session', {code: 'test-only-access-code'}, {Origin: 'https://evil.example'})).status, 403);
  assert.equal(f.calls.length, 0);
  const disabled = await fixture(t, {env: {LUCYCAM_ACCESS_CODE: 'too-short'}});
  assert.equal((await disabled.post('/api/compose', payload)).status, 503);
});

test('authenticated frame reaches only configured Gemini model and returns validated crop', async t => {
  const f = await fixture(t);
  const login = await f.login();
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const response = await f.post('/api/compose', {...payload, model: 'attacker-model'});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).composition, composition);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(f.calls[0].request.headers['x-goog-api-key'], 'test-only-key');
  const request = JSON.parse(f.calls[0].request.body);
  assert.equal(request.contents[0].parts[1].inlineData.data, jpeg);
  assert.equal(request.generationConfig.responseMimeType, 'application/json');
  const publicStatus = await (await fetch(f.base + '/api/status')).text();
  assert.ok(!publicStatus.includes('test-only'));
  assert.equal(JSON.parse(publicStatus).features.liveTracking, false);
});

test('bad image, dimensions and scene rejected before spending provider quota', async t => {
  const f = await fixture(t); await f.login();
  const large = Buffer.from(jpeg, 'base64'); large.writeUInt16BE(9000, 9);
  for (const body of [{...payload, image: 'ZmFrZQ=='}, {...payload, scene: '__proto__'}, {...payload, image: large.toString('base64')}, null]) {
    assert.equal((await f.post('/api/compose', body)).status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('tampered and expired sessions cannot call the paid endpoint', async t => {
  const f = await fixture(t); await f.login();
  assert.equal((await f.post('/api/compose', payload, {Cookie: f.getCookie() + '0'})).status, 401);
  f.advance(12 * 3600000 + 1);
  assert.equal((await f.post('/api/compose', payload)).status, 401);
  assert.equal(f.calls.length, 0);
});

test('cooldown and daily cap count attempted model calls and reset by day', async t => {
  const f = await fixture(t, {env: {AI_DAILY_LIMIT: '1'}}); await f.login();
  assert.equal((await f.post('/api/compose', payload)).status, 200);
  assert.equal((await f.post('/api/compose', payload)).status, 429);
  f.advance(6000);
  assert.equal((await f.post('/api/compose', payload)).status, 429);
  assert.equal(f.calls.length, 1);
  f.advance(24 * 3600000); await f.login();
  assert.equal((await f.post('/api/compose', payload)).status, 200);
});

test('simultaneous frame submissions produce at most one provider request', async t => {
  let finish;
  const f = await fixture(t, {fetchImpl: () => new Promise(resolve => {finish = resolve;})}); await f.login();
  const first = f.post('/api/compose', payload);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.post('/api/compose', payload)).status, 429);
  finish(Response.json({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(composition)}]}}]}));
  assert.equal((await first).status, 200);
  assert.equal(f.calls.length, 1);
});

test('provider failures, unsafe geometry and timeout surface safe errors without keys', async t => {
  for (const fetchImpl of [
    async () => Response.json({secret: 'test-only-key'}, {status: 403}),
    async () => Response.json({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify({...composition, centerX: 0})}]}}]}),
    async () => Response.json({candidates: [{finishReason: 'MAX_TOKENS'}]}),
    async () => {throw new Error('network failed test-only-key');},
  ]) {
    const f = await fixture(t, {fetchImpl}); await f.login();
    const response = await f.post('/api/compose', payload);
    assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('test-only-key'));
  }
  const timeout = await fixture(t, {timeoutMs: 10, fetchImpl: (_url, {signal}) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))});
  await timeout.login(); assert.equal((await timeout.post('/api/compose', payload)).status, 504);
});

test('composition validation preserves geometry and rejects malformed suggestions', () => {
  assert.deepEqual(validateComposition(composition), composition);
  for (const value of [null, {...composition, scale: .1}, {...composition, centerX: '0.5'}, {...composition, centerY: 1}, {...composition, advice: ''}]) assert.throws(() => validateComposition(value));
});
