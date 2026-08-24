import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config, applyInstrument, defaultAggregation } from './config.js';
import { OrderFlowEngine } from './engine/engine.js';
import { SimFeed, simOptionsChain } from './feeds/simFeed.js';
import { BinanceFeed } from './feeds/binanceFeed.js';
import { fetchDeribitChain } from './feeds/deribitOptions.js';
import { DxLinkFeed } from './feeds/dxlinkFeed.js';
import { TastytradeApi } from './feeds/tastytradeApi.js';
import { DxLinkOptionsCollector, gammaUnderlyingFor } from './feeds/dxlinkOptions.js';
import { parseSymbol } from './instruments/futures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

const engine = new OrderFlowEngine({
  symbol: config.symbol,
  statsFile: path.join(__dirname, '..', 'data', 'signal-stats.json'),
});

// ---- feed wiring --------------------------------------------------------

let feed;
let optionsCollector = null;

if (config.feed === 'tastytrade' || config.feed === 'dxlink') {
  const api = new TastytradeApi();
  feed = new DxLinkFeed({ api, symbol: config.symbol, depthLimit: config.tastytrade.depthLimit });
  console.log(`[feed] tastytrade / dxFeed  ${config.symbol}`);

  feed.on('instrument', (info) => {
    // The venue decides the tick size and which contract is the front month;
    // row aggregation follows from that rather than from a static default.
    const parsed = parseSymbol(config.symbol);
    applyInstrument({
      tickSize: info.tickSize,
      tickAggregation: defaultAggregation(parsed.spec.group),
      symbol: info.resolved,
    });
    engine.setInstrument(info);
    console.log(`[feed] ${info.requested} -> ${info.resolved} (${info.streamerSymbol}) ` +
                `tick ${info.tickSize}, rows of ${config.tickSize * config.tickAggregation}`);

    const { underlying, futuresProduct } = gammaUnderlyingFor(parsed.product);
    optionsCollector = new DxLinkOptionsCollector({ api, feed, underlying, futuresProduct });
    console.log(`[gamma] dealer gamma from ${futuresProduct ?? underlying} options`);
  });

  feed.on('quote', (q) => engine.onQuote(q));
  feed.on('summary', (e) => optionsCollector?.onSummary(e));
  feed.on('greeks', (e) => optionsCollector?.onGreeks(e));
  feed.on('status', (s) => console.log('[feed]', s.state, s.why ?? s.url ?? ''));
  feed.on('error', (e) => console.error('[feed error]', e.message));
} else if (config.feed === 'binance') {
  feed = new BinanceFeed({ symbol: config.symbol });
  feed.on('status', (s) => console.log('[feed]', s.state, s.why ?? s.url ?? ''));
  console.log(`[feed] binance ${config.symbol} via ${config.binanceWs}`);
  feed.on('error', (e) => console.error('[feed error]', e.message));
} else {
  feed = new SimFeed({ symbol: config.symbol, speed: config.simSpeed });
  console.log(`[feed] simulator at ${config.simSpeed}x real time — "npm run futures" for MNQ/MES/NQ`);
}
feed.on('trade', (t) => engine.onTrade(t));
feed.on('depth', (d) => engine.onDepth(d));
feed.start();

setInterval(() => engine.tick(), 1000).unref();

// ---- options / gamma ----------------------------------------------------

async function refreshGamma() {
  try {
    if (optionsCollector) {
      const spot = engine.last.price;
      if (!spot) return;
      await optionsCollector.refresh(spot);
      const chain = optionsCollector.chain();
      const cov = optionsCollector.coverage();
      if (!chain.length) {
        console.log(`[gamma] waiting for open interest — ${cov.subscribed} contracts subscribed`);
        return;
      }
      engine.onOptionsChain(chain, spot);
      return;
    }
    if (config.optionsFeed === 'deribit') {
      const { chain, spot } = await fetchDeribitChain();
      engine.onOptionsChain(chain, spot || engine.last.price);
    } else {
      const spot = engine.last.price;
      if (spot) engine.onOptionsChain(simOptionsChain(spot), spot);
    }
  } catch (e) {
    console.error('[gamma]', e.message);
  }
}
setTimeout(refreshGamma, 3000);
setInterval(refreshGamma, config.gamma.refreshMs).unref();

// ---- broadcast ----------------------------------------------------------

/**
 * Trades arrive far faster than a browser can paint. Rather than pushing every
 * print we coalesce into one frame per animation budget: the newest bar state,
 * the book, and any signals that fired in between. Signals are never dropped —
 * only redundant intermediate bar states are.
 */
const FRAME_MS = 100;
let frameCounter = 0;
let pendingSignals = [];
let pendingOutcomes = [];
let pendingTape = [];
let dirtyBar = null;
let closedBars = [];

engine.on('trade', ({ trade, bar }) => { dirtyBar = bar; pendingTape.push(trade); });
engine.on('bar', (bar) => closedBars.push(bar));
engine.on('signal', (s) => pendingSignals.push(s));
engine.on('outcome', (o) => pendingOutcomes.push(o));

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', data: engine.snapshot() }));
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'resnapshot') ws.send(JSON.stringify({ type: 'snapshot', data: engine.snapshot() }));
    } catch { /* ignore malformed client frames */ }
  });
});

engine.on('gamma', (g) => broadcast({ type: 'gamma', data: g }));

setInterval(() => {
  if (!clients.size) { pendingSignals = []; pendingOutcomes = []; pendingTape = []; closedBars = []; dirtyBar = null; return; }
  const frame = {
    type: 'frame',
    ts: Date.now(),
    bar: dirtyBar,
    closedBars,
    signals: pendingSignals,
    outcomes: pendingOutcomes,
    tape: pendingTape.slice(-60),
    book: engine.bookSnapshot(30),
    cvd: engine.cvd.liveValue(engine.footprint.current),
    absorptionZones: engine.absorption.activeZones(),
    icebergWalls: engine.iceberg.activeWalls(),
    signalStats: pendingOutcomes.length || pendingSignals.length ? engine.scorer.table() : null,
    session: {
      high: Number.isFinite(engine.session.high) ? engine.session.high : null,
      low: Number.isFinite(engine.session.low) ? engine.session.low : null,
      volume: engine.session.volume,
    },
    profile: frameCounter++ % 20 === 0 ? engine.sessionProfile.serialize(200) : null,
    sideQuality: frameCounter % 10 === 0 ? engine.classifier.quality() : null,
    instrument: frameCounter % 50 === 0 ? engine.instrument : null,
    referenceLevels: frameCounter % 20 === 0 ? engine.stopRun.referenceLevels() : null,
  };
  broadcast(frame);
  dirtyBar = null; closedBars = []; pendingSignals = []; pendingOutcomes = []; pendingTape = [];
}, FRAME_MS).unref();



function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

// ---- http ---------------------------------------------------------------

app.use(express.static(path.join(__dirname, '..', 'web')));
app.get('/api/snapshot', (_req, res) => res.json(engine.snapshot()));
app.get('/api/gamma', (_req, res) => res.json(engine.gex ?? { error: 'no options data yet' }));
app.get('/api/signals', (_req, res) => res.json({
  signals: engine.signals.toArray().slice(-100),
  stats: engine.scorer.table(),
  history: engine.scorer.history.slice(-100),
}));
app.get('/api/health', (_req, res) => res.json({
  ok: true, feed: config.feed, symbol: config.symbol,
  bars: engine.bars.size, lastPrice: engine.last.price, clients: clients.size,
}));

server.listen(config.port, () => {
  console.log(`orderflow terminal  http://localhost:${config.port}  [${config.feed} / ${config.symbol}]`);
});
