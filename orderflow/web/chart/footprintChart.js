/**
 * Footprint chart renderer.
 *
 * Canvas rather than SVG or a chart library: a footprint bar is a few dozen
 * text cells, a screen holds a few hundred bars, and the feed repaints at
 * 10Hz. That is tens of thousands of elements a second, which is fine for
 * immediate-mode drawing and hopeless for retained-mode DOM.
 */
export class FootprintChart {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    this.rowHeight = 15;
    this.barWidth = 78;
    this.follow = true;
    this.centerRow = null;
    this.offsetBars = 0;
    this.hover = null;
    this._bindInput();
  }

  get rowSize() { return this.state.config.tickSize * this.state.config.tickAggregation; }
  toRow(price) { return Math.round(price / this.rowSize); }
  rowToPrice(row) { return row * this.rowSize; }

  _bindInput() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey) {
        this.barWidth = clamp(this.barWidth * (e.deltaY > 0 ? 0.9 : 1.1), 6, 220);
      } else {
        this.rowHeight = clamp(this.rowHeight * (e.deltaY > 0 ? 0.9 : 1.1), 2, 46);
        this.manualZoom = true;
      }
    }, { passive: false });

    let drag = null;
    c.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, offset: this.offsetBars, center: this.centerRow };
    });
    window.addEventListener('mouseup', () => { drag = null; });
    window.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top,
                     inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
                     clientX: e.clientX, clientY: e.clientY };
      if (!drag) return;
      this.follow = false;
      this.offsetBars = Math.max(0, Math.round(drag.offset + (e.clientX - drag.x) / this.barWidth));
      this.centerRow = (drag.center ?? this.centerRow) - Math.round((e.clientY - drag.y) / this.rowHeight);
    });
    // Double click returns to "follow the market, fit the range" — the state
    // you want back after exploring, and the only way out of manual zoom.
    c.addEventListener('dblclick', () => {
      this.follow = true; this.offsetBars = 0; this.centerRow = null; this.manualZoom = false;
    });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  draw() {
    const s = this.state;
    this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!s.bars.length && !s.openBar) return;

    const axisW = 66;
    const plotW = this.w - axisW;
    const bars = [...s.bars, s.openBar].filter(Boolean);
    const visible = Math.max(1, Math.floor(plotW / this.barWidth));
    const end = Math.max(1, bars.length - this.offsetBars);
    const slice = bars.slice(Math.max(0, end - visible), end);
    if (!slice.length) return;

    if (this.follow && !this.manualZoom) this._autoFit(slice);
    if (this.follow || this.centerRow == null) {
      // Centre on the traded range of what is on screen, not on the last bar
      // alone, so a quiet bar does not throw the viewport around.
      let hi = -Infinity, lo = Infinity;
      for (const b of slice) { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); }
      this.centerRow = this.toRow((hi + lo) / 2);
    }
    const rowsOnScreen = Math.floor(this.h / this.rowHeight);
    const topRow = this.centerRow + Math.floor(rowsOnScreen / 2);
    const yOf = (row) => (topRow - row) * this.rowHeight;
    const priceOf = (y) => this.rowToPrice(topRow - Math.floor(y / this.rowHeight));

    this.view = { slice, topRow, rowsOnScreen, yOf, plotW, axisW, barWidth: this.barWidth };

    this._grid(ctx, topRow, rowsOnScreen, plotW, axisW);
    if (s.toggles.liquidity) this._liquidityHeat(ctx, plotW, yOf);
    if (s.toggles.profile) this._profile(ctx, plotW, yOf);
    this._levels(ctx, plotW, yOf);

    const maxRowVol = this._maxRowVolume(slice);
    slice.forEach((bar, i) => this._bar(ctx, bar, i * this.barWidth, yOf, maxRowVol));

    if (s.toggles.signals) this._signals(ctx, slice, yOf, plotW);
    this._priceAxis(ctx, topRow, rowsOnScreen, plotW, axisW);
    this._crosshair(ctx, priceOf, plotW);
    this._lastPrice(ctx, yOf, plotW, axisW);
  }

  /** Scale rows so the visible session fills the pane instead of a thin band. */
  _autoFit(slice) {
    let hi = -Infinity, lo = Infinity;
    for (const b of slice) { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); }
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;
    const rows = Math.max(4, this.toRow(hi) - this.toRow(lo) + 4);
    const target = clamp((this.h * 0.82) / rows, 2, 40);
    // Ease towards the target so a new extreme does not snap the whole chart.
    this.rowHeight += (target - this.rowHeight) * 0.15;
  }

  _maxRowVolume(slice) {
    let max = 1;
    for (const b of slice) for (const r of b.rows) max = Math.max(max, r.bid + r.ask);
    return max;
  }

  _grid(ctx, topRow, rowsOnScreen, plotW) {
    ctx.strokeStyle = '#141a24';
    ctx.lineWidth = 1;
    const step = Math.max(1, Math.round(rowsOnScreen / 12));
    for (let i = 0; i <= rowsOnScreen; i += step) {
      const y = Math.round(i * this.rowHeight) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
    }
  }

  /** Bar body plus the bid x ask table that gives the chart its name. */
  _bar(ctx, bar, x, yOf, maxRowVol) {
    const s = this.state;
    const w = this.barWidth;
    const bull = bar.close >= bar.open;
    const candleW = Math.min(9, Math.max(2, w * 0.12));
    const cx = x + candleW / 2 + 1;

    // wick + body, kept narrow so the numbers own the bar
    ctx.strokeStyle = bull ? '#2e7d78' : '#a8443f';
    ctx.beginPath();
    ctx.moveTo(cx, yOf(this.toRow(bar.high)));
    ctx.lineTo(cx, yOf(this.toRow(bar.low)) + this.rowHeight);
    ctx.stroke();
    const yo = yOf(this.toRow(bar.open)), yc = yOf(this.toRow(bar.close));
    ctx.fillStyle = bull ? 'rgba(38,166,154,.55)' : 'rgba(239,83,80,.55)';
    ctx.fillRect(x + 1, Math.min(yo, yc), candleW, Math.max(2, Math.abs(yc - yo)));

    const cellX = x + candleW + 3;
    const cellW = w - candleW - 5;
    const showNumbers = s.toggles.footprint && this.barWidth >= 46 && this.rowHeight >= 9;

    const imbalanceRows = new Map(bar.imbalances.map((i) => [i.row, i]));

    for (const cell of bar.rows) {
      const y = yOf(cell.row);
      if (y < -this.rowHeight || y > this.h) continue;
      const total = cell.bid + cell.ask;
      const intensity = Math.min(1, total / maxRowVol);

      if (showNumbers) {
        // Heat behind each half so size reads before the digits do.
        ctx.fillStyle = `rgba(239,83,80,${0.05 + 0.35 * (cell.bid / (total || 1)) * intensity})`;
        ctx.fillRect(cellX, y, cellW / 2, this.rowHeight - 1);
        ctx.fillStyle = `rgba(38,166,154,${0.05 + 0.35 * (cell.ask / (total || 1)) * intensity})`;
        ctx.fillRect(cellX + cellW / 2, y, cellW / 2, this.rowHeight - 1);
      } else {
        const d = cell.ask - cell.bid;
        ctx.fillStyle = d >= 0
          ? `rgba(38,166,154,${0.15 + 0.7 * intensity})`
          : `rgba(239,83,80,${0.15 + 0.7 * intensity})`;
        ctx.fillRect(cellX, y, Math.max(1, cellW * intensity), this.rowHeight - 1);
      }

      const imb = s.toggles.imbalance && imbalanceRows.get(cell.row);
      if (imb) {
        ctx.strokeStyle = imb.side === 'buy' ? 'rgba(38,166,154,.95)' : 'rgba(239,83,80,.95)';
        ctx.lineWidth = 1.5;
        const half = imb.side === 'buy' ? cellX + cellW / 2 : cellX;
        ctx.strokeRect(half + 0.5, y + 0.5, cellW / 2 - 1, this.rowHeight - 2);
      }

      if (cell.row === bar.poc) {
        ctx.fillStyle = 'rgba(240,180,41,.9)';
        ctx.fillRect(cellX - 3, y, 2, this.rowHeight - 1);
      }

      if (showNumbers) {
        ctx.font = `${Math.min(11, this.rowHeight - 3)}px ui-monospace, monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#c26b68';
        ctx.textAlign = 'right';
        ctx.fillText(fmtQty(cell.bid), cellX + cellW / 2 - 3, y + this.rowHeight / 2);
        ctx.fillStyle = '#5fbdb2';
        ctx.textAlign = 'left';
        ctx.fillText(fmtQty(cell.ask), cellX + cellW / 2 + 3, y + this.rowHeight / 2);
      }
    }

    // Stacked imbalance zones are the levels worth remembering, so box them.
    if (s.toggles.imbalance) {
      for (const z of bar.stacked) {
        ctx.strokeStyle = z.side === 'buy' ? 'rgba(38,166,154,.5)' : 'rgba(239,83,80,.5)';
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x + 0.5, yOf(z.toRow) + 0.5, w - 2,
                       (z.toRow - z.fromRow + 1) * this.rowHeight - 1);
        ctx.setLineDash([]);
      }
    }

    // Bar footer: delta and volume.
    if (this.barWidth >= 40) {
      const footY = yOf(this.toRow(bar.low)) + this.rowHeight + 12;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = bar.delta >= 0 ? '#5fbdb2' : '#c26b68';
      ctx.fillText(`${bar.delta >= 0 ? '+' : ''}${fmtQty(bar.delta)}`, x + w / 2, footY);
      ctx.fillStyle = '#5b6778';
      ctx.fillText(fmtQty(bar.volume), x + w / 2, footY + 11);
      if (bar.deltaDivergence) {
        ctx.fillStyle = bar.deltaDivergence === 'bullish' ? '#26a69a' : '#ef5350';
        ctx.fillText('÷', x + w / 2, footY + 22);
      }
    }
  }

  /** Resting size by price as a heat strip — where the book is, right now. */
  _liquidityHeat(ctx, plotW, yOf) {
    const rows = this.state.book?.rows;
    if (!rows?.length) return;
    let max = 1;
    for (const r of rows) max = Math.max(max, r.bid, r.ask);
    const stripW = 26;
    for (const r of rows) {
      const y = yOf(r.row);
      if (y < 0 || y > this.h) continue;
      const size = Math.max(r.bid, r.ask);
      const a = Math.min(0.85, (size / max) ** 0.6);
      ctx.fillStyle = r.bid >= r.ask ? `rgba(38,166,154,${a * 0.5})` : `rgba(239,83,80,${a * 0.5})`;
      ctx.fillRect(plotW - stripW, y, stripW, this.rowHeight - 1);
    }
    // Iceberg walls sit on top of the strip — they are hidden size, not shown size.
    for (const w of this.state.icebergWalls || []) {
      const y = yOf(this.toRow(w.price));
      if (y < 0 || y > this.h) continue;
      ctx.fillStyle = '#f0b429';
      ctx.fillRect(plotW - stripW - 5, y + this.rowHeight / 2 - 1.5, 4, 3);
    }
  }

  _profile(ctx, plotW, yOf) {
    const p = this.state.profile;
    if (!p?.rows?.length) return;
    let max = 1;
    for (const r of p.rows) max = Math.max(max, r.total);
    const width = Math.min(140, plotW * 0.16);
    const va = p.valueArea;
    for (const r of p.rows) {
      const y = yOf(r.row);
      if (y < 0 || y > this.h) continue;
      const w = (r.total / max) * width;
      const price = this.rowToPrice(r.row);
      const inVa = va && price >= va.val && price <= va.vah;
      ctx.fillStyle = inVa ? 'rgba(139,124,246,.30)' : 'rgba(107,120,137,.20)';
      ctx.fillRect(0, y, w, this.rowHeight - 1);
      ctx.fillStyle = 'rgba(239,83,80,.28)';
      ctx.fillRect(0, y, (r.bid / max) * width, this.rowHeight - 1);
    }
    if (va) {
      for (const [price, color, label] of [
        [va.poc, '#f0b429', 'POC'], [va.vah, '#8b7cf6', 'VAH'], [va.val, '#8b7cf6', 'VAL'],
      ]) {
        this._hline(ctx, yOf(this.toRow(price)), plotW, color, label, [4, 3]);
      }
    }
  }

  /** Gamma strikes, naked POCs and swept reference levels. */
  _levels(ctx, plotW, yOf) {
    const s = this.state;
    if (s.toggles.gammaLevels && s.gamma?.levels) {
      for (const lvl of s.gamma.levels) {
        const color = lvl.kind === 'gammaFlip' ? '#f0b429'
                    : lvl.kind === 'callWall' ? '#26a69a'
                    : lvl.kind === 'putWall' ? '#ef5350' : '#8b7cf6';
        this._hline(ctx, yOf(this.toRow(lvl.price)), plotW, color,
                    `${lvl.label} ${fmtPrice(lvl.price)}`, lvl.kind === 'gammaFlip' ? [] : [6, 4]);
      }
    }
    for (const z of s.absorptionZones || []) {
      const y = yOf(this.toRow(z.price));
      if (y < 0 || y > this.h) continue;
      ctx.fillStyle = z.bias === 'bullish' ? 'rgba(38,166,154,.13)' : 'rgba(239,83,80,.13)';
      ctx.fillRect(0, y - this.rowHeight, plotW, this.rowHeight * 3);
    }
    for (const p of s.nakedPocs || []) {
      this._hline(ctx, yOf(this.toRow(p.price)), plotW, 'rgba(240,180,41,.45)', 'nPOC', [2, 4]);
    }
  }

  _hline(ctx, y, plotW, color, label, dash = []) {
    if (y < -20 || y > this.h + 20) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(plotW, y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = color;
      ctx.fillText(label, 4, y - 1);
    }
    ctx.restore();
  }

  _signals(ctx, slice, yOf, plotW) {
    const s = this.state;
    if (!slice.length) return;
    const t0 = slice[0].startTs;
    const span = Math.max(1, (slice[slice.length - 1].endTs - t0));
    for (const sig of s.signals.slice(-60)) {
      if (sig.ts < t0) continue;
      const x = ((sig.ts - t0) / span) * (slice.length * this.barWidth);
      const y = yOf(this.toRow(sig.price));
      if (y < 0 || y > this.h || x > plotW) continue;
      const up = sig.bias === 'bullish';
      ctx.fillStyle = up ? '#26a69a' : '#ef5350';
      ctx.globalAlpha = 0.45 + 0.55 * (sig.strength ?? 0.5);
      ctx.beginPath();
      const cy = y + this.rowHeight / 2;
      ctx.moveTo(x, up ? cy + 7 : cy - 7);
      ctx.lineTo(x - 5, up ? cy + 14 : cy - 14);
      ctx.lineTo(x + 5, up ? cy + 14 : cy - 14);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      if (this.barWidth > 30) {
        ctx.font = '8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(SIGNAL_ABBR[sig.type] ?? sig.type.slice(0, 3),
                     x, up ? cy + 22 : cy - 16);
      }
    }
  }

  _priceAxis(ctx, topRow, rowsOnScreen, plotW, axisW) {
    ctx.fillStyle = '#0d1219';
    ctx.fillRect(plotW, 0, axisW, this.h);
    ctx.strokeStyle = '#1d2531';
    ctx.beginPath(); ctx.moveTo(plotW + 0.5, 0); ctx.lineTo(plotW + 0.5, this.h); ctx.stroke();
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#6b7889';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const step = Math.max(1, Math.round(rowsOnScreen / 16));
    for (let i = 0; i <= rowsOnScreen; i += step) {
      const row = topRow - i;
      ctx.fillText(fmtPrice(this.rowToPrice(row)), plotW + 6, i * this.rowHeight + this.rowHeight / 2);
    }
  }

  _lastPrice(ctx, yOf, plotW, axisW) {
    const price = this.state.last?.price;
    if (!price) return;
    const y = yOf(this.toRow(price)) + this.rowHeight / 2;
    ctx.strokeStyle = 'rgba(216,224,234,.35)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(plotW, y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d8e0ea';
    ctx.fillRect(plotW + 1, y - 8, axisW - 2, 16);
    ctx.fillStyle = '#0a0d12';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtPrice(price), plotW + 6, y);
  }

  _crosshair(ctx, priceOf, plotW) {
    const h = this.hover;
    if (!h?.inside || h.x > plotW) return;
    ctx.strokeStyle = 'rgba(216,224,234,.2)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(h.x + 0.5, 0); ctx.lineTo(h.x + 0.5, this.h);
    ctx.moveTo(0, h.y + 0.5); ctx.lineTo(plotW, h.y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    this.hoverPrice = priceOf(h.y);
  }

  /** Which bar and row the cursor is over, for the tooltip. */
  hitTest() {
    const h = this.hover;
    if (!h?.inside || !this.view) return null;
    const idx = Math.floor(h.x / this.barWidth);
    const bar = this.view.slice[idx];
    if (!bar) return null;
    const row = this.view.topRow - Math.floor(h.y / this.rowHeight);
    const cell = bar.rows.find((r) => r.row === row);
    return { bar, cell, row, price: this.rowToPrice(row), x: h.clientX, y: h.clientY };
  }
}

const SIGNAL_ABBR = {
  absorption: 'ABS', absorptionFailed: 'ABS✗', iceberg: 'ICE',
  stopRun: 'SWEEP', stopRunArmed: 'sweep?', breakoutHeld: 'HOLD',
  rejection: 'REJ', stackedImbalance: 'STK', cvdDivergence: 'DIV',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function fmtQty(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function fmtPrice(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1000 ? v.toFixed(0)
       : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4);
}
