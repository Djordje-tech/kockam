import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { Ring } from '../core/ring.js';
import { OrderBook } from '../core/orderBook.js';
import { TradeClassifier } from '../core/tradeClassifier.js';
import { toRow } from '../core/prices.js';
import { FootprintBuilder, serializeBar } from './footprint.js';
import { CvdTracker } from './cvd.js';
import { VolumeProfile, NakedPocTracker } from './volumeProfile.js';
import { AbsorptionDetector } from './absorption.js';
import { IcebergDetector } from './iceberg.js';
import { StopRunDetector } from './stopRun.js';
import { RejectionDetector } from './rejection.js';
import { computeGex } from './gamma.js';
import { SignalScorer } from './scorer.js';
import { SessionManager } from './sessions.js';

/**
 * The orchestrator: one trade in, every derived view out.
 *
 * Detectors are deliberately independent — each one owns its own state and
 * returns events rather than mutating shared structures — so a new detector is
 * a file plus two lines here, and a misbehaving one can be switched off
 * without touching the rest of the pipeline.
 */
export class OrderFlowEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.symbol = opts.symbol ?? config.symbol;
    this.book = new OrderBook();
    this.bars = new Ring(config.bar.maxBars);
    this.footprint = new FootprintBuilder();
    this.cvd = new CvdTracker();
    this.sessionProfile = new VolumeProfile('session');
    this.nakedPocs = new NakedPocTracker();
    this.absorption = new AbsorptionDetector();
    this.iceberg = new IcebergDetector();
    this.stopRun = new StopRunDetector();
    this.rejection = new RejectionDetector();
    this.scorer = new SignalScorer({ file: opts.statsFile });
    // Crypto venues stamp the aggressor on every print; dxFeed only does when
    // entitled, so the side is resolved here for every feed alike and the
    // resolution quality is published with the data it produced.
    this.classifier = new TradeClassifier(opts.classifier);

    this.gex = null;
    this.signals = new Ring(300);
    this.tape = new Ring(3000);
    this.last = { price: 0, ts: 0 };
    this.sessions = new SessionManager({ group: opts.group ?? 'equityIndex' });
    this.dayStats = { buyVolume: 0, sellVolume: 0 };
    this.instrument = null;
    this._levelTick = 0;
  }

  /** What the feed actually connected to, for the header and the row sizing. */
  setInstrument(info) {
    this.instrument = info;
  }

  // ---- ingestion -------------------------------------------------------

  onQuote(q) {
    this.classifier.onQuote(q);
    this.quote = q;
  }

  onTrade(raw) {
    const t = { ...raw, side: this.classifier.classify(raw) };
    this.last = { price: t.price, ts: t.ts };
    this.tape.push(t);
    this.dayStats[t.side === 'buy' ? 'buyVolume' : 'sellVolume'] += t.qty;

    const rolled = this.sessions.onTrade(t);
    if (rolled) this._onSessionRoll(rolled);
    this._trackExtremes(t);

    const level = this.book.recordTrade(t.price, t.qty);
    this.sessionProfile.onTrade(t);
    this.nakedPocs.onPrice(t.price);

    const { closed, bar } = this.footprint.onTrade(t);
    if (closed) this._onBarClose(closed);

    // Detectors that read the tape directly.
    const abs = this.absorption.onTrade(t, this.book);
    if (abs) this._emitSignal(abs);
    for (const b of this.absorption.onPriceUpdate(t.price, t.ts)) this._emitSignal(b);

    const bookSide = t.side === 'buy' ? 'ask' : 'bid';   // the passive side that got hit
    const ice = this.iceberg.onLevel(level, t.price, bookSide, t.ts);
    if (ice) this._emitSignal(ice);

    for (const e of this.stopRun.onTrade(t)) this._emitSignal(e);

    for (const r of this.scorer.onPrice(t.price, t.ts)) {
      this.emit('outcome', r);
    }

    this.emit('trade', { trade: t, bar: serializeBar(bar) });
  }

  onDepth(update) {
    if (update.snapshot) this.book.applySnapshot(update);
    else this.book.applyDiff(update);
    if (Math.random() < 0.01) this.book.pruneLevels(config.iceberg.ttlMs, update.ts ?? Date.now());
  }

  onOptionsChain(chain, spot) {
    const gex = computeGex(chain, spot ?? this.last.price ?? 0);
    if (!gex) return;
    this.gex = gex;
    for (const lvl of gex.levels) {
      this.stopRun.setReferenceLevel(`gex:${lvl.kind}`, lvl.price, `${lvl.label} (${lvl.kind.includes('all') || lvl.price > this.last.price ? 'high' : 'low'})`);
    }
    this.emit('gamma', gex);
  }

  // ---- derived ---------------------------------------------------------

  /**
   * The running extremes are their own stop pools, separate from the named
   * levels the session manager publishes, and they move intraday.
   */
  _trackExtremes(t) {
    const s = this.sessions.current;
    if (!s) return;
    if (t.price >= s.high) this.stopRun.setReferenceLevel('sessionHigh', s.high, 'session high');
    if (t.price <= s.low) this.stopRun.setReferenceLevel('sessionLow', s.low, 'session low');
    if (++this._levelTick % 500 === 0) this._publishSessionLevels();
  }

  /**
   * A new trading day: yesterday's profile becomes reference rather than being
   * thrown away, and the statistics that are only meaningful within a session
   * — profile, cumulative delta, VWAP — start again.
   */
  _onSessionRoll(prior) {
    if (prior.valueArea) {
      this.nakedPocs.addSessionPoc(prior.valueArea.poc, Date.now());
    }
    this.sessionProfile = new VolumeProfile(this.sessions.dayKey ?? 'session');
    // Cumulative delta is a within-session statistic: carrying it across the
    // Globex open would make every divergence measured against yesterday.
    this.cvd.value = 0;
    this.dayStats = { buyVolume: 0, sellVolume: 0 };
    this._publishSessionLevels();
    this.emit('sessionRoll', prior);
  }

  _publishSessionLevels() {
    for (const lvl of this.sessions.referenceLevels()) {
      // The sweep detector decides direction from the label, so the names have
      // to say which side of price a level represents.
      const side = /high|HIGH|H$|VAH|ONH|IBH/.test(lvl.code) ? 'high'
                 : /low|LOW|L$|VAL|ONL|IBL/.test(lvl.code) ? 'low'
                 : lvl.price > this.last.price ? 'high' : 'low';
      this.stopRun.setReferenceLevel(`ref:${lvl.code}`, lvl.price, `${lvl.label} (${side})`);
    }
  }

  _onBarClose(bar) {
    this.bars.push(bar);
    this.cvd.onBarClose(bar);

    const div = this.cvd.detectDivergence();
    if (div) {
      this._emitSignal({
        type: 'cvdDivergence', ts: bar.endTs, price: bar.close,
        bias: div.type, strength: 0.6, note: div.note,
      });
    }

    const rejections = this.rejection.onBarClose(bar);
    if (rejections) for (const r of rejections) this._emitSignal(r);

    for (const zone of bar.stacked) {
      this._emitSignal({
        type: 'stackedImbalance', ts: bar.endTs,
        price: zone.side === 'buy' ? zone.low : zone.high,
        bias: zone.side === 'buy' ? 'bullish' : 'bearish',
        strength: Math.min(1, zone.count / 6),
        note: `${zone.count} stacked ${zone.side} imbalances`,
      });
      this.stopRun.setReferenceLevel(
        `stack:${bar.seq}:${zone.fromRow}`,
        zone.side === 'buy' ? zone.low : zone.high,
        zone.side === 'buy' ? 'stacked bid low' : 'stacked offer high',
      );
    }

    this.stopRun.updatePivots(this.bars.toArray());
    this.emit('bar', serializeBar(bar));
  }

  _emitSignal(sig) {
    this.scorer.track(sig);
    this.signals.push(sig);
    this.emit('signal', sig);
  }

  tick(now = Date.now()) {
    const closed = this.footprint.rollIfStale(now);
    if (closed) this._onBarClose(closed);
  }

  // ---- publishing ------------------------------------------------------

  snapshot() {
    const openBar = this.footprint.current;
    return {
      symbol: this.symbol,
      ts: Date.now(),
      config: {
        tickSize: config.tickSize,
        tickAggregation: config.tickAggregation,
        barMs: config.bar.intervalMs,
      },
      last: this.last,
      quote: this.quote ?? null,
      sideQuality: this.classifier.quality(),
      instrument: this.instrument ?? null,
      session: this.sessions.snapshot().session ?? { high: null, low: null, volume: 0 },
      sessions: this.sessions.snapshot(),
      dayStats: this.dayStats,
      bars: this.bars.toArray().map(serializeBar),
      openBar: openBar ? serializeBar(openBar) : null,
      cvd: { value: this.cvd.liveValue(openBar), series: this.cvd.series.toArray() },
      profile: this.sessionProfile.serialize(),
      nakedPocs: this.nakedPocs.naked(),
      book: this.bookSnapshot(),
      gamma: this.gex,
      signals: this.signals.toArray().slice(-60),
      absorptionZones: this.absorption.activeZones(),
      icebergWalls: this.iceberg.activeWalls(),
      referenceLevels: this.stopRun.referenceLevels(),
      signalStats: this.scorer.table(),
      tape: this.tape.toArray().slice(-120),
    };
  }

  bookSnapshot(depth = 40) {
    return {
      ts: this.book.ts,
      bids: this.book.topBids(depth),
      asks: this.book.topAsks(depth),
      bestBid: this.book.bestBid(),
      bestAsk: this.book.bestAsk(),
      pressure: this.book.bookPressure(20),
      rows: [...this.book.rowLiquidity(120).values()],
    };
  }
}
