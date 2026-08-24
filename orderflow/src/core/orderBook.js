import { toRow } from './prices.js';

/**
 * L2 book kept as two price->size maps plus a lazily rebuilt sorted view.
 *
 * On top of plain depth it tracks, per price level, how much aggressive volume
 * has traded there and how many times the level was replenished afterwards.
 * That per-level history is what iceberg and absorption detection read.
 */
export class OrderBook {
  constructor() {
    this.bids = new Map();      // price -> size
    this.asks = new Map();
    this.levels = new Map();    // price -> { maxDisplayed, traded, refills, lastSize, firstSeen, lastSeen }
    this.lastUpdateId = 0;
    this.ts = 0;
    this._dirty = true;
    this._sortedBids = [];
    this._sortedAsks = [];
  }

  applySnapshot({ bids = [], asks = [], lastUpdateId = 0, ts = Date.now() }) {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of bids) this._set(this.bids, +p, +q);
    for (const [p, q] of asks) this._set(this.asks, +p, +q);
    this.lastUpdateId = lastUpdateId;
    this.ts = ts;
    this._dirty = true;
  }

  applyDiff({ bids = [], asks = [], ts = Date.now() }) {
    for (const [p, q] of bids) this._set(this.bids, +p, +q);
    for (const [p, q] of asks) this._set(this.asks, +p, +q);
    this.ts = ts;
    this._dirty = true;
  }

  _set(side, price, size) {
    if (size <= 0) side.delete(price);
    else side.set(price, size);
    this._touch(price, size);
  }

  _touch(price, size) {
    let lvl = this.levels.get(price);
    if (!lvl) {
      lvl = {
        price,
        maxDisplayed: 0,
        traded: 0,
        refills: 0,
        refillMark: 0,
        depleted: false,
        lastSize: 0,
        firstSeen: this.ts,
        lastSeen: this.ts,
      };
      this.levels.set(price, lvl);
    }
    // A replenish is a real round trip, not a tick up in displayed size: the
    // level has to be eaten down to well under its own high-water mark and
    // then come back near it, with volume having traded there in between.
    // Counting every size increase instead — the obvious implementation —
    // turns ordinary quote flicker into a stream of fake icebergs.
    if (size < lvl.maxDisplayed * 0.5) lvl.depleted = true;
    if (lvl.depleted && size >= lvl.maxDisplayed * 0.8 && lvl.traded > lvl.refillMark) {
      lvl.refills++;
      lvl.refillMark = lvl.traded;
      lvl.depleted = false;
    }
    lvl.maxDisplayed = Math.max(lvl.maxDisplayed, size);
    lvl.lastSize = size;
    lvl.lastSeen = this.ts;
  }

  /** Called by the tape so levels know how much was actually eaten there. */
  recordTrade(price, qty) {
    let lvl = this.levels.get(price);
    if (!lvl) {
      lvl = { price, maxDisplayed: 0, traded: 0, refills: 0, refillMark: 0,
              depleted: false, lastSize: 0, firstSeen: this.ts, lastSeen: this.ts };
      this.levels.set(price, lvl);
    }
    lvl.traded += qty;
    lvl.lastSeen = this.ts;
    return lvl;
  }

  pruneLevels(olderThanMs, now = Date.now()) {
    for (const [price, lvl] of this.levels) {
      if (now - lvl.lastSeen > olderThanMs && !this.bids.has(price) && !this.asks.has(price)) {
        this.levels.delete(price);
      }
    }
  }

  _rebuild() {
    if (!this._dirty) return;
    this._sortedBids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]);
    this._sortedAsks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]);
    this._dirty = false;
  }

  bestBid() { this._rebuild(); return this._sortedBids[0]?.[0] ?? 0; }
  bestAsk() { this._rebuild(); return this._sortedAsks[0]?.[0] ?? 0; }
  mid() {
    const b = this.bestBid(), a = this.bestAsk();
    return b && a ? (b + a) / 2 : b || a;
  }
  spread() { return this.bestAsk() - this.bestBid(); }

  topBids(n) { this._rebuild(); return this._sortedBids.slice(0, n); }
  topAsks(n) { this._rebuild(); return this._sortedAsks.slice(0, n); }

  /** Resting size on a side, bucketed into footprint rows. */
  rowLiquidity(depth = 60) {
    this._rebuild();
    const rows = new Map();
    const add = (price, size, side) => {
      const r = toRow(price);
      let e = rows.get(r);
      if (!e) rows.set(r, (e = { row: r, bid: 0, ask: 0 }));
      e[side] += size;
    };
    for (const [p, q] of this._sortedBids.slice(0, depth)) add(p, q, 'bid');
    for (const [p, q] of this._sortedAsks.slice(0, depth)) add(p, q, 'ask');
    return rows;
  }

  /** Imbalance of resting size within n rows of the touch: +1 bid heavy, -1 ask heavy. */
  bookPressure(depth = 20) {
    this._rebuild();
    let b = 0, a = 0;
    for (const [, q] of this._sortedBids.slice(0, depth)) b += q;
    for (const [, q] of this._sortedAsks.slice(0, depth)) a += q;
    const t = b + a;
    return t ? (b - a) / t : 0;
  }
}
