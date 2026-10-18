const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FXEngine } = require('../engine.js');
const game = () => new FXEngine({ seed: 12345 });
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('a long addition merges base units at a weighted entry without changing cash or original open time', () => {
  const g = game();
  assert.equal(typeof g.add, 'function');
  g.open('long', 30000, 10); g.advance(149);
  assert.equal(g.add(30000).ok, true);
  near(g.position.units, 4013.1543743671236);
  near(g.position.entry, 149.5083278710454);
  assert.equal(g.position.margin, 60000);
  assert.equal(g.position.notional, 600000);
  assert.equal(g.position.leverage, 10);
  assert.equal(g.position.openedAt, 0);
  assert.equal(g.position.additions, 1);
  assert.equal(g.balance, 300000);
  assert.equal(g.debt, 0);
  assert.equal(g.totalTrades, 0);
});

test('a short addition uses the held bid quote and settles the aggregate in one history record', () => {
  const g = game();
  assert.equal(typeof g.add, 'function');
  g.open('short', 30000, 10); g.advance(151); g.add(30000);
  near(g.position.units, 3987.0198910008794);
  near(g.position.entry, 150.4883387600505);
  g.advance(149);
  const { trade } = g.close();
  near(trade.pnl, 5894.166041958997);
  assert.equal(trade.additions, 1);
  assert.equal(trade.margin, 60000);
  assert.equal(trade.notional, 600000);
  assert.equal(g.history.length, 1);
  assert.equal(g.totalTrades, 1);
});

test('adding does not erase an existing loss and immediately pays only the incremental spread', () => {
  const g = game();
  assert.equal(typeof g.previewAdd, 'function');
  g.open('long', 30000, 10); g.advance(149);
  const loss = g.account().pnl;
  const preview = g.previewAdd(30000);
  assert.equal(preview.ok, true);
  near(preview.spreadCost, 40.26575397624321);
  near(preview.after.pnl, loss - 40.26575397624321);
  g.add(30000);
  near(g.account().pnl, loss - 40.26575397624321);
  near(g.account().freeMargin, preview.after.freeMargin);
  near(g.liquidationPrice(), preview.after.liquidationPrice);
});

test('addition preview is non-mutating and does not consume market randomness or story events', () => {
  const a = game(), b = game();
  assert.equal(typeof a.previewAdd, 'function');
  a.open('long', 30000, 10); b.open('long', 30000, 10);
  const position = { ...a.position };
  for (let i = 0; i < 80; i++) { a.previewAdd(30000); a.advance(); b.advance(); }
  assert.deepEqual(a.position, position);
  assert.deepEqual(a.prices(), b.prices());
  assert.equal(a.balance, 300000);
  assert.deepEqual(a.takeEvents(), b.takeEvents());
});

test('additions always target the held currency even while another chart is selected', () => {
  const g = game();
  assert.equal(typeof g.previewAdd, 'function');
  g.open('long', 30000, 10); g.advance({ USDJPY: 149, CHFJPY: 200 });
  g.select('CHFJPY');
  const preview = g.previewAdd(30000);
  assert.equal(preview.symbol, 'USDJPY');
  assert.equal(preview.side, 'long');
  assert.equal(preview.leverage, 10);
  near(preview.entry, 149.01);
  g.add(30000);
  assert.equal(g.position.symbol, 'USDJPY');
  assert.equal(g.symbol, 'CHFJPY');
  near(g.position.entry, 149.5083278710454);
});

test('rejected additions are atomic and must fit free margin plus incremental spread', () => {
  const g = game();
  assert.equal(typeof g.add, 'function');
  assert.equal(g.add(30000).ok, false);
  g.open('long', 30000, 10);
  const original = { ...g.position };
  for (const amount of [0, -1, 1.5, NaN, Infinity, '30000', 269900, Number.MAX_SAFE_INTEGER]) {
    assert.equal(g.add(amount).ok, false);
    assert.deepEqual(g.position, original);
    assert.equal(g.balance, 300000);
  }
  assert.equal(g.previewAdd(269000).ok, true);
});

test('existing unrealized losses restrict additions even when the cash balance appears sufficient', () => {
  const g = game();
  assert.equal(typeof g.add, 'function');
  g.open('long', 270000, 100); g.advance(149.3);
  assert.ok(g.account().freeMargin < 0);
  assert.equal(g.add(1).ok, false);
  g.borrow(200000);
  assert.equal(g.add(100000).ok, false, 'the new spread must also fit');
  assert.equal(g.add(90000).ok, true);
});

test('averaging down can move the closeout closer even though the average entry improves', () => {
  const g = game();
  assert.equal(typeof g.previewAdd, 'function');
  g.open('long', 270000, 100); g.advance(149.3); g.borrow(200000);
  const preview = g.previewAdd(90000);
  assert.equal(preview.ok, true);
  assert.ok(preview.after.entry < preview.before.entry);
  assert.ok(preview.after.liquidationPrice > preview.before.liquidationPrice);
});

test('aggregate position uses the combined margin at the actual liquidation boundary', () => {
  const g = game();
  assert.equal(typeof g.add, 'function');
  g.open('long', 30000, 10); g.advance(149); g.add(30000);
  near(g.liquidationPrice(), 82.23958032907495);
  const result = g.advance(82.23958032907495);
  assert.equal(result.trade.reason, 'liquidation');
  near(g.balance, 30000);
  near(result.trade.pnl, -270000);
  assert.equal(result.trade.additions, 1);
});

test('loan preview shows a more distant long closeout without altering size or net wealth', () => {
  const g = game();
  g.open('long', 270000, 100);
  const result = g.previewLoan('borrow', 100000);
  assert.ok(result.before && result.after, 'preview must expose both account states');
  near(result.before.liquidationPrice, 149.10327222222222);
  near(result.after.liquidationPrice, 148.5476796296296);
  assert.equal(result.after.units, result.before.units);
  assert.equal(result.after.entry, result.before.entry);
  near(result.after.netAssets, 296400.23998400435);
  assert.equal(result.after.netAssets, result.before.netAssets);
  assert.equal(g.balance, 300000);
  assert.equal(g.debt, 0);
  g.borrow(100000);
  near(g.liquidationPrice(), result.after.liquidationPrice);
});

test('funding pushes a short closeout upward and repayment reverses it without changing units', () => {
  const g = game();
  g.open('short', 270000, 100);
  const preview = g.previewLoan('borrow', 100000);
  assert.ok(preview.before && preview.after);
  assert.ok(preview.after.liquidationPrice > preview.before.liquidationPrice);
  g.borrow(100000);
  const repay = g.previewLoan('repay', 100000);
  near(repay.after.liquidationPrice, preview.before.liquidationPrice);
  g.repay(100000);
  near(g.liquidationPrice(), preview.before.liquidationPrice);
  assert.equal(g.position.units, preview.before.units);
});

test('additions are blocked while paused, after settlement and after a debt ending', () => {
  const g = game();
  assert.equal(typeof g.add, 'function');
  g.open('long', 30000, 10); g.paused = true;
  assert.equal(g.add(30000).ok, false);
  g.paused = false; g.close();
  assert.equal(g.add(30000).ok, false);
  g.borrow(20000000); g.open('long', 19000000, 100); g.advance(1);
  assert.ok(g.ending);
  assert.equal(g.add(1).ok, false);
  g.reset();
  assert.equal(g.position, null);
  assert.equal(g.add(1).ok, false);
  assert.equal(g.open('long', 30000, 10).ok, true);
  assert.equal(g.position.additions, 0);
});

test('executed additions leave every independent market path unchanged', () => {
  const a = game(), b = game();
  assert.equal(typeof a.add, 'function');
  a.open('long', 1000, 10);
  for (let i = 0; i < 300; i++) {
    if (i % 5 === 0 && a.position) a.add(100);
    a.advance(); b.advance();
    assert.deepEqual(a.prices(), b.prices());
  }
});
