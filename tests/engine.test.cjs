const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FXEngine, Market, INSTRUMENTS, seededRandom } = require('../engine.js');
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
const game = () => new FXEngine({ seed: 12345 });

test('the account starts with 300000 JPY and changing charts does not create money', () => {
  const g = game();
  assert.equal(g.balance, 300000);
  assert.equal(g.account().currency, 'JPY');
  assert.equal(g.select('GBPJPY').ok, true);
  assert.equal(g.balance, 300000);
});

test('JPY margin converts into base currency units at the actual entry price', () => {
  const g = game();
  assert.equal(g.open('long', 30000, 10).ok, true);
  near(g.position.entry, 150.01);
  near(g.position.units, 300000 / 150.01);
  assert.equal(g.position.notional, 300000);
  near(g.account().pnl, -6000 / 150.01);
  near(g.account().freeMargin, 270000 - 6000 / 150.01);
  assert.equal(g.balance, 300000);
});

test('long P/L settles directly in yen and releases margin only once', () => {
  const g = game();
  g.open('long', 30000, 10);
  g.advance(151);
  near(g.account().pnl, 294000 / 150.01);
  const result = g.close();
  assert.equal(result.ok, true);
  near(g.balance, 300000 + 294000 / 150.01);
  assert.equal(result.trade.symbol, 'USDJPY');
  assert.equal(result.trade.currency, 'JPY');
  assert.equal(g.account().usedMargin, 0);
  assert.equal(g.close().ok, false);
  assert.equal(g.history.length, 1);
});

test('short P/L uses bid entry and ask exit without converting the yen profit back to USD', () => {
  const g = game();
  g.open('short', 30000, 10);
  near(g.position.units, 300000 / 149.99);
  g.advance(149);
  near(g.account().pnl, 294000 / 149.99);
  g.close();
  near(g.balance, 300000 + 294000 / 149.99);
});

test('a same-price round trip charges the correct directional spread in JPY', () => {
  for (const [side, expected] of [['long', 300000 - 6000 / 150.01], ['short', 300000 - 6000 / 149.99]]) {
    const g = game();
    g.open(side, 30000, 10);
    g.close();
    near(g.balance, expected);
  }
});

test('invalid, fractional-yen and unaffordable margins do not mutate the account', () => {
  const g = game();
  for (const margin of [0, -1, 0.5, 1.5, NaN, Infinity, '', '30000', null, 400000, 300000]) {
    assert.equal(g.open('long', margin, 10).ok, false);
    assert.equal(g.position, null);
    assert.equal(g.balance, 300000);
  }
  assert.equal(g.open('up', 30000, 10).ok, false);
  assert.equal(g.open('long', 30000, 9).ok, false);
});

test('order previews give executable units and cost without consuming market randomness', () => {
  const a = game(), b = game();
  const preview = a.preview('long', 30000, 10);
  assert.equal(preview.ok, true);
  near(preview.units, 300000 / 150.01);
  near(preview.spreadCost, 6000 / 150.01);
  assert.equal(a.preview('long', 300000, 10).ok, false);
  for (let i = 0; i < 50; i++) { a.preview('short', 1000, 25); a.advance(); b.advance(); }
  assert.deepEqual(a.prices(), b.prices());
});

test('a second order in a different currency cannot overwrite the active position', () => {
  const g = game();
  g.open('long', 30000, 10);
  const original = g.position;
  g.select('EURJPY');
  assert.equal(g.open('short', 30000, 10).ok, false);
  assert.equal(g.position, original);
  assert.equal(g.position.symbol, 'USDJPY');
});

test('long position liquidates at the JPY account 50 percent margin boundary', () => {
  const g = game();
  g.open('long', 270000, 100);
  const boundary = g.liquidationPrice();
  near(boundary, 149.10327222222222);
  g.advance(boundary + 0.001);
  assert.ok(g.position);
  g.advance(boundary);
  assert.equal(g.position, null);
  assert.equal(g.history[0].reason, 'liquidation');
  near(g.balance, 135000);
  g.advance(148);
  assert.equal(g.history.length, 1);
});

test('short liquidation price corresponds to actual JPY equity closeout', () => {
  const g = game();
  g.open('short', 270000, 100);
  const boundary = g.liquidationPrice();
  near(boundary, 150.89660555555555);
  g.advance(boundary - 0.001);
  assert.ok(g.position);
  g.advance(boundary);
  assert.equal(g.position, null);
  near(g.balance, 135000);
});

test('an unreachable liquidation price is omitted for a sufficiently small long position', () => {
  const g = game();
  g.open('long', 1, 1);
  assert.equal(g.liquidationPrice(), null);
  g.advance(1);
  assert.ok(g.position);
  assert.ok(g.account().equity > 299999);
});

test('extreme gaps protect the JPY balance and record the actual account loss', () => {
  for (const [side, price] of [['long', 90], ['short', 210]]) {
    const g = game();
    g.open(side, 270000, 100);
    g.advance(price);
    assert.equal(g.balance, 0);
    assert.equal(g.history[0].pnl, -300000);
    assert.equal(g.open('long', 1, 1).ok, false);
  }
});

test('all five yen crosses can be selected and traded using their own spread and price', () => {
  const g = game();
  assert.deepEqual(INSTRUMENTS.map(c => c.symbol), ['USDJPY', 'EURJPY', 'AUDJPY', 'GBPJPY', 'CHFJPY']);
  for (const config of INSTRUMENTS) {
    assert.equal(g.select(config.symbol).ok, true);
    near(g.price, config.start);
    assert.equal(g.open('long', 1000, 10).ok, true);
    assert.equal(g.position.symbol, config.symbol);
    near(g.position.entry, config.start + config.spread / 2);
    assert.ok(g.close().trade.pnl < 0);
  }
});

test('unselected currencies keep moving and chart switching does not reset history or time', () => {
  const g = game();
  const initial = g.prices();
  for (let i = 0; i < 20; i++) g.advance();
  for (const symbol of Object.keys(initial)) assert.notEqual(g.prices()[symbol], initial[symbol]);
  const current = g.prices().AUDJPY;
  g.select('AUDJPY');
  assert.equal(g.price, current);
  assert.equal(g.tick, 20);
  const candles = g.candles;
  g.select('CHFJPY'); g.select('AUDJPY');
  assert.equal(g.candles, candles);
  assert.equal(g.tick, 20);
});

test('switching the viewed currency cannot change the held currency P/L or exit price', () => {
  const g = game();
  g.open('long', 30000, 10);
  g.select('EURJPY');
  g.advance({ USDJPY: 151, EURJPY: 170 });
  near(g.price, 170);
  near(g.account().pnl, 294000 / 150.01);
  near(g.liquidationPrice(), 7.5105);
  const result = g.close();
  assert.equal(result.trade.symbol, 'USDJPY');
  near(result.trade.exit, 150.99);
  near(result.trade.pnl, 294000 / 150.01);
});

test('an unviewed position can still be liquidated by its own price feed', () => {
  const g = game();
  g.open('long', 270000, 100);
  g.select('CHFJPY');
  const result = g.advance({ USDJPY: 140, CHFJPY: 171 });
  assert.equal(result.trade.reason, 'liquidation');
  assert.equal(result.trade.symbol, 'USDJPY');
  assert.equal(g.symbol, 'CHFJPY');
  assert.equal(g.balance, 0);
});

test('identical seed and time produce identical prices whether or not any trades happen', () => {
  const trader = new FXEngine({ seed: 9876 });
  const observer = new FXEngine({ seed: 9876 });
  for (let i = 0; i < 400; i++) {
    if (i % 7 === 0 && !trader.position) trader.open(i % 2 ? 'long' : 'short', 1000, 25);
    if (i % 11 === 0 && trader.position) trader.close();
    trader.select(['GBPJPY', 'CHFJPY', 'AUDJPY'][i % 3]);
    trader.advance(); observer.advance();
    assert.deepEqual(trader.prices(), observer.prices());
  }
});

test('forced liquidation also leaves every generated price path unchanged', () => {
  const trader = game(), observer = game();
  trader.open('long', 270000, 100);
  trader.advance(140); observer.advance(140);
  assert.equal(trader.position, null);
  for (let i = 0; i < 80; i++) { trader.advance(); observer.advance(); }
  assert.deepEqual(trader.prices(), observer.prices());
});

test('aggressive and conservative profiles create measurably different relative volatility', () => {
  const conservative = new Market(INSTRUMENTS.find(c => c.symbol === 'CHFJPY'), seededRandom(42));
  const aggressive = new Market(INSTRUMENTS.find(c => c.symbol === 'GBPJPY'), seededRandom(42));
  let slowMoves = 0, fastMoves = 0;
  for (let i = 0; i < 3000; i++) {
    const a = conservative.price, b = aggressive.price;
    conservative.advance(); aggressive.advance();
    slowMoves += Math.abs(conservative.price / a - 1);
    fastMoves += Math.abs(aggressive.price / b - 1);
  }
  assert.ok(fastMoves > slowMoves * 3, `${fastMoves} should exceed ${slowMoves} by at least 3x`);
});

test('pause freezes every currency, orders and settlement while allowing chart selection', () => {
  const g = game();
  g.open('long', 30000, 10);
  g.paused = true;
  const prices = g.prices();
  g.advance(160);
  assert.deepEqual(g.prices(), prices);
  assert.equal(g.tick, 0);
  assert.equal(g.close().ok, false);
  assert.equal(g.select('AUDJPY').ok, true);
  g.paused = false;
  assert.equal(g.close().ok, true);
});

test('invalid price updates and unknown currencies are rejected atomically', () => {
  const g = game();
  for (const update of [0, -1, NaN, Infinity, null, '150', { USDJPY: 151, GBPJPY: NaN }, { UNKNOWN: 10 }]) {
    const initial = g.prices();
    assert.equal(g.advance(update).ok, false);
    assert.deepEqual(g.prices(), initial);
    assert.equal(g.tick, 0);
  }
  assert.equal(g.select('UNKNOWN').ok, false);
  assert.equal(g.symbol, 'USDJPY');
});

test('reset restores 300000 JPY and clears all currency time, orders and records', () => {
  const g = game();
  g.select('AUDJPY'); g.open('long', 30000, 10); g.advance(); g.close();
  g.paused = true; g.reset();
  assert.equal(g.balance, 300000);
  assert.equal(g.symbol, 'USDJPY');
  assert.equal(g.tick, 0);
  assert.equal(g.paused, false);
  assert.equal(g.position, null);
  assert.equal(g.history.length, 0);
  for (const c of INSTRUMENTS) near(g.prices()[c.symbol], c.start);
});

test('all generated candle histories stay positive coherent and bounded in a long session', () => {
  const g = game();
  for (let i = 0; i < 6000; i++) g.advance();
  for (const config of INSTRUMENTS) {
    g.select(config.symbol);
    assert.ok(g.candles.length <= 180);
    for (const c of g.candles) {
      assert.ok(c.high >= Math.max(c.open, c.close));
      assert.ok(c.low <= Math.min(c.open, c.close));
      assert.ok(c.low > 0 && Number.isFinite(c.high));
    }
  }
});

test('malformed random sources cannot create nonfinite quotes', () => {
  for (const random of [() => NaN, () => Infinity, () => -5, () => 5]) {
    const g = new FXEngine({ random });
    for (let i = 0; i < 30; i++) g.advance();
    assert.ok(Object.values(g.prices()).every(p => Number.isFinite(p) && p > 0));
  }
});

test('trade retention is bounded and cumulative yen P/L remains correct', () => {
  const g = game();
  for (let i = 0; i < 220; i++) {
    assert.equal(g.open('long', 1000, 1).ok, true);
    g.close();
  }
  assert.equal(g.history.length, 200);
  assert.equal(g.totalTrades, 220);
  near(g.balance, 300000 - 220 * 20 / 150.01);
});
