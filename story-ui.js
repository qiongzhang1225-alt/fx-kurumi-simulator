(function (root) {
  'use strict';

  class StoryUI {
    constructor({ game, money, signed, onChange, onRestart, onHistory }) {
      this.game = game;
      this.money = money;
      this.signed = signed;
      this.onChange = onChange;
      this.onRestart = onRestart;
      this.onHistory = onHistory;
      this.queue = [];
      this.current = null;
      this.returnToGallery = false;
      this.cards = new Map();
      const $ = id => document.getElementById(id);
      this.$ = $;
      this.profitPopupsEnabled = true;
      try { this.profitPopupsEnabled = root.localStorage.getItem('fx-simulator-profit-popups') !== 'off'; } catch (_) { /* File mode may deny browser storage. */ }
      for (const id of ['profit-popup-toggle', 'help-profit-popup-toggle']) {
        $(id).checked = this.profitPopupsEnabled;
        $(id).addEventListener('change', () => this.setProfitPopups($(id).checked));
      }
      for (const achievement of FX.ACHIEVEMENTS) {
        const card = document.createElement('article'); card.className = 'achievement-card';
        card.dataset.achievementId = achievement.id;
        const art = document.createElement('div'); art.className = 'achievement-art';
        const image = document.createElement('img'); image.src = achievement.silhouette;
        image.alt = '未解锁的角色剪影'; image.width = 1080; image.height = 1080;
        const mystery = document.createElement('div'); mystery.className = 'mystery-prompt';
        mystery.setAttribute('aria-hidden', 'true');
        const prompt = document.createElement('span'); prompt.textContent = '我是谁？';
        const question = document.createElement('strong'); question.textContent = '？';
        const caption = document.createElement('span'); caption.className = 'meme-caption';
        caption.textContent = achievement.caption || ''; caption.hidden = true;
        mystery.append(prompt, question); art.append(image, mystery, caption);
        const body = document.createElement('div'); body.className = 'achievement-details';
        const status = document.createElement('span'); status.className = 'achievement-status';
        const title = document.createElement('h3'); title.textContent = achievement.title;
        const description = document.createElement('p'); description.textContent = achievement.description;
        const preview = document.createElement('button'); preview.textContent = '达成后揭晓'; preview.disabled = true;
        preview.setAttribute('aria-label', `尚未解锁：${achievement.title}`);
        preview.addEventListener('click', () => this.preview({ type: 'achievement', id: achievement.id }));
        body.append(status, title, description, preview); card.append(art, body);
        $('achievement-grid').append(card); this.cards.set(achievement.id, { card, status, image, mystery, caption, preview, achievement });
      }
      $('loan-button').addEventListener('click', () => this.showLoan());
      $('loan-close').addEventListener('click', () => $('loan-dialog').close());
      $('gallery-button').addEventListener('click', () => { $('gallery-dialog').showModal(); this.onChange(); });
      $('gallery-close').addEventListener('click', () => $('gallery-dialog').close());
      $('loan-amount').addEventListener('input', () => { $('loan-result').textContent = ''; this.renderLoan(); });
      document.querySelectorAll('[data-loan-amount]').forEach(button => button.addEventListener('click', () => {
        $('loan-amount').value = button.dataset.loanAmount; $('loan-result').textContent = ''; this.renderLoan();
      }));
      $('repay-all').addEventListener('click', () => {
        $('loan-amount').value = game.account().repayable; this.transact('repay');
      });
      $('borrow-confirm').addEventListener('click', () => this.transact('borrow'));
      $('repay-confirm').addEventListener('click', () => this.transact('repay'));
      $('preview-ending').addEventListener('click', () => this.preview({ type: 'ending', id: 'debt-ending' }));
      $('ending-replay').addEventListener('click', () => this.show({ type: 'ending', id: 'debt-ending' }));
      $('story-close').addEventListener('click', () => $('story-dialog').close());
      $('story-return').addEventListener('click', () => {
        const ending = this.current && this.current.type === 'ending' && !this.current.preview;
        $('story-dialog').close();
        if (ending) this.onHistory();
      });
      $('story-restart').addEventListener('click', () => { $('story-dialog').close(); this.onRestart(); });
      $('story-dialog').addEventListener('close', () => {
        this.current = null;
        if (this.returnToGallery) { this.returnToGallery = false; $('gallery-dialog').showModal(); }
        this.onChange();
      });
      document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => this.pump()));
    }

    showLoan() {
      this.$('loan-result').textContent = '';
      this.renderLoan(); this.$('loan-dialog').showModal(); this.onChange();
    }

    setProfitPopups(enabled) {
      this.profitPopupsEnabled = enabled;
      for (const id of ['profit-popup-toggle', 'help-profit-popup-toggle']) this.$(id).checked = enabled;
      if (!enabled) this.queue = this.queue.filter(event => event.type !== 'profit');
      try { root.localStorage.setItem('fx-simulator-profit-popups', enabled ? 'on' : 'off'); } catch (_) { /* Keep the preference for this page if storage is unavailable. */ }
    }

    transact(action) {
      const amount = Number(this.$('loan-amount').value);
      const result = this.game[action](amount);
      const status = this.$('loan-result');
      status.classList.toggle('negative', !result.ok);
      status.textContent = result.ok
        ? `${action === 'borrow' ? '借款到账' : '已归还'} ${this.money(amount)}。本金借还不产生盈利，利息另计。`
        : result.message;
      this.onChange();
    }

    renderLoan() {
      const a = this.game.account(), amount = Number(this.$('loan-amount').value);
      const borrow = this.game.previewLoan('borrow', amount), repay = this.game.previewLoan('repay', amount);
      this.$('loan-debt').textContent = this.money(a.principal);
      this.$('loan-available').textContent = this.money(Math.max(0, FX.DEBT_LIMIT - a.principal));
      this.$('loan-repayable').textContent = this.money(a.repayable);
      this.$('loan-interest-total').textContent = this.money(a.interestCharged);
      this.$('loan-interest-due').textContent = this.money(a.interestDue);
      this.$('loan-daily-interest').textContent = `${this.money(a.dailyInterest)} / 天`;
      this.$('loan-rate').textContent = `${(FX.DAILY_INTEREST_RATE * 100).toFixed(1)}% / 模拟日`;
      this.$('borrow-confirm').disabled = !borrow.ok;
      this.$('repay-confirm').disabled = !repay.ok;
      if (!borrow.ok && !repay.ok && !this.$('loan-result').textContent) {
        this.$('loan-result').textContent = borrow.message;
        this.$('loan-result').classList.add('negative');
      }
      this.$('repay-all').disabled = !a.repayable || Boolean(this.game.ending);
      this.$('loan-amount').disabled = Boolean(this.game.ending);
      const p = this.game.position;
      const base = p ? FX.INSTRUMENTS.find(config => config.symbol === p.symbol).base : '';
      this.$('loan-position-note').textContent = p
        ? `${p.symbol} ${p.side === 'long' ? '买涨' : '买跌'} · ${p.leverage}×。借还款后数量 ${p.units.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${base}、均价 ${p.entry.toFixed(3)} 保持不变。`
        : '当前无持仓。借还款只改变余额与欠款，不会创建交易。';
      const current = { balance: a.balance, debt: a.debt, liquidationPrice: this.game.liquidationPrice() };
      for (const [name, snapshot] of [['before', current], ['borrow', borrow.ok ? borrow.after : null], ['repay', repay.ok ? repay.after : null]]) {
        this.$(`loan-${name}-balance`).textContent = snapshot ? this.money(snapshot.balance) : '—';
        this.$(`loan-${name}-debt`).textContent = snapshot ? this.money(snapshot.debt) : '—';
        this.$(`loan-${name}-liquidation`).textContent = !snapshot ? '—' : !p ? '无持仓'
          : snapshot.liquidationPrice === null ? '无可达强平价' : snapshot.liquidationPrice.toFixed(3);
      }
    }

    render() {
      const a = this.game.account();
      this.$('debt-value').textContent = this.money(a.debt);
      this.$('net-assets-value').textContent = this.money(a.netAssets);
      this.$('net-assets-value').classList.toggle('negative', a.netAssets < 0);
      const progress = Math.min(20000000, Math.max(0, a.netAssets));
      this.$('story-progress').setAttribute('aria-valuenow', progress);
      this.$('story-progress-fill').style.width = `${progress / 200000}%`;
      this.$('achievement-count').textContent = `${this.game.unlocked.length}/${FX.ACHIEVEMENTS.length}`;
      this.$('gallery-count').textContent = `${this.game.unlocked.length} / ${FX.ACHIEVEMENTS.length}`;
      this.$('ending-replay').hidden = !this.game.ending;
      for (const [id, { card, status, image, mystery, caption, preview, achievement }] of this.cards) {
        const unlocked = this.game.unlocked.includes(id);
        card.classList.toggle('unlocked', unlocked); status.textContent = unlocked ? '✦ 已解锁' : '◇ 未解锁';
        const src = unlocked ? achievement.meme : achievement.silhouette;
        if (image.getAttribute('src') !== src) image.src = src;
        image.alt = unlocked ? `${achievement.title} 配图` : '未解锁的角色剪影';
        mystery.hidden = unlocked;
        caption.hidden = !unlocked || !achievement.caption;
        preview.disabled = !unlocked;
        preview.textContent = unlocked ? '查看表情包' : '达成后揭晓';
        preview.setAttribute('aria-label', `${unlocked ? '查看彩蛋' : '尚未解锁'}：${achievement.title}`);
      }
      this.$('preview-ending').disabled = !this.game.ending;
      this.$('preview-ending').textContent = this.game.ending ? '重看「破产退场」结局' : '？ 结局尚未解锁';
      this.renderLoan();
      const events = this.game.takeEvents();
      if (events.some(event => event.type === 'ending')) {
        this.queue = events.filter(event => event.type === 'ending');
        document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      } else this.queue.push(...events.filter(event => event.type !== 'profit' || this.profitPopupsEnabled));
      this.pump();
    }

    pump() {
      if (this.queue.length && !document.querySelector('dialog[open]')) this.show(this.queue.shift());
    }

    preview(event) {
      const unlocked = event.type === 'ending' ? Boolean(this.game.ending) : this.game.unlocked.includes(event.id);
      if (!unlocked) return;
      this.$('gallery-dialog').close();
      this.returnToGallery = true;
      this.show({ ...event, preview: true });
    }

    show(event) {
      this.current = event;
      const ending = event.type === 'ending';
      const profit = event.type === 'profit';
      const definition = FX.ACHIEVEMENTS.find(achievement => achievement.id === (profit ? 'first-profit' : event.id));
      const settlement = event.settlement;
      const hasSettlement = !event.preview && Boolean(settlement && settlement.pnl > 0)
        && (profit || event.id === 'first-profit');
      const dialog = this.$('story-dialog');
      dialog.classList.toggle('is-ending', ending);
      this.$('story-window-title').textContent = event.preview ? '彩蛋回看' : ending ? '本局结局' : profit ? '盈利结算' : '成就解锁';
      this.$('story-label').textContent = event.preview ? 'COLLECTION REPLAY' : ending ? 'BAD END · 2000万的另一面' : profit ? 'TRADE SETTLED' : 'ACHIEVEMENT UNLOCKED';
      this.$('story-seal').textContent = ending ? 'END' : profit ? '✓' : '✦';
      this.$('story-title').textContent = ending ? '破产退场' : profit ? '本次交易盈利' : definition.title;
      this.$('story-description').textContent = ending
        ? '“2000万……这次是欠下的。”\n交易终端已关闭。明天起，打工还债。\n这一局，到这里落幕。'
        : profit ? '下方为本次已平仓部分的结算结果。' : definition.description;
      this.$('story-profit-block').hidden = !hasSettlement;
      this.$('profit-popup-options').hidden = !hasSettlement;
      this.$('story-profit-amount').textContent = hasSettlement
        ? settlement.pnl < 0.005 ? '+<¥0.01' : this.signed(settlement.pnl) : '';
      this.$('story-profit-details').textContent = hasSettlement
        ? `${settlement.symbol} · ${settlement.side === 'long' ? '买涨' : '买跌'} · ${settlement.leverage}× · ${settlement.reason === 'partial' ? `减仓 ${settlement.closedPercent}%` : settlement.reason === 'liquidation' ? '强制平仓' : '全部平仓'}` : '';
      const image = this.$('story-image');
      image.src = ending ? 'assets/kurumi-panic.jpg' : definition.meme;
      image.alt = ending ? '久留美：已经看不下去了' : `${definition.title} 角色表情图`;
      this.$('story-meme-caption').textContent = !ending && definition.caption || '';
      this.$('story-meme-caption').hidden = ending || !definition.caption;
      this.$('story-preview-note').hidden = !event.preview;
      this.$('story-restart').hidden = !ending || Boolean(event.preview);
      this.$('story-return').textContent = event.preview ? '返回图鉴' : ending ? '查看本局记录' : '返回交易台';
      const stats = this.$('ending-stats'); stats.hidden = !ending;
      if (ending) {
        const record = this.game.ending;
        stats.replaceChildren();
        for (const [label, value] of [['未还欠款', this.money(record.debt)], ['剩余资产', this.money(record.balance)], ['交易损益', this.signed(record.pnl)], ['结算次数', `${record.trades} 次`]]) {
          const item = document.createElement('div');
          const name = document.createElement('span'); name.textContent = label;
          const number = document.createElement('strong'); number.textContent = value;
          item.append(name, number); stats.append(item);
        }
      }
      dialog.showModal();
    }

    reset() {
      this.queue = []; this.current = null; this.returnToGallery = false;
      this.game.takeEvents();
      this.$('loan-amount').value = '1000000'; this.$('loan-result').textContent = '';
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    }
  }
  root.StoryUI = StoryUI;
})(window);
