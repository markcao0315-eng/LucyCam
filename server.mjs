import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const publicRoot = fileURLToPath(new URL('./dist/', import.meta.url));
// Serve only the camera's public assets, never configuration or source secrets.
const assets = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/photo-utils.js', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/manifest.webmanifest', 'application/manifest+json'],
  ['/icon-192.png', 'image/png'],
  ['/icon-512.png', 'image/png'],
]);

function json(res, status, body, head = false) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(head ? undefined : JSON.stringify(body));
}

export function createAppServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    res.setHeader('Cache-Control', 'no-store');
    const head = req.method === 'HEAD';
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return json(res, 400, {error: 'INVALID_URL'}, head);
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      req.resume();
      return json(res, 405, {error: 'METHOD_NOT_ALLOWED'});
    }
    if (pathname === '/healthz') return json(res, 200, {status: 'ok'}, head);
    if (pathname === '/api/status') {
      return json(res, 200, {
        app: 'LucyCam',
        features: {camera: true, aiComposition: false},
        message: 'AI composition is not implemented yet. No model API calls are made.',
      }, head);
    }
    if (pathname === '/') pathname = '/index.html';
    const contentType = assets.get(pathname);
    if (!contentType) return json(res, 404, {error: 'NOT_FOUND'}, head);
    try {
      const data = await readFile(path.join(publicRoot, pathname.slice(1)));
      res.writeHead(200, {'Content-Type': contentType, 'Content-Length': data.length});
      res.end(head ? undefined : data);
    } catch {
      return json(res, 500, {error: 'ASSET_UNAVAILABLE'}, head);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => console.log(`LucyCam listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => {server.closeAllConnections(); process.exit(0);}, 10_000).unref();
    });
  }
}
