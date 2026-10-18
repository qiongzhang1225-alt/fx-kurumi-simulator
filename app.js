(function () {
  'use strict';

  const game = new FX.FXEngine();
  const chart = new CandleChart(document.getElementById('market-chart'));
  const $ = id => document.getElementById(id);
  const marketResting = () => document.hidden || Boolean(document.querySelector('dialog[data-freeze-market][open]'));
  const yenFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const yen = n => yenFormat.format(n);
  const signed = n => Math.abs(n) < 0.005 ? '¥0' : `${n > 0 ? '+' : '−'}${yen(Math.abs(n))}`;
  const price = n => n.toFixed(3);
  const text = (id, value) => { $(id).textContent = value; };
  const tone = (element, n) => {
    element.classList.toggle('positive', n > 0.005);
    element.classList.toggle('negative', n < -0.005);
  };
  let speed = 1;
  let timer;
  let lastHistoryCount = -1;
  let lastPauseState = '';
  let currentView = 'position';
  const watchRows = new Map();
  const storyUI = new StoryUI({ game, money: yen, signed, onChange: () => render(),
    onRestart: () => resetGame(), onHistory: () => {
      $('terminal-window').classList.remove('terminal-hidden');
      $('terminal-toggle').setAttribute('aria-pressed', 'true');
      showView('history'); render();
    } });

  for (const config of FX.INSTRUMENTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'watch-item';
    button.setAttribute('aria-label', `查看 ${config.symbol} ${config.style}行情`);
    const symbol = document.createElement('strong');
    symbol.className = 'watch-symbol'; symbol.textContent = config.symbol.replace('JPY', '/JPY');
    const style = document.createElement('span');
    style.className = `watch-style level-${config.level}`; style.textContent = config.style;
    const value = document.createElement('span'); value.className = 'watch-price';
    const change = document.createElement('span'); change.className = 'watch-change';
    button.append(symbol, style, value, change);
    button.addEventListener('click', () => selectCurrency(config.symbol));
    $('watch-list').append(button);
    watchRows.set(config.symbol, { button, value, change });
    const option = document.createElement('option');
    option.value = config.symbol;
    option.textContent = `${config.symbol} · ${config.style}`;
    $('order-currency-select').append(option);
  }

  function selectCurrency(symbol) {
    const result = game.select(symbol);
    if (!result.ok) { toast('无法切换货币', result.message, 'notice'); return; }
    render();
  }

  function renderMarkets() {
    const values = game.prices();
    for (const config of FX.INSTRUMENTS) {
      const row = watchRows.get(config.symbol);
      const change = (values[config.symbol] / config.start - 1) * 100;
      row.value.textContent = price(values[config.symbol]);
      row.change.textContent = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`;
      tone(row.change, change);
      row.button.setAttribute('aria-pressed', game.symbol === config.symbol);
    }
    const c = game.config;
    text('window-instrument', `— ${c.symbol}, M5`);
    text('instrument-title', `${c.symbol}, M5`);
    text('instrument-name', c.name);
    text('chart-tab-symbol', `${c.symbol}, M5`);
    text('chart-info', `每步 1 分钟 · 模拟价差 ${price(c.spread)}`);
    text('market-style', c.style);
    $('market-style').className = `level-${c.level}`;
    text('market-style-description', c.description);
    text('order-symbol-short', `Order · ${c.symbol}`);
    text('order-style', `${c.style} · 即时成交`);
    $('order-currency-select').value = game.symbol;
  }

  function toast(title, message = '', kind = '') {
    const region = $('toast-region');
    if (region.children.length >= 3) region.firstElementChild.remove();
    const box = document.createElement('div');
    box.className = `toast ${kind}`;
    const heading = document.createElement('strong');
    heading.textContent = title;
    box.append(heading);
    if (message) { const p = document.createElement('p'); p.textContent = message; box.append(p); }
    region.append(box);
    setTimeout(() => box.remove(), kind === 'error' ? 9500 : 5000);
  }

  function simTime(tick) {
    const minutes = 540 + tick;
    const day = Math.floor(minutes / 1440) + 1;
    return `DAY ${String(day).padStart(2, '0')} · ${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function orderState() {
    const raw = $('margin-input').value.trim();
    const margin = raw ? Number(raw) : NaN;
    const leverage = Number($('leverage-select').value);
    const valid = Number.isInteger(margin) && margin >= 1;
    const quote = game.quote();
    const cost = valid ? margin * leverage / quote.bid * quote.spread : NaN;
    const long = game.preview('long', margin, leverage);
    const short = game.preview('short', margin, leverage);
    const error = game.ending ? '本局已结束，可查看记录或重新开局。'
      : game.balance < 1 ? '可用本金不足 1 日元，可向萌智子借款或重新开始。'
      : !long.ok && !short.ok ? long.message : '';
    return { margin, leverage, valid, cost, error, long, short };
  }

  function renderOrder() {
    const state = orderState();
    const validAmount = state.valid && Number.isFinite(state.margin * state.leverage);
    text('notional-value', validAmount ? yen(state.margin * state.leverage) : '—');
    text('base-units', validAmount ? `${(state.margin * state.leverage / game.quote().ask).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${game.config.base}` : '—');
    text('spread-cost', Number.isFinite(state.cost) ? `≈ ${yen(state.cost)}` : '—');
    text('leverage-label', `${state.leverage}×`);
    text('order-error', state.error);
    const quote = game.quote();
    text('order-quote', `${price(quote.ask)} / ${price(quote.bid)}`);
    text('bid-price', price(quote.bid));
    text('ask-price', price(quote.ask));
    $('buy-button').disabled = !state.long.ok;
    $('sell-button').disabled = !state.short.ok;
    $('close-button').disabled = game.paused || Boolean(game.ending);
    $('add-position-button').disabled = !game.position || game.paused || Boolean(game.ending);
    $('reduce-position-button').disabled = !game.position || game.paused || Boolean(game.ending);
    $('fund-position-button').disabled = !game.position || Boolean(game.ending);
    const locked = Boolean(game.position);
    $('margin-input').disabled = locked;
    $('leverage-select').disabled = locked;
    document.querySelectorAll('[data-allocation], [data-leverage]').forEach(button => {
      button.disabled = locked;
      if (button.dataset.leverage) {
        const selected = Number(button.dataset.leverage) === state.leverage;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', selected);
      }
    });
    const highRisk = state.leverage >= 50;
    $('risk-note').classList.toggle('high-risk', highRisk);
    $('risk-note').querySelector('p').textContent = highRisk
      ? `${state.leverage}× 杠杆：约 ${(100 / state.leverage).toFixed(0)}% 的逆向波动就会亏掉相当于本笔保证金的金额，余额也会承担亏损。`
      : '杠杆会同时放大收益和亏损。先试着小仓位入场。';
  }

  function renderPosition(account) {
    const p = game.position;
    text('position-count', p ? '1' : '0');
    $('position-empty').hidden = Boolean(p);
    $('active-position').hidden = !p;
    if (!p) return;
    const side = $('position-side');
    side.textContent = `${p.symbol} ${p.side === 'long' ? '↗ 买涨' : '↘ 买跌'} · ${p.leverage}×${p.additions ? ` · 加仓${p.additions}次` : ''}${p.reductions ? ` · 减仓${p.reductions}次` : ''}`;
    side.className = `position-side-tag ${p.side === 'short' ? 'short' : ''}`;
    const quote = game.quote(p.symbol);
    text('position-prices', `${price(p.entry)} / ${price(p.side === 'long' ? quote.bid : quote.ask)}`);
    text('position-size', `${yen(p.margin)} / ${yen(p.notional)}`);
    text('position-pnl', signed(account.pnl)); tone($('position-pnl'), account.pnl);
    text('margin-level', `${account.marginLevel.toFixed(1)}%`);
    const liq = game.liquidationPrice();
    text('liquidation-price', liq ? `${p.symbol} 预计强平价 ${price(liq)}` : '当前仓位无可达强平价');
    const fill = $('margin-bar-fill');
    fill.style.width = `${Math.max(0, Math.min(100, (account.marginLevel - 50) / 1.5))}%`;
    fill.style.background = account.marginLevel < 80 ? 'var(--red)' : account.marginLevel < 130 ? 'var(--amber)' : 'var(--mint)';
    text('margin-health', account.marginLevel < 80 ? '接近强平，请注意仓位' : account.marginLevel < 130 ? '保证金承压' : '保证金充足');
  }

  function renderAdd() {
    const p = game.position;
    if (!p) {
      $('add-confirm').disabled = true;
      if ($('add-dialog').open) $('add-dialog').close();
      return;
    }
    const raw = $('add-margin').value.trim();
    const preview = game.previewAdd(raw ? Number(raw) : NaN);
    const account = game.account(), quote = game.quote(p.symbol);
    const base = FX.INSTRUMENTS.find(config => config.symbol === p.symbol).base;
    const units = n => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${base}`;
    const liq = n => n === null ? '无可达强平价' : price(n);
    text('add-instrument', `${p.symbol} · ${p.side === 'long' ? '买涨' : '买跌'} · ${p.leverage}×`);
    text('add-context', `仅增加 ${p.symbol} 原方向持仓，沿用 ${p.leverage}× 杠杆，成交后合并为一笔仓位。`);
    text('add-fill-price', price(p.side === 'long' ? quote.ask : quote.bid));
    text('add-spread', preview.ok ? yen(preview.spreadCost) : '—');
    const before = { entry: p.entry, units: p.units, margin: p.margin, notional: p.notional,
      liquidation: game.liquidationPrice(), level: account.marginLevel };
    const after = preview.ok ? { ...preview.after, liquidation: preview.after.liquidationPrice, level: preview.after.marginLevel } : null;
    const formats = { entry: price, units, margin: yen, notional: yen, liquidation: liq, level: n => `${n.toFixed(1)}%` };
    for (const [name, format] of Object.entries(formats)) {
      text(`add-before-${name}`, format(before[name]));
      text(`add-after-${name}`, after ? format(after[name]) : '—');
    }
    $('add-confirm').disabled = !preview.ok;
    text('add-error', preview.ok ? '' : preview.message);
    const risk = $('add-risk'); risk.classList.remove('negative', 'positive');
    if (!preview.ok) { risk.textContent = ''; return; }
    const oldLine = before.liquidation, newLine = after.liquidation;
    const distanceChange = oldLine === null ? (newLine === null ? 0 : -Infinity)
      : newLine === null ? Infinity : p.direction * (oldLine - newLine);
    risk.textContent = distanceChange < -1e-9 ? '预计强平线更接近现价，承受反向波动的空间缩小。'
      : distanceChange > 1e-9 ? '预计强平线远离现价；加仓后每单位波动的盈亏仍会放大。'
      : '预计强平价基本不变；加仓后每单位波动的盈亏会放大。';
    risk.classList.add(distanceChange < -1e-9 ? 'negative' : 'positive');
  }

  function showAdd() {
    if (!game.position || game.ending || game.paused) return;
    renderAdd(); $('add-dialog').showModal();
  }

  function confirmAdd() {
    const result = game.add(Number($('add-margin').value));
    if (!result.ok) { renderAdd(); return; }
    const p = game.position;
    $('add-dialog').close(); render();
    toast(`${p.symbol} 已同向加仓`, `追加 ${yen(result.margin)} 保证金，合并均价 ${price(p.entry)}。`);
  }

  function renderReduce() {
    const p = game.position;
    if (!p) {
      $('reduce-confirm').disabled = true;
      if ($('reduce-dialog').open) $('reduce-dialog').close();
      return;
    }
    const raw = $('reduce-percent').value.trim();
    const percent = raw ? Number(raw) : NaN;
    const preview = game.previewReduce(percent), account = game.account();
    const base = FX.INSTRUMENTS.find(config => config.symbol === p.symbol).base;
    const units = n => `${n > 0 && n < 0.000001 ? '<0.000001' : n.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${base}`;
    text('reduce-instrument', `${p.symbol} · ${p.side === 'long' ? '买涨' : '买跌'} · ${p.leverage}×`);
    text('reduce-context', '比例按当前剩余仓位计算；只平掉选定部分，不改变剩余均价与杠杆。');
    text('reduce-fill-price', price(p.side === 'long' ? game.quote(p.symbol).bid : game.quote(p.symbol).ask));
    text('reduce-quantity', preview.ok ? `本次平掉 ${units(preview.closedUnits)}（当前仓位的 ${preview.percent}%）` : '选择有效比例后显示本次结算数量。');
    text('reduce-realized', preview.ok ? signed(preview.realizedPnl) : '—');
    tone($('reduce-realized'), preview.ok ? preview.realizedPnl : 0);
    text('reduce-released', preview.ok ? yen(preview.releasedMargin) : '—');
    const before = { entry: p.entry, units: p.units, margin: p.margin, balance: account.balance, pnl: account.pnl,
      equity: account.equity, free: account.freeMargin, liquidation: game.liquidationPrice() };
    const after = preview.ok ? { ...preview.after, free: preview.after.freeMargin, liquidation: preview.after.liquidationPrice } : null;
    const formats = { units, entry: n => n === null ? '已全平' : price(n), margin: yen, balance: yen,
      pnl: signed, equity: yen, free: yen };
    for (const [name, format] of Object.entries(formats)) {
      text(`reduce-before-${name}`, format(before[name]));
      text(`reduce-after-${name}`, after ? format(after[name]) : '—');
    }
    text('reduce-before-liquidation', before.liquidation === null ? '无可达强平价' : price(before.liquidation));
    text('reduce-after-liquidation', !after ? '—' : after.units === 0 ? '无持仓'
      : after.liquidation === null ? '无可达强平价' : price(after.liquidation));
    $('reduce-confirm').disabled = !preview.ok;
    $('reduce-confirm').textContent = preview.ok && preview.percent === 100 ? '确认全部平仓' : '确认减仓';
    text('reduce-error', preview.ok ? '' : preview.message);
    document.querySelectorAll('[data-reduce-percent]').forEach(button => {
      const selected = Number(button.dataset.reducePercent) === percent;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
    });
  }

  function showReduce() {
    if (!game.position || game.ending || game.paused) return;
    renderReduce(); $('reduce-dialog').showModal();
  }

  function confirmReduce() {
    const result = game.reduce(Number($('reduce-percent').value));
    if (!result.ok) { renderReduce(); return; }
    $('reduce-dialog').close(); render();
    const trade = result.trade;
    toast(trade.reason === 'partial' ? `${trade.symbol} 已减仓 ${trade.closedPercent}%` : `${trade.symbol} 已全部平仓`,
      `本次结算 ${signed(trade.pnl)}，释放保证金 ${yen(trade.margin)}。`, trade.pnl < 0 ? 'notice' : '');
  }

  function cell(row, value, className = '') {
    const td = document.createElement('td');
    td.textContent = value;
    if (className) td.className = className;
    row.append(td);
    return td;
  }

  function renderHistory() {
    if (lastHistoryCount === game.totalTrades) return;
    lastHistoryCount = game.totalTrades;
    text('history-count', game.totalTrades);
    text('trade-summary', game.totalTrades ? `${game.totalTrades} 次结算 · 结算胜率 ${(game.wins / game.totalTrades * 100).toFixed(0)}%` : '你的交易，从这里开始');
    $('history-empty').hidden = game.history.length > 0;
    $('history-table-wrap').hidden = game.history.length === 0;
    const body = $('history-body');
    body.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const trade of game.history) {
      const row = document.createElement('tr');
      const sideCell = cell(row, '');
      const tag = document.createElement('span');
      tag.className = `position-side-tag ${trade.side === 'short' ? 'short' : ''}`;
      tag.textContent = `${trade.symbol} ${trade.side === 'long' ? '买涨' : '买跌'} ${trade.leverage}×${trade.additions ? ` · 加仓${trade.additions}次` : ''}`;
      sideCell.append(tag);
      cell(row, price(trade.entry));
      cell(row, price(trade.exit));
      const base = FX.INSTRUMENTS.find(config => config.symbol === trade.symbol).base;
      cell(row, `${trade.units > 0 && trade.units < 0.000001 ? '<0.000001' : trade.units.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${base}`);
      cell(row, yen(trade.margin));
      const duration = trade.closedAt - trade.openedAt;
      cell(row, duration >= 60 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : `${duration}m`);
      cell(row, signed(trade.pnl), trade.pnl > 0 ? 'positive' : trade.pnl < 0 ? 'negative' : '');
      cell(row, trade.reason === 'partial' ? `减仓 ${trade.closedPercent}%` : trade.reason === 'liquidation' ? '强制平仓' : '全部平仓', `trade-reason ${trade.reason === 'liquidation' ? 'liquidated' : trade.reason === 'partial' ? 'partial' : ''}`);
      fragment.append(row);
    }
    body.append(fragment);
  }

  function renderSession() {
    const resting = marketResting();
    const ended = Boolean(game.ending);
    const state = `${game.paused}:${resting}:${ended}`;
    if (lastPauseState !== state) {
      lastPauseState = state;
      text('session-status', ended ? '本局已结束' : game.paused ? '模拟行情已暂停' : resting ? '模拟行情休息中' : '模拟行情进行中');
      $('session-dot').classList.toggle('paused', game.paused || resting || ended);
      $('paused-overlay').hidden = !game.paused && !ended;
      $('paused-overlay').querySelector('strong').textContent = ended ? '破产退场 · 本局结束' : '行情已暂停';
      $('paused-overlay').querySelector('span').textContent = ended ? '可查看记录、彩蛋图鉴，或重新开局' : '继续行情后可交易';
      text('market-status', ended ? '交易终端已关闭' : game.paused ? '行情暂停' : '模拟市场');
      text('pause-icon', game.paused ? '▷' : 'Ⅱ');
      text('pause-label', game.paused ? '继续' : '暂停');
      $('pause-button').setAttribute('aria-pressed', game.paused);
      $('pause-button').disabled = ended;
      $('new-order-button').disabled = ended;
      $('menu-order-button').disabled = ended;
      document.querySelectorAll('[data-speed]').forEach(button => { button.disabled = ended; });
    }
    text('session-time', simTime(game.tick));
  }

  function render() {
    const a = game.account();
    text('equity', yen(a.equity));
    text('balance', yen(a.balance));
    text('floating-pnl', signed(a.pnl)); tone($('floating-pnl'), a.pnl);
    text('realized-pnl', signed(a.realizedPnl)); tone($('realized-pnl'), a.realizedPnl);
    text('free-margin', yen(a.freeMargin));
    text('used-margin', yen(a.usedMargin));
    text('floating-note', game.ending ? '本局已落幕 · 可查看记录或重新开局' : game.position ? `持有 ${game.position.symbol} ${game.position.side === 'long' ? '多头' : '空头'} · ${game.position.leverage}× 杠杆` : game.totalTrades ? '已平仓，等待下一次机会' : '等待你的第一笔交易');
    text('market-price', price(game.price));
    const change = game.price - game.config.start;
    text('price-change', `${change >= 0 ? '+' : '−'}${price(Math.abs(change))} (${change >= 0 ? '+' : '−'}${Math.abs(change / game.config.start * 100).toFixed(2)}%)`);
    tone($('price-change'), change);
    renderMarkets(); storyUI.render(); renderSession(); renderOrder(); renderPosition(a); renderAdd(); renderReduce(); renderHistory(); chart.render(game);
    $('market-chart').setAttribute('aria-label', `${game.symbol} ${game.config.style}风格模拟蜡烛图，红涨蓝跌，当前 ${price(game.price)} 日元，较开局${change >= 0 ? '上涨' : '下跌'} ${price(Math.abs(change))}`);
  }

  function showView(view, focus = false) {
    currentView = view;
    for (const name of ['position', 'history']) {
      const active = view === name;
      $(`${name}-view`).hidden = !active;
      $(`${name}-tab`).classList.toggle('active', active);
      $(`${name}-tab`).setAttribute('aria-selected', active);
      $(`${name}-tab`).tabIndex = active ? 0 : -1;
    }
    if (focus) $(`${view}-tab`).focus();
  }

  function open(side) {
    const { margin, leverage } = orderState();
    const result = game.open(side, margin, leverage);
    if (!result.ok) { toast('没有创建交易', result.message, 'notice'); return; }
    $('order-dialog').close();
    $('terminal-window').classList.remove('terminal-hidden');
    $('terminal-toggle').setAttribute('aria-pressed', 'true');
    showView('position'); render();
    toast(`${game.position.symbol} ${side === 'long' ? '买涨' : '买跌'}已开仓 · ${leverage}×`, `${yen(margin)} 日元保证金，入场价 ${price(game.position.entry)}。`);
  }

  function settle() {
    const result = game.close();
    if (!result.ok) { toast('暂时无法平仓', result.message, 'notice'); return; }
    render();
    toast('已平仓结算', `本笔${result.trade.pnl >= 0 ? '盈利' : '亏损'} ${yen(Math.abs(result.trade.pnl))}。`, result.trade.pnl < 0 ? 'notice' : '');
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (game.paused || game.ending || marketResting()) return;
      const result = game.advance();
      if (result.trade) {
        showView('position');
        toast(`${result.trade.symbol} 触发强平`, `保证金比例触及 50%。本笔结算 ${signed(result.trade.pnl)}，剩余本金 ${yen(game.balance)}。`, 'error');
        if (game.balance < 1 && !game.ending) toast('本金见底', '本金不足 1 日元。可以向萌智子借款、查看记录，或重新开始。', 'notice');
      }
      render();
    }, 1000 / speed);
  }

  $('margin-input').addEventListener('input', renderOrder);
  $('order-currency-select').addEventListener('change', event => selectCurrency(event.target.value));
  $('leverage-select').addEventListener('change', renderOrder);
  $('buy-button').addEventListener('click', () => open('long'));
  $('sell-button').addEventListener('click', () => open('short'));
  $('close-button').addEventListener('click', settle);
  $('add-position-button').addEventListener('click', showAdd);
  $('reduce-position-button').addEventListener('click', showReduce);
  $('fund-position-button').addEventListener('click', () => storyUI.showLoan());
  $('add-close').addEventListener('click', () => $('add-dialog').close());
  $('add-confirm').addEventListener('click', confirmAdd);
  $('add-margin').addEventListener('input', renderAdd);
  $('reduce-close').addEventListener('click', () => $('reduce-dialog').close());
  $('reduce-confirm').addEventListener('click', confirmReduce);
  $('reduce-percent').addEventListener('input', renderReduce);
  document.querySelectorAll('[data-reduce-percent]').forEach(button => button.addEventListener('click', () => {
    $('reduce-percent').value = button.dataset.reducePercent; renderReduce();
  }));
  document.querySelectorAll('[data-add-allocation]').forEach(button => button.addEventListener('click', () => {
    $('add-margin').value = Math.floor(Math.max(0, game.account().freeMargin) * Number(button.dataset.addAllocation));
    renderAdd();
  }));
  document.querySelectorAll('[data-allocation]').forEach(button => button.addEventListener('click', () => {
    $('margin-input').value = Math.floor(game.balance * Number(button.dataset.allocation));
    renderOrder();
  }));
  document.querySelectorAll('[data-leverage]').forEach(button => button.addEventListener('click', () => {
    $('leverage-select').value = button.dataset.leverage; renderOrder();
  }));
  document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {
    speed = Number(button.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => {
      const selected = Number(b.dataset.speed) === speed;
      b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected);
    });
    restartTimer();
  }));
  $('pause-button').addEventListener('click', () => {
    game.paused = !game.paused; render(); restartTimer();
  });
  $('position-tab').addEventListener('click', () => showView('position'));
  $('history-tab').addEventListener('click', () => showView('history'));
  document.querySelector('.position-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showView(event.key === 'Home' ? 'position' : event.key === 'End' ? 'history' : currentView === 'position' ? 'history' : 'position', true);
  });
  $('help-button').addEventListener('click', () => { $('help-dialog').showModal(); renderSession(); });
  $('help-close').addEventListener('click', () => $('help-dialog').close());
  const showOrder = () => { renderOrder(); $('order-dialog').showModal(); };
  $('new-order-button').addEventListener('click', showOrder);
  $('menu-order-button').addEventListener('click', showOrder);
  $('order-close').addEventListener('click', () => $('order-dialog').close());
  $('reference-button').addEventListener('click', () => { $('reference-dialog').showModal(); renderSession(); });
  $('reference-close').addEventListener('click', () => $('reference-dialog').close());
  $('terminal-toggle').addEventListener('click', () => {
    const hidden = $('terminal-window').classList.toggle('terminal-hidden');
    $('terminal-toggle').setAttribute('aria-pressed', !hidden);
  });
  $('grid-button').addEventListener('click', () => {
    chart.setGrid(!chart.showGrid);
    $('grid-button').setAttribute('aria-pressed', chart.showGrid);
  });
  $('crosshair-button').addEventListener('click', () => {
    chart.setCrosshair(!chart.crosshair);
    $('crosshair-button').setAttribute('aria-pressed', chart.crosshair);
  });
  const syncZoom = () => {
    $('zoom-in-button').disabled = chart.zoom >= 4;
    $('zoom-out-button').disabled = chart.zoom <= 1;
  };
  $('zoom-in-button').addEventListener('click', () => { chart.zoomBy(1.4); syncZoom(); });
  $('zoom-out-button').addEventListener('click', () => { chart.zoomBy(1 / 1.4); syncZoom(); });
  $('reset-button').addEventListener('click', () => { $('reset-dialog').showModal(); renderSession(); });
  $('reset-cancel').addEventListener('click', () => $('reset-dialog').close());
  function resetGame() {
    game.reset(); storyUI.reset(); lastHistoryCount = -1;
    $('margin-input').value = '30000'; $('leverage-select').value = '25';
    $('add-margin').value = '30000';
    $('reduce-percent').value = '50';
    speed = 1;
    document.querySelectorAll('[data-speed]').forEach(b => {
      const selected = b.dataset.speed === '1';
      b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected);
    });
    $('toast-region').replaceChildren(); $('reset-dialog').close();
    chart.zoom = 1; chart.setGrid(true); chart.setCrosshair(true); syncZoom();
    $('grid-button').setAttribute('aria-pressed', 'true');
    $('crosshair-button').setAttribute('aria-pressed', 'true');
    $('terminal-window').classList.remove('terminal-hidden');
    $('terminal-toggle').setAttribute('aria-pressed', 'true');
    showView('position'); render(); restartTimer();
    toast('新的一局，新的机会', '30 万日元已到账。欠款、成就和结局已重置，2000万夺还计划重新开始。');
  }
  $('reset-confirm').addEventListener('click', resetGame);
  // Closing an order must not reset the quote timer or delay the next simulated step.
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', renderSession));
  document.addEventListener('visibilitychange', () => { renderSession(); restartTimer(); });
  syncZoom(); render(); restartTimer();
})();
