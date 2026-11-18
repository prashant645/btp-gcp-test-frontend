const http = require('node:http');

function backendUrl() {
  return process.env.BACKEND_BASE_URL || 'http://localhost:3001';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>btp-demo</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2937;
      background: linear-gradient(135deg, #0a6ed1 0%, #6f42c1 55%, #e83e8c 100%);
      padding: 16px;
    }
    .card {
      width: 100%; max-width: 560px; background: #fff; border-radius: 20px; padding: 32px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, .25);
    }
    .eyebrow { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #6f42c1; font-weight: 600; }
    h1 {
      margin: 8px 0 24px; font-size: 44px; line-height: 1.1;
      background: linear-gradient(90deg, #0a6ed1, #e83e8c); -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    h1.error { background: none; color: #dc2626; font-size: 32px; }
    .langs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
    .langs button {
      border: 2px solid #6f42c1; background: #fff; color: #6f42c1; border-radius: 999px;
      padding: 6px 14px; font-size: 14px; cursor: pointer;
    }
    .langs button.active { background: #6f42c1; color: #fff; }
    .meta { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px; color: #4b5563; }
    .meta code { font-size: 12px; word-break: break-all; }
    .status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #9ca3af; }
    .ok .dot { background: #16a34a; } .ok { color: #16a34a; }
    .down .dot { background: #dc2626; } .down { color: #dc2626; }
    a { color: #0a6ed1; }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">btp-demo · frontend + backend</div>
    <h1 id="greeting">Loading...</h1>
    <div class="langs" id="langs"></div>
    <div class="meta">
      <span>Backend</span><span id="status" class="status"><span class="dot"></span><span id="status-text">checking</span></span>
      <span>Backend version</span><code id="backend-version">-</code>
      <span>Frontend version</span><code id="frontend-version">-</code>
      <span>Backend API</span><a href="__BACKEND_DOCS__" target="_blank" rel="noopener">Swagger UI</a>
    </div>
  </main>
  <script>
    const $ = id => document.getElementById(id);
    let lang = 'en';

    function setStatus(ok) {
      $('status').className = 'status ' + (ok ? 'ok' : 'down');
      $('status-text').textContent = ok ? 'connected' : 'unavailable';
    }

    function load() {
      fetch('/api/greeting?lang=' + lang)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(d => {
          $('greeting').className = '';
          $('greeting').textContent = d.message;
          $('backend-version').textContent = d.backendVersion;
          setStatus(true);
        })
        .catch(() => {
          $('greeting').className = 'error';
          $('greeting').textContent = 'Backend unavailable';
          $('backend-version').textContent = '-';
          setStatus(false);
        });
      document.querySelectorAll('#langs button').forEach(b => b.classList.toggle('active', b.dataset.code === lang));
    }

    fetch('/api/languages')
      .then(r => r.ok ? r.json() : [])
      .then(list => list.forEach(l => {
        const b = document.createElement('button');
        b.textContent = l.name;
        b.dataset.code = l.code;
        b.onclick = () => { lang = l.code; load(); };
        $('langs').appendChild(b);
      }))
      .catch(() => {})
      .then(load);

    fetch('/version').then(r => r.text()).then(v => { $('frontend-version').textContent = v; });
  </script>
</body>
</html>
`;

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  response.end(body);
}

function json(response, status, data) {
  send(response, status, 'application/json', JSON.stringify(data));
}

// Calls the backend and returns its parsed JSON. Throws on anything but a 200 with JSON.
async function callBackend(path) {
  const reply = await fetch(`${backendUrl()}${path}`, { signal: AbortSignal.timeout(5000) });
  if (reply.status === 400) {
    const error = new Error('bad request');
    error.reply = await reply.json().catch(() => ({ error: 'bad request' }));
    throw error;
  }
  if (!reply.ok) throw new Error(`backend returned ${reply.status}`);
  return reply.json();
}

function backendFailed(response, error) {
  if (error.reply) return json(response, 400, error.reply);
  return json(response, 502, { error: `backend call failed: ${error.message}` });
}

// Any backend failure (unreachable, non-200, bad JSON, no message) is a 502. A 400 is passed on.
async function greeting(response, lang) {
  try {
    const data = await callBackend(`/greeting?lang=${encodeURIComponent(lang)}`);
    if (typeof data.message !== 'string') throw new Error('backend reply has no message');
    json(response, 200, { message: data.message, lang: data.lang, backendVersion: data.version });
  } catch (error) {
    backendFailed(response, error);
  }
}

async function languages(response) {
  try {
    const data = await callBackend('/languages');
    if (!Array.isArray(data)) throw new Error('backend reply is not a list');
    json(response, 200, data);
  } catch (error) {
    backendFailed(response, error);
  }
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.method !== 'GET') return send(response, 405, 'text/plain', 'Method Not Allowed');

    const url = new URL(request.url, 'http://localhost');
    switch (url.pathname) {
      case '/':
        return send(response, 200, 'text/html', PAGE.replace('__BACKEND_DOCS__', escapeHtml(`${backendUrl()}/docs`)));
      case '/api/greeting':
        return greeting(response, url.searchParams.get('lang') || 'en');
      case '/api/languages':
        return languages(response);
      case '/version':
        return send(response, 200, 'text/plain', process.env.APP_VERSION || 'unknown');
      case '/healthz':
        return send(response, 200, 'text/plain', 'OK');
      default:
        return send(response, 404, 'text/plain', 'Not Found');
    }
  });
}

if (require.main === module) {
  const server = createServer().listen(process.env.PORT || 3000);
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
