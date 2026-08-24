import { fmtQty, fmtPrice } from './footprintChart.js';

const dpr = () => window.devicePixelRatio || 1;

function prep(canvas) {
  const r = dpr();
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width !== w * r || canvas.height !== h * r) {
    canvas.width = w * r; canvas.height = h * r;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Cumulative delta line with per-bar delta histogram underneath. */
export function drawCvd(canvas, state) {
  const { ctx, w, h } = prep(canvas);
  const series = state.cvdSeries;
  if (series.length < 2) return;

  const pad = 6, axisW = 66;
  const plotW = w - axisW;
  const vals = series.map((p) => p.cvd);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const y = (v) => pad + (1 - (v - lo) / span) * (h - pad * 2 - 26);
  const x = (i) => (i / (series.length - 1)) * plotW;

  // zero line, when zero is in range
  if (lo < 0 && hi > 0) {
    ctx.strokeStyle = '#243040';
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(plotW, y(0)); ctx.stroke();
  }

  const maxDelta = Math.max(1, ...series.map((p) => Math.abs(p.delta)));
  const bw = Math.max(1, plotW / series.length - 1);
  series.forEach((p, i) => {
    const barH = (Math.abs(p.delta) / maxDelta) * 20;
    ctx.fillStyle = p.delta >= 0 ? 'rgba(38,166,154,.5)' : 'rgba(239,83,80,.5)';
    ctx.fillRect(x(i) - bw / 2, h - 22, bw, -barH);
  });

  ctx.strokeStyle = '#8b7cf6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  series.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.cvd)) : ctx.moveTo(x(i), y(p.cvd))));
  ctx.stroke();

  // live value including the working bar
  const liveY = y(state.cvdLive ?? vals[vals.length - 1]);
  ctx.fillStyle = '#8b7cf6';
  ctx.beginPath(); ctx.arc(plotW - 2, liveY, 2.5, 0, Math.PI * 2); ctx.fill();

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = '#6b7889';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(fmtQty(hi), plotW + 6, y(hi) + 4);
  ctx.fillText(fmtQty(lo), plotW + 6, y(lo) - 4);
  ctx.fillStyle = '#8b7cf6';
  ctx.fillText(`CVD ${fmtQty(state.cvdLive ?? 0)}`, plotW + 6, 10);
  ctx.fillStyle = '#4d5a6b';
  ctx.fillText('per-bar delta', plotW + 6, h - 10);
}

/**
 * Depth ladder. Bar length is resting size; the marker is where trades are
 * actually happening, which is the part a plain DOM hides.
 */
export function drawLadder(canvas, state) {
  const { ctx, w, h } = prep(canvas);
  const book = state.book;
  if (!book?.bids?.length || !book?.asks?.length) return;

  // Fewer levels, each tall enough to read: a ladder you cannot read is décor.
  const levels = Math.max(5, Math.min(12, Math.floor(h / 16)));
  const asks = book.asks.slice(0, levels).reverse();
  const bids = book.bids.slice(0, levels);
  const all = [...asks, ...bids];
  const rowH = h / all.length;
  const max = Math.max(1, ...all.map(([, q]) => q));
  const priceW = 62;

  const tapeAt = new Map();
  for (const t of state.tape.slice(-150)) {
    tapeAt.set(t.price, (tapeAt.get(t.price) ?? 0) + t.qty);
  }
  const maxTape = Math.max(1, ...tapeAt.values());

  ctx.font = `${Math.min(11, Math.max(8, rowH - 4))}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  all.forEach(([price, qty], i) => {
    const y = i * rowH;
    const isAsk = i < asks.length;
    const barW = (qty / max) * (w - priceW - 4);
    ctx.fillStyle = isAsk ? 'rgba(239,83,80,.28)' : 'rgba(38,166,154,.28)';
    ctx.fillRect(priceW, y + 1, barW, rowH - 2);

    const traded = tapeAt.get(price);
    if (traded) {
      ctx.fillStyle = '#f0b429';
      ctx.fillRect(priceW - 3, y + 1, 2, rowH - 2);
      ctx.fillStyle = 'rgba(240,180,41,.75)';
      ctx.fillRect(w - 3 - (traded / maxTape) * 16, y + rowH / 2 - 1, (traded / maxTape) * 16, 2);
    }

    ctx.fillStyle = isAsk ? '#c26b68' : '#5fbdb2';
    ctx.textAlign = 'right';
    ctx.fillText(fmtPrice(price), priceW - 8, y + rowH / 2);
    ctx.fillStyle = '#8492a5';
    ctx.textAlign = 'left';
    ctx.fillText(fmtQty(qty), priceW + 4, y + rowH / 2);
  });

  // the touch
  ctx.strokeStyle = '#2d3a4d';
  const midY = asks.length * rowH;
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
}

/** Net dealer gamma by strike, spot marked, walls and flip annotated. */
export function drawGex(canvas, state) {
  const { ctx, w, h } = prep(canvas);
  const g = state.gamma;
  if (!g?.strikes?.length) {
    ctx.fillStyle = '#4d5a6b';
    ctx.font = '11px sans-serif';
    ctx.fillText('waiting for options data…', 8, 20);
    return;
  }
  const spot = state.last?.price || g.spot;
  const near = g.strikes.filter((s) => Math.abs(s.strike - spot) < spot * 0.16);
  const strikes = (near.length > 4 ? near : g.strikes);
  const max = Math.max(...strikes.map((s) => Math.abs(s.netGex))) || 1;
  const rowH = Math.max(3, h / strikes.length);
  const midX = w * 0.42;

  const sorted = [...strikes].sort((a, b) => b.strike - a.strike);
  ctx.font = '9px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  sorted.forEach((s, i) => {
    const y = i * rowH;
    const len = (Math.abs(s.netGex) / max) * (w - midX - 40);
    ctx.fillStyle = s.netGex >= 0 ? 'rgba(38,166,154,.65)' : 'rgba(239,83,80,.65)';
    if (s.netGex >= 0) ctx.fillRect(midX, y + 1, len, rowH - 1.5);
    else ctx.fillRect(midX - len, y + 1, len, rowH - 1.5);
    if (rowH >= 8) {
      ctx.fillStyle = '#6b7889';
      ctx.textAlign = 'right';
      ctx.fillText(fmtPrice(s.strike), midX - 4, y + rowH / 2);
    }
  });

  ctx.strokeStyle = '#243040';
  ctx.beginPath(); ctx.moveTo(midX, 0); ctx.lineTo(midX, h); ctx.stroke();

  const yOfPrice = (p) => {
    const hi = sorted[0].strike, lo = sorted[sorted.length - 1].strike;
    return ((hi - p) / (hi - lo || 1)) * h;
  };
  const mark = (price, color, label) => {
    if (!Number.isFinite(price)) return;
    const y = yOfPrice(price);
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, 3, y - 5);
  };
  mark(spot, '#d8e0ea', 'spot');
  if (g.gammaFlip) mark(g.gammaFlip, '#f0b429', 'flip');
}
