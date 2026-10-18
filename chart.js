(function () {
  'use strict';

  const UP = '#d8656d', DOWN = '#57a9cf', MUTED = '#73777b';
  const mono = '10px "Cascadia Code", Consolas, monospace';
  const priceText = n => n.toFixed(3);
  const clock = tick => {
    const minutes = ((540 + tick) % 1440 + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };

  class CandleChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.pointer = null;
      this.game = null;
      this.zoom = 1;
      this.showGrid = true;
      this.crosshair = true;
      canvas.style.cursor = 'crosshair';
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(canvas.parentElement);
      canvas.addEventListener('pointermove', event => {
        const rect = canvas.getBoundingClientRect();
        this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        this.draw();
      });
      canvas.addEventListener('pointerleave', () => { this.pointer = null; this.draw(); });
    }

    render(game) { this.game = game; this.draw(); }

    zoomBy(factor) {
      this.zoom = Math.min(4, Math.max(1, this.zoom * factor));
      this.draw();
    }

    setGrid(visible) { this.showGrid = visible; this.draw(); }

    setCrosshair(visible) {
      this.crosshair = visible;
      this.canvas.style.cursor = visible ? 'crosshair' : 'default';
      this.draw();
    }

    draw() {
      if (!this.game) return;
      const { canvas, ctx, game } = this;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width, height = rect.height;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = mono;
      const left = 8, right = width - 65, top = 28, bottom = height - 27;
      const plotWidth = right - left, plotHeight = bottom - top;
      const baseCount = Math.min(game.candles.length, Math.max(30, Math.floor(plotWidth / 8)));
      const count = Math.max(16, Math.round(baseCount / this.zoom));
      const candles = game.candles.slice(-count);
      const slot = plotWidth / (candles.length + 6);
      let low = Math.min(...candles.map(c => c.low));
      let high = Math.max(...candles.map(c => c.high));
      const range = Math.max(high - low, 0.25);
      const center = (high + low) / 2;
      low = center - range * 0.59;
      high = center + range * 0.59;
      const y = p => top + (high - p) / (high - low) * plotHeight;
      const x = i => left + slot * (i + 0.5);

      ctx.strokeStyle = '#d9dde1';
      ctx.lineWidth = 0.7;
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 5; i++) {
        const yy = top + plotHeight * i / 5;
        if (this.showGrid) {
          ctx.setLineDash([1, 3]);
          ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillText(priceText(high - (high - low) * i / 5), right + 10, yy);
      }
      const labelStep = Math.max(1, Math.floor(candles.length / (width < 450 ? 3 : 6)));
      for (let i = 0; i < candles.length; i += labelStep) {
        const xx = x(i);
        if (this.showGrid) {
          ctx.strokeStyle = '#e1e4e8'; ctx.setLineDash([1, 3]);
          ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, bottom); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.textAlign = 'center'; ctx.fillStyle = MUTED;
        ctx.fillText(clock(candles[i].time), xx, height - 13);
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(left, top - 7, plotWidth, plotHeight + 14); ctx.clip();
      candles.forEach((c, i) => {
        const color = c.close >= c.open ? UP : DOWN;
        const xx = x(i);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xx, y(c.high)); ctx.lineTo(xx, y(c.low)); ctx.stroke();
        const candleWidth = Math.max(2, Math.min(6, slot * 0.47));
        const upper = y(Math.max(c.open, c.close));
        const lower = y(Math.min(c.open, c.close));
        ctx.globalAlpha = 1;
        ctx.fillRect(xx - candleWidth / 2, upper, candleWidth, Math.max(1.5, lower - upper));
        ctx.globalAlpha = 1;
      });
      ctx.restore();

      const guide = (price, color, text, solid = false) => {
        const yy = y(price);
        if (yy < top - 4 || yy > bottom + 4) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(solid ? [] : [4, 5]);
        ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
        ctx.setLineDash([]);
        if (text) {
          ctx.font = '9px "Microsoft YaHei", sans-serif';
          const labelWidth = ctx.measureText(text).width + 14;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(left + 3, yy - 16, labelWidth, 15);
          ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(text, left + 9, yy - 8);
          ctx.font = mono;
        }
      };
      if (game.position && game.position.symbol === game.symbol) {
        guide(game.position.entry, '#a27b2f', `入场 ${priceText(game.position.entry)}`);
        const liquidation = game.liquidationPrice();
        if (liquidation) guide(liquidation, '#bb303c', `强平 ${priceText(liquidation)}`);
      }
      const last = candles.at(-1);
      guide(game.price, '#555b61', null, true);
      const currentY = Math.max(top, Math.min(bottom, y(game.price)));
      ctx.fillStyle = '#e4e6e8';
      ctx.fillRect(right + 2, currentY - 8, 61, 16);
      ctx.strokeStyle = '#abb2b8'; ctx.lineWidth = 0.7;
      ctx.strokeRect(right + 2, currentY - 8, 61, 16);
      ctx.fillStyle = '#33393e'; ctx.textAlign = 'center';
      ctx.fillText(priceText(game.price), right + 32, currentY + 0.5);

      let selected = last;
      const point = this.pointer;
      if (this.crosshair && point && point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
        const index = Math.max(0, Math.min(candles.length - 1, Math.floor((point.x - left) / slot)));
        selected = candles[index];
        ctx.strokeStyle = '#707b8588'; ctx.setLineDash([3, 4]); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x(index), top); ctx.lineTo(x(index), bottom);
        ctx.moveTo(left, point.y); ctx.lineTo(right, point.y); ctx.stroke(); ctx.setLineDash([]);
        const price = high - (point.y - top) / plotHeight * (high - low);
        ctx.fillStyle = '#677580'; ctx.fillRect(right + 2, point.y - 8, 61, 16);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(priceText(price), right + 32, point.y);
        ctx.fillStyle = '#677580'; ctx.fillRect(x(index) - 23, bottom + 6, 46, 16);
        ctx.fillStyle = '#ffffff'; ctx.fillText(clock(selected.time), x(index), bottom + 14);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#596068';
      const labels = width < 470
        ? `开 ${priceText(selected.open)}   收 ${priceText(selected.close)}`
        : `开 ${priceText(selected.open)}   高 ${priceText(selected.high)}   低 ${priceText(selected.low)}   收 ${priceText(selected.close)}`;
      ctx.font = '9px "Cascadia Code", "Microsoft YaHei", monospace';
      ctx.fillText(`${game.symbol},M5  ${labels}`, left, 12);
    }
  }

  window.CandleChart = CandleChart;
})();
