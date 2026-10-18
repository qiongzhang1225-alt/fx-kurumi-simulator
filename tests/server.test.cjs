const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createProjectServer } = require('../server.cjs');
const { ACHIEVEMENTS } = require('../engine.js');

let server, origin;
before(async () => {
  server = createProjectServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test('the local entry serves the game as UTF-8 HTML', async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html.*utf-8/);
  assert.match(await response.text(), /FX LAB · 外汇模拟交易台/);
});

test('all offline assets have browser-compatible content types', async () => {
  for (const [name, type] of [['styles.css', 'text/css'], ['engine.js', 'text/javascript'], ['chart.js', 'text/javascript'], ['app.js', 'text/javascript']]) {
    const response = await fetch(`${origin}/${name}?v=1`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(type));
  }
});

test('story UI and bundled official reaction images load without external requests', async () => {
  for (const [name, type] of [
    ['story-ui.js', 'text/javascript'],
    ['assets/kurumi-laugh.jpg', 'image/jpeg'], ['assets/kurumi-goal.jpg', 'image/jpeg'],
    ['assets/kurumi-grit.jpg', 'image/jpeg'], ['assets/kurumi-panic.jpg', 'image/jpeg'],
    ['assets/mochiko.png', 'image/png'],
  ]) {
    const response = await fetch(`${origin}/${name}`);
    assert.equal(response.status, 200, name);
    assert.ok(response.headers.get('content-type').includes(type), name);
    assert.ok((await response.arrayBuffer()).byteLength > 100, name);
  }
  assert.equal((await fetch(`${origin}/assets/unknown.jpg`)).status, 404);
});

test('private project files and unknown paths are not served', async () => {
  for (const path of ['/package.json', '/docs/progress.md', '/%2e%2e%2fREADME.md', '/unknown', '/%ZZ']) {
    const response = await fetch(origin + path);
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`);
  }
});

test('each achievement has its own offline reaction image and a loadable transparent silhouette source', async () => {
  assert.equal(new Set(ACHIEVEMENTS.map(item => item.meme)).size, ACHIEVEMENTS.length,
    'different achievements must not reuse the same reaction image');
  for (const item of ACHIEVEMENTS) {
    assert.match(item.silhouette, /^assets\/[\w-]+\.png$/);
    for (const file of [item.meme, item.silhouette]) {
      const response = await fetch(`${origin}/${file}`);
      assert.equal(response.status, 200, file);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.ok(bytes.length > 100, file);
      if (file.endsWith('.png')) {
        assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], file);
        assert.equal(bytes[25], 6, `${file} must retain its alpha channel`);
      }
    }
  }
});

test('HEAD contains no body and mutations are rejected', async () => {
  const head = await fetch(origin, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(origin, { method: 'POST' });
  assert.equal(post.status, 405);
});
