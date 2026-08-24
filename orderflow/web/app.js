import { FootprintChart, fmtQty, fmtPrice } from './chart/footprintChart.js';
import { drawCvd, drawLadder, drawGex } from './chart/panels.js';

/**
 * Client state and transport.
 *
 * The server sends one snapshot on connect and then coalesced frames. Frames
 * carry only what changed, so this module's job is to fold them into a single
 * mutable state object and let the renderer read it once per animation frame —
 * never to re-render on message arrival, which is what makes tick-rate UIs
 * stutter.
 */
const state = {
  symbol: '—',
  config: { tickSize: 1, tickAggregation: 5, barMs: 60000 },
  bars: [], openBar: null,
  cvdSeries: [], cvdLive: 0,
  book: null, tape: [],
  profile: null, gamma: null,
  signals: [], signalStats: [],
  absorptionZones: [], icebergWalls: [], nakedPocs: [], referenceLevels: [],
  last: { price: 0, ts: 0 }, session: {}, dayStats: {},
  sideQuality: null, instrument: null,
  sessions: null,
  toggles: { footprint: true, imbalance: true, profile: true, gammaLevels: true,
             signals: true, liquidity: true, vwap: true, levels: true },
};

const el = (id) => document.getElementById(id);
const chart = new FootprintChart(el('chart'), state);

// ---- transport ----------------------------------------------------------

let ws, retry = 0;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/stream`);
  ws.onopen = () => { retry = 0; setStatus(true); };
  ws.onclose = () => {
    setStatus(false);
    setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') applySnapshot(msg.data);
    else if (msg.type === 'frame') applyFrame(msg);
    else if (msg.type === 'gamma') { state.gamma = msg.data; renderGammaMeta(); }
  };
}

function setStatus(on) {
  const s = el('status');
  s.textContent = on ? 'live' : 'reconnecting';
  s.className = `status ${on ? 'on' : 'off'}`;
}

function applySnapshot(d) {
  state.symbol = d.symbol;
  state.config = d.config;
  state.bars = d.bars;
  state.openBar = d.openBar;
  state.cvdSeries = d.cvd.series;
  state.cvdLive = d.cvd.value;
  state.book = d.book;
  state.tape = d.tape;
  state.profile = d.profile;
  state.gamma = d.gamma;
  state.signals = d.signals;
  state.signalStats = d.signalStats;
  state.absorptionZones = d.absorptionZones;
  state.icebergWalls = d.icebergWalls;
  state.nakedPocs = d.nakedPocs;
  state.referenceLevels = d.referenceLevels;
  state.last = d.last;
  state.session = d.session;
  state.sessions = d.sessions;
  state.dayStats = d.dayStats;
  state.sideQuality = d.sideQuality;
  state.instrument = d.instrument;
  el('sym').textContent = d.symbol;
  renderInstrument();
  renderSignals(); renderStats(); renderGammaMeta();
}

function applyFrame(f) {
  if (f.closedBars?.length) {
    state.bars.push(...f.closedBars);
    if (state.bars.length > 600) state.bars.splice(0, state.bars.length - 600);
    for (const b of f.closedBars) {
      const prev = state.cvdSeries[state.cvdSeries.length - 1]?.cvd ?? 0;
      state.cvdSeries.push({ seq: b.seq, ts: b.startTs, cvd: prev + b.delta,
                             close: b.close, high: b.high, low: b.low, delta: b.delta });
    }
    if (state.cvdSeries.length > 600) state.cvdSeries.splice(0, state.cvdSeries.length - 600);
  }
  if (f.bar) {
    state.openBar = f.bar;
    state.last = { price: f.bar.close, ts: f.ts };
  }
  if (f.book) state.book = f.book;
  if (f.tape?.length) {
    state.tape.push(...f.tape);
    if (state.tape.length > 400) state.tape.splice(0, state.tape.length - 400);
  }
  if (f.cvd !== undefined) state.cvdLive = f.cvd;
  if (f.profile) state.profile = f.profile;
  if (f.referenceLevels) state.referenceLevels = f.referenceLevels;
  if (f.absorptionZones) state.absorptionZones = f.absorptionZones;
  if (f.icebergWalls) state.icebergWalls = f.icebergWalls;
  if (f.session) state.session = f.session;
  if (f.sessions) state.sessions = f.sessions;
  if (f.signals?.length) {
    state.signals.push(...f.signals);
    if (state.signals.length > 200) state.signals.splice(0, state.signals.length - 200);
    renderSignals();
  }
  if (f.signalStats) { state.signalStats = f.signalStats; renderStats(); }
  if (f.sideQuality) state.sideQuality = f.sideQuality;
  if (f.instrument) { state.instrument = f.instrument; renderInstrument(); }
  if (f.outcomes?.length) markOutcomes(f.outcomes);
}

// ---- side panels --------------------------------------------------------

const SIGNAL_NAMES = {
  absorption: 'Absorption',
  absorptionFailed: 'Absorption broke',
  iceberg: 'Iceberg wall',
  stopRun: 'Stop run',
  stopRunArmed: 'Sweep forming',
  breakoutHeld: 'Breakout held',
  rejection: 'Rejection',
  stackedImbalance: 'Stacked imbalance',
  cvdDivergence: 'CVD divergence',
};

function renderSignals() {
  const box = el('signals');
  const recent = state.signals.slice(-40).reverse();
  el('sigcount').textContent = `${state.signals.length} today`;
  box.innerHTML = recent.map((s) => {
    const hit = s.stats?.hitRate;
    const badge = hit == null ? '' :
      `<span class="badge">${Math.round(hit * 100)}% · ${s.stats.wins}/${s.stats.wins + s.stats.losses}</span>`;
    return `<div class="sig ${s.bias}" data-id="${s.id ?? ''}">
      <time>${new Date(s.ts).toLocaleTimeString([], { hour12: false })}</time>
      <div><span class="name">${SIGNAL_NAMES[s.type] ?? s.type}</span>
        <span class="note">${s.note ?? ''}</span></div>
      <div style="text-align:right"><span class="px">${fmtPrice(s.price)}</span><br>${badge}</div>
    </div>`;
  }).join('');
}

function markOutcomes(outcomes) {
  for (const o of outcomes) {
    const node = document.querySelector(`.sig[data-id="${o.id}"]`);
    if (node) node.style.opacity = o.outcome === 'loss' ? 0.45 : 1;
  }
}

function renderStats() {
  const rows = state.signalStats.map((s) => {
    const decided = s.wins + s.losses;
    const pct = s.hitRate == null ? '—' : `${Math.round(s.hitRate * 100)}%`;
    const cls = s.hitRate == null ? '' : s.hitRate >= 0.5 ? 'good' : 'bad';
    return `<tr><td>${SIGNAL_NAMES[s.type] ?? s.type}</td>
      <td class="num">${s.fired}</td>
      <td class="num ${cls}">${pct}</td>
      <td class="num">${decided ? (s.expectancyR ?? 0).toFixed(2) + 'R' : '—'}</td></tr>`;
  }).join('');
  el('stats').querySelector('tbody').innerHTML =
    `<tr><td style="color:#4d5a6b">signal</td><td class="num" style="color:#4d5a6b">n</td>
     <td class="num" style="color:#4d5a6b">hit</td><td class="num" style="color:#4d5a6b">exp</td></tr>` + rows;
}

function renderGammaMeta() {
  const g = state.gamma;
  el('regime').textContent = g ? `${g.regime}` : '—';
  el('regime').style.color = g ? (g.regime === 'positive' ? 'var(--buy)' : 'var(--sell)') : '';
  el('gexmeta').textContent = g
    ? `flip ${fmtPrice(g.gammaFlip)} · ${g.regime === 'positive' ? 'vol suppressed' : 'vol amplified'}`
    : '';
}

function renderInstrument() {
  const i = state.instrument;
  el('contract').textContent = i?.resolved ?? '—';
  el('contract').title = i
    ? `${i.streamerSymbol} · tick ${i.tickSize}${i.expiresAt ? ` · expires ${i.expiresAt.slice(0, 10)}` : ''}`
    : '';
}

/**
 * How the aggressor side was resolved. A footprint built from an entitled
 * aggressor flag and one inferred from the tick rule are not the same claim,
 * and the trader is entitled to know which one they are reading.
 */
function renderSideQuality() {
  const q = state.sideQuality;
  const node = el('sidequality');
  if (!q?.total) { node.textContent = '—'; return; }
  const pct = Math.round(q.confidence * 100);
  const source = q.explicit / q.total > 0.9 ? 'aggressor'
               : q.explicit > 0 ? 'mixed'
               : q.quote / q.total > 0.7 ? 'quote rule'
               : 'inferred';
  node.textContent = `${pct}% ${source}`;
  node.style.color = pct >= 95 ? 'var(--buy)' : pct >= 80 ? 'var(--accent)' : 'var(--sell)';
  el('sidequality-wrap').title =
    `${q.explicit} from the feed's aggressor flag, ${q.quote} by the quote rule, ` +
    `${q.midpoint} split on the midpoint, ${q.tick} by the tick rule`;
}

function renderHeader() {
  renderSideQuality();
  el('last').textContent = fmtPrice(state.last.price);
  const s = state.session;
  el('range').textContent = s.high ? `${fmtPrice(s.low)} – ${fmtPrice(s.high)}` : '—';
  const v = state.sessions?.vwap;
  el('vwap').textContent = v?.vwap ? fmtPrice(v.vwap) : '—';
  if (v?.vwap && state.last.price) {
    // Position relative to VWAP in deviations is the number that matters, not
    // the distance in points, which means nothing without the day's range.
    const devs = v.sigma ? (state.last.price - v.vwap) / v.sigma : 0;
    el('vwap').style.color = devs > 0 ? 'var(--buy)' : 'var(--sell)';
    el('vwap').title = `${devs >= 0 ? '+' : ''}${devs.toFixed(2)}σ from session VWAP`;
  }
  el('cvd').textContent = fmtQty(state.cvdLive ?? 0);
  el('cvd').style.color = (state.cvdLive ?? 0) >= 0 ? 'var(--buy)' : 'var(--sell)';
  const p = state.book?.pressure ?? 0;
  el('pressure').textContent = `${p >= 0 ? '+' : ''}${(p * 100).toFixed(0)}%`;
  el('pressure').style.color = p >= 0 ? 'var(--buy)' : 'var(--sell)';
  el('spread').textContent = state.book
    ? `spread ${fmtPrice(state.book.bestAsk - state.book.bestBid)}` : '';
}

// ---- tooltip ------------------------------------------------------------

function renderTooltip() {
  const tip = el('tooltip');
  const hit = chart.hitTest();
  if (!hit) { tip.style.display = 'none'; return; }
  const { bar, cell, price } = hit;
  const imb = bar.imbalances.find((i) => i.row === hit.row);
  tip.innerHTML = `
    <div style="color:#f0b429">${new Date(bar.startTs).toLocaleTimeString([], { hour12: false })}</div>
    <div>price <b>${fmtPrice(price)}</b></div>
    ${cell ? `<div style="color:#c26b68">bid ${fmtQty(cell.bid)}</div>
              <div style="color:#5fbdb2">ask ${fmtQty(cell.ask)}</div>
              <div>row Δ ${fmtQty(cell.ask - cell.bid)}</div>` : '<div style="color:#4d5a6b">no trades at this row</div>'}
    ${imb ? `<div style="color:${imb.side === 'buy' ? '#26a69a' : '#ef5350'}">${imb.side} imbalance ${imb.ratio.toFixed(1)}x</div>` : ''}
    <hr style="border:0;border-top:1px solid #1d2531;margin:4px 0">
    <div>bar Δ ${fmtQty(bar.delta)} (max ${fmtQty(bar.maxDelta)} / min ${fmtQty(bar.minDelta)})</div>
    <div>vol ${fmtQty(bar.volume)} · ${bar.trades} trades</div>`;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(window.innerWidth - 280, hit.x + 14)}px`;
  tip.style.top = `${Math.min(window.innerHeight - 140, hit.y + 14)}px`;
}

// ---- toggles + loop -----------------------------------------------------

document.querySelectorAll('[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    state.toggles[key] = !state.toggles[key];
    btn.classList.toggle('on', state.toggles[key]);
  });
});

document.addEventListener('keydown', (e) => {
  const map = { f: 'footprint', i: 'imbalance', p: 'profile', g: 'gammaLevels',
                s: 'signals', l: 'liquidity', v: 'vwap', k: 'levels' };
  const key = map[e.key.toLowerCase()];
  if (!key) return;
  state.toggles[key] = !state.toggles[key];
  document.querySelector(`[data-toggle="${key}"]`)?.classList.toggle('on', state.toggles[key]);
});

function loop() {
  chart.draw();
  drawCvd(el('cvdchart'), state);
  drawLadder(el('ladder'), state);
  drawGex(el('gex'), state);
  renderHeader();
  renderTooltip();
  requestAnimationFrame(loop);
}

connect();
requestAnimationFrame(loop);
