const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../server');

// A stand-in backend. Each test sets how it answers; requests are recorded.
let backendReply;
let backendRequests;
const backend = http.createServer((request, response) => {
  backendRequests.push(request.url);
  const { status, body } = backendReply(request.url);
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(body);
});

function defaultBackend(url) {
  if (url.startsWith('/languages')) {
    return { status: 200, body: JSON.stringify([{ code: 'en', name: 'English' }, { code: 'de', name: 'Deutsch' }]) };
  }
  if (url === '/greeting?lang=de') return { status: 200, body: JSON.stringify({ message: 'Hallo Welt', lang: 'de', version: 'be123' }) };
  if (url === '/greeting?lang=xx') return { status: 400, body: JSON.stringify({ error: 'unsupported language: xx' }) };
  return { status: 200, body: JSON.stringify({ message: 'Hello World', lang: 'en', version: 'be123' }) };
}

let server;
let baseUrl;

function listen(s) {
  return new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
}

before(async () => {
  await listen(backend);
  process.env.BACKEND_BASE_URL = `http://127.0.0.1:${backend.address().port}`;
  server = createServer();
  await listen(server);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => backend.close(resolve));
});

beforeEach(() => {
  backendReply = defaultBackend;
  backendRequests = [];
});

async function withBackendDown(fn) {
  const saved = process.env.BACKEND_BASE_URL;
  process.env.BACKEND_BASE_URL = 'http://127.0.0.1:1';
  try {
    await fn();
  } finally {
    process.env.BACKEND_BASE_URL = saved;
  }
}

test('GET / returns the HTML page that calls /api/greeting and links the backend docs', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  const page = await response.text();
  assert.match(page, /fetch\('\/api\/greeting/);
  assert.ok(page.includes(`href="${process.env.BACKEND_BASE_URL}/docs"`));
});

test('GET /api/greeting returns the backend message and version', async () => {
  const response = await fetch(`${baseUrl}/api/greeting`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: 'Hello World', lang: 'en', backendVersion: 'be123' });
  assert.deepEqual(backendRequests, ['/greeting?lang=en']);
});

test('GET /api/greeting?lang=de passes the language to the backend', async () => {
  const response = await fetch(`${baseUrl}/api/greeting?lang=de`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: 'Hallo Welt', lang: 'de', backendVersion: 'be123' });
});

test('GET /api/greeting passes on the backend 400 for an unsupported language', async () => {
  const response = await fetch(`${baseUrl}/api/greeting?lang=xx`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'unsupported language: xx' });
});

test('GET /api/greeting returns 502 when the backend errors', async () => {
  backendReply = () => ({ status: 500, body: '{}' });
  const response = await fetch(`${baseUrl}/api/greeting`);
  assert.equal(response.status, 502);
});

test('GET /api/greeting returns 502 when the backend reply has no message', async () => {
  backendReply = () => ({ status: 200, body: JSON.stringify({ text: 'Hello World', version: 'be123' }) });
  const response = await fetch(`${baseUrl}/api/greeting`);
  assert.equal(response.status, 502);
});

test('GET /api/greeting returns 502 when the backend reply is not JSON', async () => {
  backendReply = () => ({ status: 200, body: 'not json' });
  const response = await fetch(`${baseUrl}/api/greeting`);
  assert.equal(response.status, 502);
});

test('GET /api/greeting returns 502 when the backend is down', async () => {
  await withBackendDown(async () => {
    const response = await fetch(`${baseUrl}/api/greeting`);
    assert.equal(response.status, 502);
  });
});

test('GET /api/languages returns the backend list', async () => {
  const response = await fetch(`${baseUrl}/api/languages`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ code: 'en', name: 'English' }, { code: 'de', name: 'Deutsch' }]);
});

test('GET /api/languages returns 502 when the backend is down', async () => {
  await withBackendDown(async () => {
    const response = await fetch(`${baseUrl}/api/languages`);
    assert.equal(response.status, 502);
  });
});

test('GET /healthz returns OK without calling the backend', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'OK');
  assert.deepEqual(backendRequests, []);
});

test('GET /version returns APP_VERSION', async () => {
  process.env.APP_VERSION = 'abc123';
  const response = await fetch(`${baseUrl}/version`);
  assert.equal(await response.text(), 'abc123');
});

test('GET /version falls back to unknown', async () => {
  delete process.env.APP_VERSION;
  const response = await fetch(`${baseUrl}/version`);
  assert.equal(await response.text(), 'unknown');
});

test('unknown path returns 404', async () => {
  const response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
});

test('POST is rejected', async () => {
  const response = await fetch(`${baseUrl}/`, { method: 'POST' });
  assert.equal(response.status, 405);
});
