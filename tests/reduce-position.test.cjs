const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FXEngine } = require('../engine.js');
const game = () => new FXEngine({ seed: 12345 });
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('reducing a losing long realizes only that fraction and releases margin without crediting it to cash', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  g.open('long', 60000, 25); g.advance(149.02);
  const result = g.reduce(50);
  assert.equal(result.ok, true);
  near(result.trade.pnl, -4999.666688887408);
  near(g.balance, 295000.3333111126);
  near(g.position.units, 4999.666688887408);
  assert.equal(g.position.margin, 30000);
  assert.equal(g.position.notional, 750000);
  near(g.account().pnl, -4999.666688887408);
  near(g.account().equity, 290000.6666222252);
  near(g.account().freeMargin, 260000.6666222252);
  assert.equal(g.position.entry, 150.01);
  assert.equal(g.position.leverage, 25);
  assert.equal(g.position.openedAt, 0);
  assert.equal(g.position.reductions, 1);
});

test('a profitable short reduction closes at ask and records the current-position percentage and quantity', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  g.open('short', 60000, 10); g.advance(148.98);
  const result = g.reduce(25);
  near(result.trade.pnl, 1000.0666711114073);
  near(result.trade.units, 1000.0666711114073);
  near(result.trade.exit, 148.99);
  assert.equal(result.trade.closedPercent, 25);
  assert.equal(result.trade.reason, 'partial');
  assert.equal(result.trade.margin, 15000);
  assert.equal(result.trade.notional, 150000);
  assert.equal(g.position.margin, 45000);
  assert.equal(g.position.entry, 149.99);
  assert.equal(g.wins, 1);
  assert.equal(g.totalTrades, 1);
  assert.ok(g.takeEvents().some(event => event.id === 'first-profit'));
});

test('partial settlement preserves live equity and does not charge spread twice', () => {
  for (const side of ['long', 'short']) {
    const g = game();
    assert.equal(typeof g.reduce, 'function');
    g.open(side, 60000, 25);
    const before = g.account();
    g.reduce(50);
    near(g.account().equity, before.equity);
    near(g.account().realizedPnl + g.account().pnl, before.pnl);
    near(g.account().freeMargin, before.freeMargin + 30000);
  }
});

test('repeated fifty-percent reductions halve the remaining position and final settlement counts each unit once', () => {
  const a = game(), b = game();
  assert.equal(typeof a.reduce, 'function');
  for (const g of [a, b]) { g.open('long', 60000, 25); g.advance(151); }
  a.reduce(50); a.reduce(50);
  assert.equal(a.position.margin, 15000);
  near(a.position.units, 2499.833344443704);
  assert.equal(a.position.reductions, 2);
  assert.equal(a.history[0].closedPercent, 50);
  near(a.history[0].units, 2499.833344443704);
  a.close(); b.close();
  near(a.balance, b.balance);
  near(a.history.reduce((sum, trade) => sum + trade.pnl, 0), b.history[0].pnl);
  near(a.history.reduce((sum, trade) => sum + trade.units, 0), 9999.333377774816);
  assert.equal(a.history.reduce((sum, trade) => sum + trade.margin, 0), 60000);
  assert.equal(a.history.length, 3);
  assert.equal(a.totalTrades, 3);
});

test('one hundred percent uses the same complete closeout as the existing close action', () => {
  for (const percent of [100, 99.999999999]) {
    const a = game(), b = game();
    assert.equal(typeof a.reduce, 'function');
    for (const g of [a, b]) { g.open('short', 60000, 25); g.advance(151); }
    const reduced = a.reduce(percent), closed = b.close();
    assert.deepEqual(reduced, closed);
    assert.equal(a.position, null);
    assert.equal(a.history[0].reason, 'manual');
    assert.equal(a.history[0].closedPercent, 100);
    assert.equal(a.reduce(50).ok, false);
  }
});

test('reduction preview exposes accurate after-state without consuming position, cash, history, or events', () => {
  const a = game(), b = game();
  assert.equal(typeof a.previewReduce, 'function');
  for (const g of [a, b]) { g.open('long', 60000, 25); g.advance(149.02); }
  const original = { ...a.position };
  const preview = a.previewReduce(50);
  assert.equal(preview.ok, true);
  near(preview.closedUnits, 4999.666688887408);
  near(preview.realizedPnl, -4999.666688887408);
  assert.equal(preview.releasedMargin, 30000);
  near(preview.after.balance, 295000.3333111126);
  near(preview.after.equity, preview.before.equity);
  assert.deepEqual(a.position, original);
  assert.equal(a.balance, 300000);
  assert.deepEqual(a.history, []);
  a.reduce(50);
  near(a.account().pnl, preview.after.pnl);
  near(a.account().freeMargin, preview.after.freeMargin);
  near(a.liquidationPrice(), preview.after.liquidationPrice);
  for (let i = 0; i < 100; i++) { a.previewReduce(25); a.advance(); b.advance(); }
  assert.deepEqual(a.prices(), b.prices());
});

test('reduction always prices the held currency even when another chart is selected', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  g.open('long', 60000, 25); g.select('CHFJPY');
  g.advance({ USDJPY: 149.02, CHFJPY: 200 });
  const { trade } = g.reduce(50);
  assert.equal(trade.symbol, 'USDJPY');
  near(trade.exit, 149.01);
  near(trade.pnl, -4999.666688887408);
  assert.equal(g.symbol, 'CHFJPY');
  assert.equal(g.position.symbol, 'USDJPY');
});

test('invalid percentages are rejected atomically and custom tenths of a percent are accepted', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  assert.equal(g.reduce(50).ok, false);
  g.open('long', 60000, 25);
  const original = { ...g.position };
  for (const percent of [0, -1, 0.01, 25.05, 100.1, NaN, Infinity, '50', null, 1n, Symbol('percent'), {}]) {
    assert.equal(g.reduce(percent).ok, false);
    assert.deepEqual(g.position, original);
    assert.equal(g.balance, 300000);
    assert.equal(g.history.length, 0);
  }
  assert.equal(g.reduce(12.5).ok, true);
  assert.equal(g.position.margin, 52500);
  assert.equal(g.history[0].closedPercent, 12.5);
});

test('reducing does not repay borrowed money or reset the weighted entry from previous additions', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  g.borrow(100000); g.open('long', 30000, 10); g.advance(149); g.add(30000);
  const original = { ...g.position };
  const before = g.account();
  g.reduce(50);
  assert.equal(g.position.entry, original.entry);
  assert.equal(g.position.additions, 1);
  assert.equal(g.position.openedAt, 0);
  assert.equal(g.debt, 100000);
  near(g.account().netAssets, before.netAssets);
  near(g.position.units, original.units / 2);
  g.add(10000);
  assert.equal(g.position.reductions, 1);
  assert.equal(g.position.additions, 2);
  assert.equal(g.position.margin, 40000);
});

test('long and short partial closes move the closeout outward while preserving its fifty-percent boundary', () => {
  for (const [side, mid] of [['long', 149.3], ['short', 150.7]]) {
    const g = game();
    assert.equal(typeof g.previewReduce, 'function');
    g.open(side, 270000, 100); g.advance(mid);
    const preview = g.previewReduce(50), direction = g.position.direction;
    assert.ok(direction * (preview.before.liquidationPrice - preview.after.liquidationPrice) > 0);
    g.reduce(50);
    const line = g.liquidationPrice();
    g.advance(line);
    assert.equal(g.position, null);
    assert.equal(g.history[0].reason, 'liquidation');
    near(g.balance, 67500);
    assert.equal(g.history.length, 2);
  }
});

test('previewing a full close reports no remaining margin or liquidation threshold', () => {
  const g = game();
  assert.equal(typeof g.previewReduce, 'function');
  g.open('long', 60000, 25);
  const preview = g.previewReduce(100);
  assert.equal(preview.after.units, 0);
  assert.equal(preview.after.margin, 0);
  assert.equal(preview.after.pnl, 0);
  assert.equal(preview.after.marginLevel, null);
  assert.equal(preview.after.liquidationPrice, null);
  near(preview.after.balance, preview.after.equity);
  assert.ok(g.position, 'preview does not actually close');
});

test('paused, liquidated and ended runs cannot accept partial closes and reset removes reduction metadata', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  g.open('long', 60000, 25); g.paused = true;
  assert.equal(g.reduce(50).ok, false);
  g.paused = false; g.reduce(50); g.advance(1);
  assert.equal(g.reduce(50).ok, false);
  g.reset();
  g.borrow(20000000); g.open('long', 19000000, 100); g.advance(1);
  assert.ok(g.ending);
  assert.equal(g.reduce(100).ok, false);
  g.reset();
  assert.equal(g.history.length, 0);
  g.open('long', 10000, 10);
  assert.equal(g.position.reductions, 0);
});

test('a gap close still caps the total actual loss and cannot be revived by a partial close', () => {
  const g = game();
  assert.equal(typeof g.reduce, 'function');
  g.borrow(20000000); g.open('long', 19000000, 100);
  g.reduce(25);
  g.advance(1);
  assert.equal(g.balance, 0);
  assert.equal(g.position, null);
  assert.equal(g.ending.id, 'debt-ending');
  near(g.history.reduce((sum, trade) => sum + trade.pnl, 0), -20299930.56);
  near(g.account().realizedPnl, -20300000);
  assert.equal(g.reduce(25).ok, false);
  assert.equal(g.history.length, 2);
});

test('reductions leave all market random paths identical to an account with no trades', () => {
  const a = game(), b = game();
  assert.equal(typeof a.reduce, 'function');
  a.open('long', 10000, 10);
  for (let i = 0; i < 200; i++) {
    if (i % 10 === 0 && a.position) a.reduce(25);
    a.advance(); b.advance();
    assert.deepEqual(a.prices(), b.prices());
  }
});
