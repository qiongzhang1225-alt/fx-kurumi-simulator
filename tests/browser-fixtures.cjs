// Optional manual QA server: exercise rare endings with real engine actions.
// These routes and setup scripts are never exposed by the normal preview server.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createProjectServer } = require('../server.cjs');
const normalHandler = createProjectServer().listeners('request')[0];
const scripts = {
  '/fixture-ending.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.borrow(20000000); this.open('long',19000000,100); this.advance(1); } };",
  '/fixture-wealth.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.borrow(20000000); this.open('long',1000000,100); this.advance(181); } };",
  '/fixture-add-long.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.open('long',270000,100); this.advance(149.3); this.borrow(200000); this.takeEvents(); this.select('CHFJPY'); } };",
  '/fixture-add-short.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.open('short',270000,100); this.advance(150.7); this.borrow(200000); this.takeEvents(); } };",
  '/fixture-reduce-long.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.open('long',60000,25); this.advance(149.02); this.takeEvents(); this.select('CHFJPY'); } };",
  '/fixture-reduce-short.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.open('short',60000,10); this.advance(148.98); this.takeEvents(); } };",
  '/fixture-interest.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.borrow(1000000); for(let i=0;i<720;i++)this.advance(150); this.repay(500000); for(let i=0;i<720;i++)this.advance(150); this.takeEvents(); this.paused=true; } };",
  '/fixture-arrears.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.borrow(1000000); this.open('long',1000000,100); this.advance(1); this.advance(150); this.takeEvents(); this.paused=true; } };",
  '/fixture-small-profit.js': "const OriginalEngine = FX.FXEngine; FX.FXEngine = class extends OriginalEngine { constructor() { super({seed:31415}); this.open('long',1,1); this.advance(150.1); this.close(); } };",
};
const fixtures = { '/ending-fixture': '/fixture-ending.js', '/wealth-fixture': '/fixture-wealth.js',
  '/add-long-fixture': '/fixture-add-long.js', '/add-short-fixture': '/fixture-add-short.js',
  '/reduce-long-fixture': '/fixture-reduce-long.js', '/reduce-short-fixture': '/fixture-reduce-short.js',
  '/interest-fixture': '/fixture-interest.js', '/arrears-fixture': '/fixture-arrears.js',
  '/small-profit-fixture': '/fixture-small-profit.js' };
http.createServer(async (request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  if (Object.hasOwn(scripts, route)) {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(scripts[route]); return;
  }
  if (Object.hasOwn(fixtures, route)) {
    const html = await fs.readFile(path.join(__dirname, '../index.html'), 'utf8');
    const setup = fixtures[route];
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html.replace('<script src="app.js" defer></script>', `<script src="${setup}" defer></script><script src="app.js" defer></script>`));
    return;
  }
  normalHandler(request, response);
}).listen(0, '127.0.0.1', function () { console.log(`FX story QA: http://127.0.0.1:${this.address().port}`); });
