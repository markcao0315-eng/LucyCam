import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAppServer} from '../server.mjs';

test('Render server serves the camera, reports truthful AI status, and isolates private files', async t => {
  const server = createAppServer({env: {}});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  const base = `http://127.0.0.1:${server.address().port}`;
  await t.test('health check and AI status need no API key', async () => {
    assert.deepEqual(await (await fetch(base + '/healthz')).json(), {status: 'ok'});
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.features.aiComposition, false);
  });
  await t.test('HTML and ES modules have correct types; HEAD returns no body', async () => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /LucyCam/);
    assert.equal(home.headers.get('permissions-policy'), 'camera=(self), microphone=()');
    const module = await fetch(base + '/app.js');
    assert.match(module.headers.get('content-type'), /javascript/);
    const head = await fetch(base + '/styles.css', {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
  await t.test('all HTML assets exist', async () => {
    for (const file of ['/styles.css', '/app.js', '/photo-utils.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']) {
      assert.equal((await fetch(base + file)).status, 200, file);
    }
  });
  await t.test('private configuration and traversal cannot be fetched', async () => {
    for (const file of ['/.env', '/.git/config', '/.openai/hosting.json', '/server.mjs', '/%2e%2e%2fpackage.json', '/..%5cpackage.json']) {
      assert.equal((await fetch(base + file)).status, 404, file);
    }
  });
  await t.test('malformed URLs and unsupported methods fail explicitly', async () => {
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    const response = await fetch(base + '/unknown', {method: 'POST', body: 'test'});
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  });
});
