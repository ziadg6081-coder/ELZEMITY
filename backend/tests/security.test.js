'use strict';
process.env.TEST_ENABLE_RATE_LIMIT = 'true';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const h = require('./helpers');
let app;
test.before(async () => { await h.resetDb(); app = h.app(); });
test.after(async () => { await h.db.pool.end(); });

test('security headers (CSP, nosniff, frame-ancestors) and no X-Powered-By', async () => {
  const r = await h.request(app).get('/');
  assert.match(r.headers['content-security-policy'], /script-src 'self'/); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/); assert.match(r.headers['content-security-policy'], /object-src 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['x-powered-by'], undefined); assert.ok(r.headers['x-request-id']);
});
test('health endpoint is public, tiny and leaks nothing', async () => {
  const r = await h.request(app).get('/api/health'); assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.body).sort(), ['db', 'status', 'time']);
});
test('errors never leak stack traces / SQL / internals', async () => {
  const r = await h.request(app).post('/api/orders').set('Idempotency-Key', 'k'.repeat(20)).set('Content-Type', 'application/json').send('{bad json');
  assert.equal(r.status, 400); assert.ok(!JSON.stringify(r.body).match(/at .*\.js|node_modules|SELECT|mysql/i));
  const nf = await h.request(app).get('/api/nope'); assert.equal(nf.status, 404); assert.ok(nf.body.error.requestId);
});
test('oversized JSON body is rejected (413) and wrong content-type (415)', async () => {
  assert.equal((await h.request(app).post('/api/quote').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'a'.repeat(60000) }))).status, 413);
  assert.equal((await h.request(app).post('/api/quote').set('Content-Type', 'text/plain').send('hello')).status, 415);
});
test('CORS: unknown origin refused, known origin allowed', async () => {
  assert.equal((await h.request(app).get('/api/products').set('Origin', 'https://evil.example')).status, 403);
  const ok = await h.request(app).get('/api/products').set('Origin', 'http://localhost:3000'); assert.equal(ok.status, 200); assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:3000');
});
test('XSS: hostile product text is stored verbatim as data and returned as JSON (never as HTML); frontend escapes via esc()', async () => {
  const adm = await h.login(app, 'admin'); const evil = '<img src=x onerror=alert(1)>';
  const r = await h.post(adm, '/api/admin/products', { name: evil, category: 'Men', price: 10, stock: 1 }); assert.equal(r.status, 201);
  const list = await h.request(app).get('/api/products?limit=60'); assert.match(list.headers['content-type'], /application\/json/); assert.ok(list.body.items.some((p) => p.name === evil));
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/js/app.js'), 'utf8');
  assert.ok(!/onerror\s*=/.test(js)); assert.ok(js.includes('const esc ='));
  assert.ok(!/<script[^>]*>[^<]/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/index.html'), 'utf8').replace(/<script[^>]*src[^>]*><\/script>/g, '')));
});
test('no secrets in frontend files, tracked examples, or audit/logs', async () => {
  const root = path.join(__dirname, '..');
  for (const f of ['../frontend/index.html', '../frontend/admin.html', '../frontend/js/app.js', '../frontend/js/admin.js', '.env.example']) {
    const t = fs.readFileSync(path.join(root, f), 'utf8'); assert.ok(!t.includes('20222477'), f);
  }
  const adm = await h.login(app, 'admin'); await h.post(adm, '/api/admin/users', { name: 'Temp', email: 'temp@test.com', password: 'AnotherPass123', role: 'order_manager' });
  const rows = await h.db.query('SELECT details FROM audit_logs'); assert.ok(!JSON.stringify(rows).includes('AnotherPass123'));
  const idx = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); assert.ok(idx.includes('.env'));
});
test('static server does not expose source, env or backups', async () => {
  for (const p of ['/.env', '/package.json', '/server/config.js', '/backups/', '/uploads/', '/../.env']) { const r = await h.request(app).get(p); assert.ok([404, 400].includes(r.status) || r.headers['content-type']?.includes('text/plain'), `${p} -> ${r.status}`); assert.ok(!r.text.includes('DB_PASSWORD')); }
});
test('socket.io client library is served locally (CSP safe)', async () => {
  const http = require('http'); const { attachSocketIO } = require('../server/realtime'); const s = http.createServer(h.app()); attachSocketIO(s); await new Promise((r) => s.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${s.address().port}/socket.io/socket.io.js`); assert.equal(res.status, 200); await new Promise((r) => s.close(r));
});

test('rate limiting: repeated bad logins -> 429', async () => {
  let last; for (let i = 0; i < 12; i++) last = await h.request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'wrong-pass-1' });
  assert.equal(last.status, 429); assert.equal(last.body.error.code, 'RATE_LIMITED');
});
