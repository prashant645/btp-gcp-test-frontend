const http = require('node:http');

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>btp-demo</title></head>
<body>
  <h1 id="greeting">Loading...</h1>
  <p>Backend version: <span id="backend-version">-</span></p>
  <script>
    fetch('/api/greeting')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => {
        document.getElementById('greeting').textContent = d.message;
        document.getElementById('backend-version').textContent = d.backendVersion;
      })
      .catch(() => { document.getElementById('greeting').textContent = 'Backend unavailable'; });
  </script>
</body>
</html>
`;

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  response.end(body);
}

// Calls the backend's /greeting. Any failure (unreachable, non-200, bad JSON, no message) is a 502.
async function greeting(response) {
  const backend = process.env.BACKEND_BASE_URL || 'http://localhost:3001';
  try {
    const reply = await fetch(`${backend}/greeting`, { signal: AbortSignal.timeout(5000) });
    if (!reply.ok) throw new Error(`backend returned ${reply.status}`);
    const data = await reply.json();
    if (typeof data.message !== 'string') throw new Error('backend reply has no message');
    send(response, 200, 'application/json', JSON.stringify({ message: data.message, backendVersion: data.version }));
  } catch (error) {
    send(response, 502, 'application/json', JSON.stringify({ error: `backend call failed: ${error.message}` }));
  }
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.method !== 'GET') return send(response, 405, 'text/plain', 'Method Not Allowed');

    switch (request.url) {
      case '/':
        return send(response, 200, 'text/html', PAGE);
      case '/api/greeting':
        return greeting(response);
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
