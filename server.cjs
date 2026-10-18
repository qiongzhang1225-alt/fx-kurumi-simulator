const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['engine.js', 'text/javascript; charset=utf-8'],
  ['chart.js', 'text/javascript; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['story-ui.js', 'text/javascript; charset=utf-8'],
  ['assets/kurumi-laugh.jpg', 'image/jpeg'],
  ['assets/kurumi-goal.jpg', 'image/jpeg'],
  ['assets/kurumi-grit.jpg', 'image/jpeg'],
  ['assets/kurumi-panic.jpg', 'image/jpeg'],
  ['assets/mochiko.png', 'image/png'],
  ['assets/main_kurumi.png', 'image/png'],
  ['assets/main_mochiko.png', 'image/png'],
  ['assets/main_mebuki.png', 'image/png'],
  ['assets/main_yasuko.png', 'image/png'],
  ['assets/face_mebuki.png', 'image/png'],
  ['assets/face_yasuko.png', 'image/png'],
]);

function createProjectServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    let name;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      name = pathname === '/' ? 'index.html' : pathname.slice(1);
    } catch {
      response.writeHead(400); response.end(); return;
    }
    if (!PUBLIC_FILES.has(name)) { response.writeHead(404); response.end(); return; }
    try {
      const data = await fs.readFile(path.join(__dirname, name));
      response.writeHead(200, { 'Content-Type': PUBLIC_FILES.get(name), 'Content-Length': data.length });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      response.writeHead(500); response.end('Unable to read project file.');
    }
  });
}

if (require.main === module) {
  const server = createProjectServer();
  let port = 4173;
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && port < 4183) server.listen(++port, '127.0.0.1');
    else { console.error(`Preview failed: ${error.message}`); process.exitCode = 1; }
  });
  server.on('listening', () => {
    console.log(`FX LAB Local: http://127.0.0.1:${port}`);
    console.log('Press Ctrl+C to stop. The game also works by opening index.html directly.');
  });
  server.listen(port, '127.0.0.1');
}

module.exports = { createProjectServer };
