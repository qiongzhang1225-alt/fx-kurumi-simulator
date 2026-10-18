const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FXEngine } = require('../engine.js');
const game = () => new FXEngine({ seed: 31415 });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('borrowing provides trading cash without counting it as profit or net wealth', () => {
  const g = game();
  assert.equal(typeof g.borrow, 'function');
  assert.equal(g.borrow(1000000).ok, true);
  assert.equal(g.balance, 1300000);
  assert.equal(g.account().debt, 1000000);
  assert.equal(g.account().netAssets, 300000);
  assert.equal(g.account().realizedPnl, 0);
  assert.equal(g.account().repayable, 1000000);
  assert.equal(g.open('long', 500000, 10).ok, true);
});

test('loan validation is atomic and the outstanding limit cannot be bypassed', () => {
  const g = game();
  assert.equal(typeof g.borrow, 'function');
  for (const amount of [0, -1, 1.5, NaN, Infinity, '1000000', 20000001]) {
    assert.equal(g.borrow(amount).ok, false);
    assert.equal(g.balance, 300000);
  }
  assert.equal(g.borrow(20000000).ok, true);
  assert.equal(g.ending, null, 'a fully funded loan is not a loss');
  assert.equal(g.borrow(1).ok, false);
  assert.equal(g.repay(5000000).ok, true);
  assert.equal(g.borrow(5000000).ok, true);
  assert.equal(g.account().debt, 20000000);
  assert.equal(g.account().netAssets, 300000);
});

test('repayment reduces cash and debt equally and cannot spend occupied margin', () => {
  const g = game();
  assert.equal(typeof g.repay, 'function');
  g.borrow(1000000);
  assert.equal(g.open('long', 1000000, 1).ok, true);
  const wealth = g.account().netAssets;
  assert.equal(g.repay(300000).ok, false, 'spread leaves less than 300000 free');
  assert.equal(g.repay(200000).ok, true);
  near(g.account().netAssets, wealth);
  assert.equal(g.account().debt, 800000);
  assert.equal(g.position.margin, 1000000);
  for (const amount of [0, -1, 0.5, NaN, Infinity, 800001]) assert.equal(g.repay(amount).ok, false);
});

test('reported realized profit excludes loans and includes paid interest after trading and repayment', () => {
  const g = game();
  assert.equal(typeof g.borrow, 'function');
  g.borrow(1000000);
  g.open('long', 30000, 10);
  g.advance(151);
  const { trade } = g.close();
  g.repay(500000);
  near(g.account().realizedPnl, trade.pnl - 3.47);
  near(g.account().netAssets, 300000 + trade.pnl - 3.47);
});

test('borrowing twenty million never unlocks wealth achievements', () => {
  const g = game();
  assert.equal(typeof g.takeEvents, 'function');
  g.borrow(20000000);
  const events = g.takeEvents();
  assert.ok(events.some(e => e.id === 'first-loan'));
  assert.ok(!events.some(e => ['million', 'twenty-million'].includes(e.id)));
  assert.deepEqual(g.takeEvents(), []);
});

test('twenty million achievement uses live net assets after subtracting debt and fires once', () => {
  const g = game();
  assert.equal(typeof g.takeEvents, 'function');
  g.borrow(20000000);
  g.takeEvents();
  g.open('long', 1000000, 100);
  g.advance(160);
  assert.ok(!g.takeEvents().some(e => e.id === 'twenty-million'));
  g.advance(181);
  assert.ok(g.account().netAssets > 20000000);
  assert.equal(g.takeEvents().filter(e => e.id === 'twenty-million').length, 1);
  g.close();
  g.advance();
  assert.ok(!g.takeEvents().some(e => e.id === 'twenty-million'));
  assert.ok(g.unlocked.includes('twenty-million'));
});

test('the twenty million achievement includes the exact boundary and does not unlock below it', () => {
  const g = game();
  assert.equal(typeof g.takeEvents, 'function');
  g.open('long', 30000, 100);
  const boundary = 150.01 + 0.01 + 19700000 / (3000000 / 150.01);
  g.advance(boundary - 0.001);
  assert.ok(!g.takeEvents().some(e => e.id === 'twenty-million'));
  g.advance(boundary);
  assert.equal(g.takeEvents().filter(e => e.id === 'twenty-million').length, 1);
});

test('first winning trade and clearing debt each unlock their own single achievement', () => {
  const g = game();
  assert.equal(typeof g.takeEvents, 'function');
  g.borrow(100000);
  g.open('long', 30000, 10); g.advance(151); g.close();
  g.repay(100000);
  const ids = g.takeEvents().map(e => e.id);
  assert.ok(ids.includes('first-profit'));
  assert.ok(ids.includes('debt-free'));
  g.borrow(100000); g.repay(100000);
  assert.deepEqual(g.takeEvents(), []);
});

test('losing cash before reaching the debt limit permits borrowing another chance', () => {
  const g = game();
  assert.equal(typeof g.borrow, 'function');
  g.borrow(1000000);
  g.open('long', 1000000, 100);
  g.advance(1);
  assert.equal(g.balance, 0);
  assert.equal(g.ending, null);
  assert.equal(g.borrow(1000000).ok, true);
});

test('exhausting assets with twenty million debt ends the run and blocks further mutations', () => {
  const g = game();
  assert.equal(typeof g.takeEvents, 'function');
  g.borrow(20000000);
  g.open('long', 19000000, 100);
  const result = g.advance(1);
  assert.equal(result.trade.reason, 'liquidation');
  assert.equal(g.balance, 0);
  assert.equal(g.ending.id, 'debt-ending');
  assert.equal(g.ending.debt, 20000000);
  assert.equal(g.account().netAssets, -20000000);
  assert.equal(g.account().realizedPnl, -20300000);
  const events = g.takeEvents();
  assert.ok(events.some(e => e.id === 'first-liquidation'));
  assert.equal(events.filter(e => e.type === 'ending').length, 1);
  const prices = g.prices(), tick = g.tick;
  assert.equal(g.advance().ok, false);
  assert.equal(g.open('short', 1, 1).ok, false);
  assert.equal(g.borrow(1).ok, false);
  assert.equal(g.repay(1).ok, false);
  assert.equal(g.close().ok, false);
  assert.deepEqual(g.prices(), prices);
  assert.equal(g.tick, tick);
  assert.deepEqual(g.takeEvents(), []);
  assert.equal(g.select('CHFJPY').ok, true, 'ended markets remain inspectable');
});

test('sub-yen dust cannot leave a fully indebted run stuck without an ending', () => {
  const g = game();
  assert.equal(typeof g.borrow, 'function');
  g.borrow(20000000);
  g.open('long', 19000000, 100);
  const p = g.position;
  // The first minute bills 69.44 yen on 20m principal before liquidation.
  const exitMid = p.entry + 0.01 + (0.5 + 69.44 - 20300000) / p.units;
  g.advance(exitMid);
  near(g.balance, 0.5);
  assert.equal(g.ending.id, 'debt-ending');
});

test('loan actions and story events cannot consume market random numbers', () => {
  const a = game(), b = game();
  assert.equal(typeof a.borrow, 'function');
  for (let i = 0; i < 120; i++) {
    if (i % 3 === 0) { a.borrow(100000); a.repay(100000); }
    a.takeEvents();
    a.advance(); b.advance();
    assert.deepEqual(a.prices(), b.prices());
  }
});

test('reset clears debt, achievements, pending events and the ending together', () => {
  const g = game();
  assert.equal(typeof g.borrow, 'function');
  g.borrow(20000000); g.open('long', 19000000, 100); g.advance(1);
  g.reset();
  assert.equal(g.account().debt, 0);
  assert.equal(g.account().netAssets, 300000);
  assert.equal(g.account().realizedPnl, 0);
  assert.equal(g.ending, null);
  assert.deepEqual(g.unlocked, []);
  assert.deepEqual(g.takeEvents(), []);
  assert.equal(g.borrow(1).ok, true);
});
