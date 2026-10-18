const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FXEngine } = require('../engine.js');
const game = () => new FXEngine({ seed: 31415 });

test('the first winning settlement includes its exact amount in one achievement event without a duplicate popup event', () => {
  const g = game(); g.open('short', 60000, 10); g.advance(148.98); g.takeEvents();
  const { trade } = g.reduce(25), events = g.takeEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'achievement');
  assert.equal(events[0].id, 'first-profit');
  assert.ok(events[0].settlement, 'first-profit page needs the actual settlement');
  assert.equal(events[0].settlement.pnl, trade.pnl);
  assert.equal(events[0].settlement.id, trade.id);
  assert.equal(events[0].settlement.closedPercent, 25);
  assert.equal(events[0].settlement.symbol, 'USDJPY');
  assert.equal(g.unlocked.filter(id => id === 'first-profit').length, 1);
});

test('later profitable reductions and full closes each queue their own immutable settlement amount', () => {
  const g = game(); g.open('short', 60000, 10); g.advance(148.98); g.reduce(25); g.takeEvents();
  const second = g.reduce(50).trade, third = g.close().trade, events = g.takeEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.type), ['profit', 'profit']);
  assert.deepEqual(events.map(e => e.settlement.id), [second.id, third.id]);
  assert.equal(events[0].settlement.pnl, second.pnl);
  assert.equal(events[1].settlement.pnl, third.pnl);
  const captured = events[0].settlement.pnl;
  second.pnl = 123;
  assert.equal(events[0].settlement.pnl, captured, 'popup must keep its own settlement snapshot');
  assert.equal(g.unlocked.filter(id => id === 'first-profit').length, 1);
});

test('floating gains, losses and a zero-profit close do not queue profitable-settlement popups', () => {
  const g = game(); g.open('long', 30000, 10); g.advance(151);
  assert.deepEqual(g.takeEvents(), []);
  g.advance(149); g.close();
  assert.deepEqual(g.takeEvents(), []);
  g.open('long', 30000, 10); g.advance(g.position.entry + 0.01); g.close();
  assert.deepEqual(g.takeEvents(), []);
});

test('reset removes pending profit notifications and a new run can earn its first-profit amount again', () => {
  const g = game();
  g.open('short', 60000, 10); g.advance(148.98); g.reduce(25); g.takeEvents(); g.close();
  g.reset();
  assert.deepEqual(g.takeEvents(), []);
  g.open('short', 60000, 10); g.advance(148.98); const { trade } = g.close();
  const events = g.takeEvents();
  assert.equal(events[0].id, 'first-profit');
  assert.equal(events[0].settlement.pnl, trade.pnl);
});
