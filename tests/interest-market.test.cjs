const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FXEngine, Market, INSTRUMENTS, seededRandom } = require('../engine.js');
const game = () => new FXEngine({ seed: 31415 });
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const minutes = (g, count) => { for (let i = 0; i < count; i++) g.advance(150); };
function arrears() {
  const g = game();
  g.borrow(1000000); g.open('long', 1000000, 100); g.advance(1);
  g.advance(150);
  return g;
}

test('a full simulated day charges 0.5 percent simple interest once without inflating principal', () => {
  const g = game(); g.borrow(1000000); minutes(g, 1440);
  near(g.balance, 1295000);
  near(g.account().principal, 1000000);
  near(g.account().interestCharged, 5000);
  near(g.account().interestDue, 0);
  near(g.account().netAssets, 295000);
  near(g.account().realizedPnl, -5000);
  minutes(g, 1440);
  near(g.account().interestCharged, 10000, 0.0001);
});

test('repaying principal halfway through a day immediately lowers future interest', () => {
  const g = game(); g.borrow(1000000); minutes(g, 720);
  g.repay(500000); minutes(g, 720);
  near(g.balance, 796250);
  near(g.account().interestCharged, 3750);
  near(g.account().dailyInterest, 2500);
});

test('new borrowing accrues only from the next simulated minute and is not backdated', () => {
  const g = game(); g.borrow(100000); minutes(g, 720);
  near(g.account().interestCharged, 250);
  g.borrow(400000); minutes(g, 720);
  near(g.account().interestCharged, 1500);
});

test('previews, paused time and rejected price updates cannot bill interest', () => {
  const g = game(); g.borrow(1000000);
  for (let i = 0; i < 20; i++) { g.previewLoan('borrow', 100); g.previewLoan('repay', 100); g.account(); }
  g.paused = true; minutes(g, 100); g.paused = false;
  g.advance({ USDJPY: NaN });
  near(g.balance, 1300000);
  near(g.account().interestCharged, 0);
  g.advance(150);
  near(g.account().interestCharged, 3.47);
});

test('unaffordable interest becomes arrears and reduces equity and net assets instead of being forgiven', () => {
  const g = arrears(), a = g.account();
  near(g.balance, 0);
  near(a.interestCharged, 6.94);
  near(a.interestDue, 3.47);
  near(a.debt, 1000003.47);
  near(a.equity, -3.47);
  near(a.netAssets, -1000003.47);
  near(a.realizedPnl, -1300003.47);
  assert.equal(g.ending, null);
});

test('repayment preview pays outstanding interest before principal and matches execution', () => {
  const g = arrears(); g.borrow(100);
  const before = g.account(), preview = g.previewLoan('repay', 100);
  assert.equal(preview.ok, true);
  near(preview.interestPayment, 3.47);
  near(preview.principalPayment, 96.53);
  near(preview.after.principal, 1000003.47);
  near(preview.after.interestDue, 0);
  near(g.account().interestDue, 3.47);
  assert.equal(g.repay(100).ok, true);
  near(g.balance, preview.after.balance);
  near(g.account().debt, preview.after.debt);
  near(g.account().netAssets, before.netAssets);
});

test('new cash pays old arrears and the new minute once without charging compound interest', () => {
  const g = arrears(); g.borrow(100); g.advance(150);
  near(g.balance, 93.06);
  near(g.account().interestDue, 0);
  near(g.account().interestCharged, 10.41);
  near(g.account().principal, 1000100);
});

test('repay-all can clear a fractional outstanding total created by interest-first repayment', () => {
  const g = arrears(); g.borrow(100); g.repay(100);
  g.borrow(2000000); g.open('long', 1000000, 100); g.advance(160); g.close();
  const amount = g.account().repayable;
  near(amount, 3000003.47);
  assert.equal(g.repay(amount).ok, true);
  near(g.account().debt, 0);
  near(g.account().interestDue, 0);
  assert.ok(g.unlocked.includes('debt-free'));
  const charged = g.account().interestCharged;
  minutes(g, 50);
  near(g.account().interestCharged, charged);
});

test('interest can cause liquidation at an unchanged quote by reducing available equity', () => {
  const g = game(); g.borrow(1000000); g.open('long', 1000000, 1);
  const p = g.position, mid = p.entry + 0.01 + (500005 - 1300000) / p.units;
  g.advance(mid);
  assert.ok(g.position);
  const result = g.advance(mid);
  assert.equal(result.trade.reason, 'liquidation');
  near(g.balance, 499998.06);
  near(g.account().interestCharged, 6.94);
});

test('sub-cent accrual survives repeated borrowing and repayment rather than resetting the clock', () => {
  const g = game();
  for (let i = 0; i < 2880; i++) { g.borrow(1); g.advance(150); g.repay(1); }
  near(g.account().interestCharged, 0.01);
  near(g.account().debt, 0);
  near(g.balance, 299999.99);
});

test('ended runs stop interest and reset clears all paid, pending and fractional accrual', () => {
  const g = game(); g.borrow(20000000); g.open('long', 19000000, 100); g.advance(1);
  const charged = g.account().interestCharged;
  assert.ok(charged > 0);
  minutes(g, 100);
  near(g.account().interestCharged, charged);
  g.reset(); minutes(g, 10);
  near(g.balance, 300000);
  near(g.account().interestDue, 0);
  near(g.account().interestCharged, 0);
});

test('fractional principal cannot strand an exhausted account with less than one yen of borrowing headroom', () => {
  const g = arrears(); g.borrow(100); g.repay(100);
  g.borrow(18999996);
  near(g.account().principal, 19999999.47);
  assert.equal(g.borrow(1).ok, false);
  g.open('long', 18000000, 100); g.advance(1);
  assert.ok(g.ending);
  assert.equal(g.balance, 0);
});

test('interest and active trading never alter any of the five seeded market paths', () => {
  const a = game(), b = game(); a.borrow(1000000);
  for (let i = 0; i < 1200; i++) {
    if (!a.position) a.open(i % 2 ? 'long' : 'short', 10000, 25);
    if (i % 8 === 0 && a.position) a.reduce(50);
    if (i % 13 === 0 && a.position) a.close();
    a.advance(); b.advance();
    assert.deepEqual(a.prices(), b.prices());
  }
  assert.ok(a.account().interestCharged > 0);
});

test('market environments change frequently and trend phases end within 24 minutes', () => {
  const m = new Market(INSTRUMENTS[0], seededRandom(73)), seen = new Set();
  let phase = null, run = 0, changes = 0;
  for (let i = 0; i < 4000; i++) {
    m.advance();
    assert.ok(m.regime && m.regime.id, 'market must expose its active environment');
    const key = m.regimeUntil;
    if (key !== phase) { phase = key; run = 0; changes++; }
    run++; seen.add(m.regime.id);
    assert.ok(run <= 40, `environment persisted for ${run} minutes`);
    if (m.regime.id === 'trend') assert.ok(run <= 24);
  }
  assert.deepEqual([...seen].sort(), ['chop', 'range', 'stress', 'trend']);
  assert.ok(changes > 100);
});

test('volatility clusters include both quiet and turbulent periods rather than a uniform noise increase', () => {
  const m = new Market(INSTRUMENTS[0], seededRandom(101));
  const sum = { range: 0, stress: 0 }, count = { range: 0, stress: 0 };
  for (let i = 0; i < 10000; i++) {
    const previous = m.price; m.advance();
    assert.ok(m.regime && m.regime.id);
    const id = m.regime.id;
    if (id in sum) { sum[id] += Math.abs(m.price / previous - 1); count[id]++; }
  }
  assert.ok(count.range > 500 && count.stress > 500);
  assert.ok(sum.stress / count.stress > 2 * sum.range / count.range);
});
