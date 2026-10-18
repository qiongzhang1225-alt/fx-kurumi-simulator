(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const START_BALANCE = 300000;
  const DEBT_LIMIT = 20000000;
  const DAILY_INTEREST_RATE = 0.005;
  const MINUTES_PER_DAY = 1440;
  const ACHIEVEMENTS = Object.freeze([
    { id: 'first-profit', title: '第一次吃到肉', description: '完成第一次盈利结算，减仓也算。', meme: 'assets/kurumi-laugh.jpg', silhouette: 'assets/main_kurumi.png' },
    { id: 'first-loan', title: '萌智子，借我点钱', description: '第一次向小金萌智子借款。', meme: 'assets/main_mochiko.png', silhouette: 'assets/main_mochiko.png', caption: '额度给你，账也给你记着。' },
    { id: 'first-liquidation', title: '强制ロスカット', description: '第一次触发强制平仓。', meme: 'assets/kurumi-grit.jpg', silhouette: 'assets/main_kurumi.png' },
    { id: 'debt-free', title: '无债一身轻', description: '还清全部借款。', meme: 'assets/face_mebuki.png', silhouette: 'assets/main_mebuki.png', caption: '无债一身轻，先笑一个。' },
    { id: 'million', title: '百万日元战士', description: '扣除欠款后的净资产达到 100 万日元。', meme: 'assets/face_yasuko.png', silhouette: 'assets/main_yasuko.png', caption: '一百万，先截个图。', target: 1000000 },
    { id: 'twenty-million', title: '2000万，拿回来了！', description: '扣除欠款后的净资产达到 2000 万日元。', meme: 'assets/kurumi-goal.jpg', silhouette: 'assets/main_kurumi.png', target: 20000000 },
  ].map(Object.freeze));
  const LEVERAGES = Object.freeze([1, 10, 25, 50, 100]);
  const MIN_PRICE = 1, MAX_PRICE = 1000000;
  // These are game profiles, not claims about current or historical market risk.
  const INSTRUMENTS = Object.freeze([
    { symbol: 'USDJPY', name: '美元 / 日元', base: 'USD', start: 150, spread: 0.020, style: '均衡', level: 3, volatility: 0.00030, drift: 0.00008, shockChance: 0.004, shockSize: 0.0045, description: '波动与趋势适中，适合熟悉交易。' },
    { symbol: 'EURJPY', name: '欧元 / 日元', base: 'EUR', start: 163, spread: 0.030, style: '稳健', level: 2, volatility: 0.00018, drift: 0.000055, shockChance: 0.002, shockSize: 0.0025, description: '波动较小，趋势推进较缓。' },
    { symbol: 'AUDJPY', name: '澳元 / 日元', base: 'AUD', start: 98, spread: 0.025, style: '活跃', level: 4, volatility: 0.00050, drift: 0.00012, shockChance: 0.006, shockSize: 0.007, description: '波动较大，偶尔出现快速反转。' },
    { symbol: 'GBPJPY', name: '英镑 / 日元', base: 'GBP', start: 190, spread: 0.045, style: '激进', level: 5, volatility: 0.00085, drift: 0.00020, shockChance: 0.012, shockSize: 0.014, description: '大幅波动与跳变更多，盈亏变化快。' },
    { symbol: 'CHFJPY', name: '瑞郎 / 日元', base: 'CHF', start: 170, spread: 0.025, style: '保守', level: 1, volatility: 0.00010, drift: 0.000035, shockChance: 0.001, shockSize: 0.0015, description: '小幅震荡为主，跳变较少。' },
  ].map(Object.freeze));
  const CONFIGS = Object.fromEntries(INSTRUMENTS.map(c => [c.symbol, c]));
  const MARKET_REGIMES = Object.freeze([
    { id: 'range', min: 16, span: 25, volatility: 0.6, shocks: 0.5 },
    { id: 'chop', min: 10, span: 19, volatility: 1.05, shocks: 0.8 },
    { id: 'trend', min: 8, span: 17, volatility: 1, shocks: 1 },
    { id: 'stress', min: 5, span: 11, volatility: 2.2, shocks: 2 },
  ].map(Object.freeze));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const safeSample = random => {
    const n = random();
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
  };
  const validPrice = n => typeof n === 'number' && Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE;

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function symbolSeed(seed, symbol) {
    let hash = seed >>> 0;
    for (const character of symbol) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    return hash;
  }

  class Market {
    constructor(config = INSTRUMENTS[0], random = Math.random) {
      this.config = config;
      this.random = random;
      this.price = config.start;
      this.tick = -360;
      this.drift = 0;
      this.regimeUntil = -360;
      this.regime = null;
      this.anchor = this.price;
      this.lastReturn = 0;
      this.candles = [{ time: -360, open: this.price, high: this.price, low: this.price, close: this.price }];
      for (let i = 0; i < 360; i++) this.advance();
      const scale = config.start / this.price;
      this.candles.forEach(c => {
        for (const key of ['open', 'high', 'low', 'close']) c[key] *= scale;
      });
      this.price = config.start;
      this.anchor *= scale;
      const last = this.candles.at(-1);
      last.close = this.price;
      last.high = Math.max(last.high, this.price);
      last.low = Math.min(last.low, this.price);
    }

    sample() { return safeSample(this.random); }

    nextPrice() {
      const c = this.config;
      if (this.tick >= this.regimeUntil) {
        const pick = this.sample();
        let index = pick < 0.25 ? 0 : pick < 0.60 ? 1 : pick < 0.85 ? 2 : 3;
        if (MARKET_REGIMES[index] === this.regime) index = (index + 1 + Math.min(2, Math.floor(this.sample() * 3))) % 4;
        this.regime = MARKET_REGIMES[index];
        this.anchor = this.price;
        this.drift = this.regime.id === 'trend' ? (this.sample() * 2 - 1) * c.drift * 0.7 : 0;
        this.regimeUntil = this.tick + this.regime.min + Math.min(this.regime.span - 1, Math.floor(this.sample() * this.regime.span));
      }
      let noise = -3;
      for (let i = 0; i < 6; i++) noise += this.sample();
      const response = this.regime.id === 'range' ? Math.log(this.anchor / this.price) * 0.04
        : this.regime.id === 'chop' ? -this.lastReturn * 0.25 : 0;
      const shock = this.sample() < c.shockChance * this.regime.shocks
        ? (this.sample() * 2 - 1) * c.shockSize : 0;
      const change = this.drift + clamp(response, -c.volatility, c.volatility)
        + noise * c.volatility * this.regime.volatility + shock;
      return clamp(this.price * (1 + change), MIN_PRICE, MAX_PRICE);
    }

    advance(price = this.nextPrice()) {
      const previous = this.price;
      this.price = price;
      this.lastReturn = price / previous - 1;
      this.tick++;
      if (this.tick % 5 === 0) {
        this.candles.push({ time: this.tick, open: previous, high: Math.max(previous, price), low: Math.min(previous, price), close: price });
        if (this.candles.length > 180) this.candles.shift();
      } else {
        const candle = this.candles.at(-1);
        candle.close = price;
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
      }
      return price;
    }
  }

  class FXEngine {
    constructor({ random = Math.random, seed } = {}) {
      this.random = random;
      this.fixedSeed = Number.isFinite(seed) ? seed >>> 0 : null;
      this.reset();
    }

    reset() {
      this.seed = this.fixedSeed === null ? Math.floor(safeSample(this.random) * 4294967295) >>> 0 : this.fixedSeed;
      this.markets = Object.create(null);
      for (const config of INSTRUMENTS) this.markets[config.symbol] = new Market(config, seededRandom(symbolSeed(this.seed, config.symbol)));
      this.symbol = 'USDJPY';
      this.balance = START_BALANCE;
      this.position = null;
      this.history = [];
      this.totalTrades = 0;
      this.wins = 0;
      this.paused = false;
      this.debt = 0;
      this.interestDue = 0;
      this.interestCharged = 0;
      this.interestRemainder = 0;
      this.unlocked = [];
      this.events = [];
      this.ending = null;
    }

    get market() { return this.markets[this.symbol]; }
    get config() { return this.market.config; }
    get price() { return this.market.price; }
    get tick() { return this.markets.USDJPY.tick; }
    get candles() { return this.market.candles; }
    prices() { return Object.fromEntries(INSTRUMENTS.map(c => [c.symbol, this.markets[c.symbol].price])); }

    select(symbol) {
      if (!Object.hasOwn(this.markets, symbol)) return { ok: false, message: '请选择有效的货币对。' };
      this.symbol = symbol;
      return { ok: true };
    }

    quote(symbol = this.symbol) {
      const market = this.markets[symbol];
      if (!market) return null;
      const spread = market.config.spread;
      return { bid: market.price - spread / 2, ask: market.price + spread / 2, spread };
    }

    account() {
      const p = this.position;
      const quote = p ? this.quote(p.symbol) : null;
      const exit = p ? (p.side === 'long' ? quote.bid : quote.ask) : 0;
      const pnl = p ? p.direction * p.units * (exit - p.entry) : 0;
      const usedMargin = p ? p.margin : 0;
      const equity = this.balance + pnl - this.interestDue;
      const debt = this.debt + this.interestDue;
      const capacity = Math.max(0, Math.min(this.balance, Math.max(0, equity - usedMargin) + this.interestDue));
      return { currency: 'JPY', balance: this.balance, equity, pnl, usedMargin,
        freeMargin: equity - usedMargin, marginLevel: p ? equity / usedMargin * 100 : null,
        debt, principal: this.debt, interestDue: this.interestDue, interestCharged: this.interestCharged,
        dailyInterest: this.debt * DAILY_INTEREST_RATE, netAssets: equity - this.debt,
        realizedPnl: this.balance - debt - START_BALANCE,
        repayable: capacity + 1e-8 >= debt ? debt : Math.floor(capacity) };
    }

    unlock(id, settlement) {
      if (this.unlocked.includes(id)) return;
      this.unlocked.push(id);
      this.events.push(settlement ? { type: 'achievement', id, settlement } : { type: 'achievement', id });
    }

    checkStory() {
      if (this.ending) return;
      const account = this.account();
      for (const achievement of ACHIEVEMENTS) {
        if (achievement.target && account.netAssets >= achievement.target - 1e-6) this.unlock(achievement.id);
      }
      // Below one yen no new trade is possible; count this dust as exhausted capital.
      if (DEBT_LIMIT - this.debt < 1 && !this.position && this.balance < 1) {
        this.ending = { id: 'debt-ending', debt: account.debt, balance: this.balance,
          netAssets: account.netAssets, pnl: account.realizedPnl, trades: this.totalTrades, tick: this.tick };
        this.events.push({ type: 'ending', id: this.ending.id });
      }
    }

    takeEvents() { return this.events.splice(0); }

    previewLoan(action, amount) {
      if (this.ending) return { ok: false, message: '本局已结束，请重新开始。' };
      const account = this.account(), p = this.position;
      const fullRepayment = action === 'repay' && Number.isFinite(amount) && amount > 0 && Math.abs(amount - account.debt) < 1e-8;
      if ((!Number.isSafeInteger(amount) || amount < 1) && !fullRepayment) return { ok: false, message: '请输入至少 1 日元的整数金额；尾数可用「还清可还金额」结清。' };
      if (action === 'borrow') {
        if (amount > DEBT_LIMIT - this.debt) return { ok: false, message: '未还本金最多 2000 万日元，请减少借款金额。' };
      } else if (action === 'repay') {
        if (amount > account.repayable + 1e-8) return { ok: false, message: '还款不能超过欠款与可用资金，也不能动用持仓保证金。' };
      } else return { ok: false, message: '请选择借款或还款。' };
      if (fullRepayment) amount = account.debt;
      const delta = action === 'borrow' ? amount : -amount;
      const interestPayment = action === 'repay' ? Math.min(amount, this.interestDue) : 0;
      const principalPayment = action === 'repay' ? amount - interestPayment : 0;
      const principal = fullRepayment ? 0 : action === 'borrow' ? this.debt + amount : Math.max(0, this.debt - principalPayment);
      const interestDue = fullRepayment ? 0 : Math.max(0, this.interestDue - interestPayment);
      const before = { balance: this.balance, debt: account.debt, principal: this.debt, interestDue: this.interestDue, netAssets: account.netAssets,
        units: p ? p.units : 0, entry: p ? p.entry : null, liquidationPrice: this.liquidationPrice() };
      const after = { ...before, balance: Math.max(0, this.balance + delta), debt: principal + interestDue, principal, interestDue,
        liquidationPrice: this.liquidationPrice(p, this.balance + delta, interestDue) };
      return { ok: true, before, after, interestPayment, principalPayment };
    }

    borrow(amount) {
      const result = this.previewLoan('borrow', amount);
      if (!result.ok) return result;
      this.balance += amount;
      this.debt += amount;
      this.unlock('first-loan');
      this.checkStory();
      return { ok: true };
    }

    repay(amount) {
      const result = this.previewLoan('repay', amount);
      if (!result.ok) return result;
      this.balance = result.after.balance;
      this.debt = result.after.principal;
      this.interestDue = result.after.interestDue;
      if (this.debt === 0 && this.interestDue === 0) this.unlock('debt-free');
      this.checkStory();
      return { ok: true };
    }

    accrueInterest() {
      this.interestRemainder += this.debt * DAILY_INTEREST_RATE / MINUTES_PER_DAY;
      const charge = Math.floor((this.interestRemainder + 1e-9) * 100) / 100;
      this.interestRemainder = Math.max(0, this.interestRemainder - charge);
      this.interestCharged = Math.round((this.interestCharged + charge) * 100) / 100;
      const owed = this.interestDue + charge, paid = Math.min(this.balance, owed);
      this.balance = Math.max(0, this.balance - paid);
      this.interestDue = Math.max(0, owed - paid);
    }

    preview(side, margin, leverage) {
      if (this.ending) return { ok: false, message: '本局已结束，请重新开始。' };
      if (this.paused) return { ok: false, message: '行情已暂停，请先继续行情。' };
      if (this.position) return { ok: false, message: '已有持仓，可在持仓处同向加仓；新币种或反向交易请先平仓。' };
      if (!['long', 'short'].includes(side)) return { ok: false, message: '请选择买涨或买跌。' };
      if (!Number.isInteger(margin) || margin < 1) return { ok: false, message: '请输入至少 1 日元的整数保证金。' };
      if (!LEVERAGES.includes(leverage)) return { ok: false, message: '请选择有效的杠杆倍数。' };
      const quote = this.quote();
      const entry = side === 'long' ? quote.ask : quote.bid;
      const notional = margin * leverage;
      const units = notional / entry;
      const spreadCost = units * quote.spread;
      if (!Number.isFinite(notional) || margin + spreadCost > this.account().freeMargin + 1e-8) {
        return { ok: false, message: '可用资金不足，请减少金额并预留价差成本。' };
      }
      return { ok: true, entry, units, notional, spreadCost };
    }

    open(side, margin, leverage) {
      const preview = this.preview(side, margin, leverage);
      if (!preview.ok) return preview;
      this.position = { symbol: this.symbol, side, direction: side === 'long' ? 1 : -1,
        entry: preview.entry, units: preview.units, notional: preview.notional,
        margin, leverage, openedAt: this.tick, additions: 0, reductions: 0 };
      return { ok: true };
    }

    previewAdd(margin) {
      if (this.ending) return { ok: false, message: '本局已结束，请重新开始。' };
      if (this.paused) return { ok: false, message: '行情已暂停，请先继续行情。' };
      const p = this.position;
      if (!p) return { ok: false, message: '当前没有持仓，无法加仓。' };
      if (!Number.isSafeInteger(margin) || margin < 1) return { ok: false, message: '请输入至少 1 日元的整数追加保证金。' };
      const account = this.account(), quote = this.quote(p.symbol);
      const entry = p.side === 'long' ? quote.ask : quote.bid;
      const notional = margin * p.leverage, units = notional / entry;
      const spreadCost = units * quote.spread;
      if (!Number.isFinite(notional) || margin + spreadCost > account.freeMargin + 1e-8) {
        return { ok: false, message: '可用保证金不足，请减少加仓金额并预留新增价差，或先补充资金。' };
      }
      const position = { ...p, units: p.units + units, margin: p.margin + margin,
        notional: p.notional + notional, entry: (p.entry * p.units + entry * units) / (p.units + units),
        additions: p.additions + 1 };
      const exit = p.side === 'long' ? quote.bid : quote.ask;
      const pnl = p.direction * position.units * (exit - position.entry);
      const equity = this.balance + pnl - this.interestDue;
      const before = { entry: p.entry, units: p.units, margin: p.margin, notional: p.notional,
        pnl: account.pnl, equity: account.equity, freeMargin: account.freeMargin,
        marginLevel: account.marginLevel, liquidationPrice: this.liquidationPrice() };
      const after = { entry: position.entry, units: position.units, margin: position.margin, notional: position.notional,
        pnl, equity, freeMargin: equity - position.margin, marginLevel: equity / position.margin * 100,
        liquidationPrice: this.liquidationPrice(position) };
      return { ok: true, symbol: p.symbol, side: p.side, leverage: p.leverage,
        entry, units, margin, notional, spreadCost, position, before, after };
    }

    add(margin) {
      const preview = this.previewAdd(margin);
      if (!preview.ok) return preview;
      this.position = preview.position;
      this.checkStory();
      return { ok: true, margin, units: preview.units, entry: preview.entry };
    }

    previewReduce(percent) {
      if (this.ending) return { ok: false, message: '本局已结束，请重新开始。' };
      if (this.paused) return { ok: false, message: '行情已暂停，请先继续行情。' };
      if (!this.position) return { ok: false, message: '当前没有持仓。' };
      if (!Number.isFinite(percent) || percent < 0.1 || percent > 100 || Math.abs(percent * 10 - Math.round(percent * 10)) > 1e-7) {
        return { ok: false, message: '请输入 0.1% 至 100% 的减仓比例，最多一位小数。' };
      }
      percent = Math.round(percent * 10) / 10;
      const p = this.position, account = this.account();
      if (percent < 100 && account.marginLevel <= 50 + 1e-8) {
        return { ok: false, message: '持仓已达到强平线，不能继续部分减仓，请全部平仓。' };
      }
      const quote = this.quote(p.symbol);
      const exit = p.side === 'long' ? quote.bid : quote.ask;
      const fraction = percent / 100, all = percent === 100;
      const closedUnits = all ? p.units : p.units * fraction;
      const releasedMargin = all ? p.margin : p.margin * fraction;
      const closedNotional = all ? p.notional : p.notional * fraction;
      const rawPnl = p.direction * closedUnits * (exit - p.entry);
      const balance = all ? Math.max(0, this.balance + rawPnl) : this.balance + rawPnl;
      const position = all ? null : { ...p, units: p.units - closedUnits, margin: p.margin - releasedMargin,
        notional: p.notional - closedNotional, reductions: p.reductions + 1 };
      if (position && (position.units <= 0 || position.margin <= 0 || position.notional <= 0)) {
        return { ok: false, message: '剩余仓位过小，请选择全部平仓。' };
      }
      const pnl = position ? position.direction * position.units * (exit - position.entry) : 0;
      const equity = balance + pnl - this.interestDue, usedMargin = position ? position.margin : 0;
      const before = { balance: account.balance, equity: account.equity, pnl: account.pnl,
        entry: p.entry, units: p.units, margin: p.margin, notional: p.notional,
        freeMargin: account.freeMargin, marginLevel: account.marginLevel, liquidationPrice: this.liquidationPrice() };
      const after = { balance, equity, pnl, entry: position ? position.entry : null,
        units: position ? position.units : 0, margin: usedMargin, notional: position ? position.notional : 0,
        freeMargin: equity - usedMargin, marginLevel: position ? equity / usedMargin * 100 : null,
        liquidationPrice: this.liquidationPrice(position, balance) };
      return { ok: true, symbol: p.symbol, side: p.side, leverage: p.leverage, percent, exit,
        closedUnits, releasedMargin, closedNotional, realizedPnl: balance - this.balance, position, before, after };
    }

    reduce(percent) {
      const preview = this.previewReduce(percent);
      if (!preview.ok) return preview;
      return preview.percent === 100 ? this.close() : this.commitReduction(preview, 'partial');
    }

    close(reason = 'manual') {
      const preview = this.previewReduce(100);
      return preview.ok ? this.commitReduction(preview, reason) : preview;
    }

    commitReduction(preview, reason) {
      const p = this.position;
      const trade = { id: ++this.totalTrades, symbol: p.symbol, currency: 'JPY', side: p.side,
        margin: preview.releasedMargin, leverage: p.leverage, units: preview.closedUnits, notional: preview.closedNotional,
        entry: p.entry, exit: preview.exit, pnl: preview.realizedPnl, closedPercent: preview.percent,
        reason, openedAt: p.openedAt, closedAt: this.tick, additions: p.additions,
        reductions: preview.position ? preview.position.reductions : p.reductions,
        remainingUnits: preview.after.units, remainingMargin: preview.after.margin };
      this.balance = preview.after.balance;
      this.position = preview.position;
      if (trade.pnl > 0) this.wins++;
      this.history.unshift(trade);
      if (this.history.length > 200) this.history.pop();
      if (trade.pnl > 0) {
        const settlement = Object.freeze({ ...trade });
        if (this.unlocked.includes('first-profit')) this.events.push({ type: 'profit', settlement });
        else this.unlock('first-profit', settlement);
      }
      if (reason === 'liquidation') this.unlock('first-liquidation');
      this.checkStory();
      return { ok: true, trade };
    }

    liquidationPrice(p = this.position, balance = this.balance, interestDue = this.interestDue) {
      if (!p) return null;
      const halfSpread = this.quote(p.symbol).spread / 2;
      const price = p.entry + p.direction * halfSpread - p.direction * (balance - interestDue - p.margin / 2) / p.units;
      return validPrice(price) ? price : null;
    }

    advance(updates) {
      if (this.ending) return { ok: false, message: '本局已结束。' };
      if (this.paused) return { ok: false, message: '行情已暂停。' };
      let overrides = {};
      if (updates !== undefined) {
        if (typeof updates === 'number') overrides = { [this.symbol]: updates };
        else if (updates && typeof updates === 'object' && !Array.isArray(updates)) overrides = updates;
        else return { ok: false, message: '报价无效。' };
        for (const [symbol, price] of Object.entries(overrides)) {
          if (!Object.hasOwn(this.markets, symbol) || !validPrice(price)) return { ok: false, message: '报价无效。' };
        }
      }
      // Every market advances once, regardless of selection, orders, profit or liquidation.
      for (const config of INSTRUMENTS) this.markets[config.symbol].advance(Object.hasOwn(overrides, config.symbol) ? overrides[config.symbol] : undefined);
      this.accrueInterest();
      if (this.position && this.account().marginLevel <= 50 + 1e-8) return this.close('liquidation');
      this.checkStory();
      return { ok: true };
    }
  }

  return { FXEngine, Market, INSTRUMENTS, START_BALANCE, DEBT_LIMIT, DAILY_INTEREST_RATE, ACHIEVEMENTS, LEVERAGES, seededRandom };
});
