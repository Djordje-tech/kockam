import { config } from '../config.js';
import { toRow, rowToPrice } from '../core/prices.js';

/**
 * Footprint (a.k.a. cluster / bid-ask) bars.
 *
 * Each bar keeps, per price row, the volume that traded into the bid
 * (aggressive sellers) and into the ask (aggressive buyers). Everything the
 * chart shows above candles — delta, POC, diagonal imbalances, stacked zones,
 * delta extremes — is derived from that one table.
 */
export class FootprintBuilder {
  constructor(opts = {}) {
    this.intervalMs = opts.intervalMs ?? config.bar.intervalMs;
    this.cfg = { ...config.footprint, ...opts };
    this.current = null;
    this.seq = 0;
  }

  static newBar(startTs, intervalMs, price, seq) {
    return {
      seq,
      startTs,
      endTs: startTs + intervalMs,
      open: price, high: price, low: price, close: price,
      volume: 0, trades: 0,
      delta: 0, maxDelta: 0, minDelta: 0,
      buyVolume: 0, sellVolume: 0,
      rows: new Map(),      // row -> { row, bid, ask, trades }
      poc: null,
      imbalances: [],
      stacked: [],
      closed: false,
    };
  }

  bucketStart(ts) {
    return Math.floor(ts / this.intervalMs) * this.intervalMs;
  }

  /**
   * @param {{ts:number, price:number, qty:number, side:'buy'|'sell'}} t
   * @returns {{closed: object|null, bar: object}}
   */
  onTrade(t) {
    let closed = null;
    const start = this.bucketStart(t.ts);
    if (!this.current) {
      this.current = FootprintBuilder.newBar(start, this.intervalMs, t.price, this.seq++);
    } else if (start >= this.current.endTs) {
      closed = this.finalize(this.current);
      this.current = FootprintBuilder.newBar(start, this.intervalMs, t.price, this.seq++);
    }

    const bar = this.current;
    bar.close = t.price;
    if (t.price > bar.high) bar.high = t.price;
    if (t.price < bar.low) bar.low = t.price;
    bar.volume += t.qty;
    bar.trades++;

    const row = toRow(t.price);
    let cell = bar.rows.get(row);
    if (!cell) bar.rows.set(row, (cell = { row, bid: 0, ask: 0, trades: 0 }));
    cell.trades++;

    if (t.side === 'buy') {          // lifted the offer
      cell.ask += t.qty;
      bar.buyVolume += t.qty;
      bar.delta += t.qty;
    } else {                          // hit the bid
      cell.bid += t.qty;
      bar.sellVolume += t.qty;
      bar.delta -= t.qty;
    }
    if (bar.delta > bar.maxDelta) bar.maxDelta = bar.delta;
    if (bar.delta < bar.minDelta) bar.minDelta = bar.delta;

    return { closed, bar };
  }

  /** Force-close the working bar when the clock passes it with no prints. */
  rollIfStale(now) {
    if (this.current && now >= this.current.endTs) {
      const closed = this.finalize(this.current);
      this.current = null;
      return closed;
    }
    return null;
  }

  finalize(bar) {
    bar.closed = true;
    bar.poc = this.pointOfControl(bar);
    bar.imbalances = this.diagonalImbalances(bar);
    bar.stacked = this.stackedZones(bar.imbalances);
    bar.deltaFinish = bar.delta;
    // Delta divergence within the bar: price closed up but delta rolled over
    // from its high (or the mirror). A cheap, surprisingly durable filter.
    bar.deltaDivergence =
      (bar.close > bar.open && bar.delta < bar.maxDelta * 0.4) ? 'bearish' :
      (bar.close < bar.open && bar.delta > bar.minDelta * 0.4) ? 'bullish' : null;
    return bar;
  }

  pointOfControl(bar) {
    let best = null, bestVol = -1;
    for (const cell of bar.rows.values()) {
      const v = cell.bid + cell.ask;
      if (v > bestVol) { bestVol = v; best = cell.row; }
    }
    return best;
  }

  /**
   * Diagonal imbalance, the standard footprint reading: aggressive buying at a
   * row is compared with aggressive selling one row below it, because those two
   * met the same resting book. A buy imbalance needs ask[row] >= ratio * bid[row-1].
   */
  diagonalImbalances(bar) {
    const { imbalanceRatio: ratio, minImbalanceVol: minVol } = this.cfg;
    const out = [];
    for (const cell of bar.rows.values()) {
      const below = bar.rows.get(cell.row - 1);
      const above = bar.rows.get(cell.row + 1);

      const bidBelow = below?.bid ?? 0;
      if (cell.ask >= minVol && cell.ask >= ratio * Math.max(bidBelow, minVol * 0.25)) {
        out.push({ row: cell.row, side: 'buy', volume: cell.ask,
                   ratio: bidBelow ? cell.ask / bidBelow : 99 });
      }
      const askAbove = above?.ask ?? 0;
      if (cell.bid >= minVol && cell.bid >= ratio * Math.max(askAbove, minVol * 0.25)) {
        out.push({ row: cell.row, side: 'sell', volume: cell.bid,
                   ratio: askAbove ? cell.bid / askAbove : 99 });
      }
    }
    return out.sort((a, b) => a.row - b.row);
  }

  /** Runs of >= stackedMin consecutive same-side imbalanced rows. */
  stackedZones(imbalances) {
    const zones = [];
    for (const side of ['buy', 'sell']) {
      const rows = imbalances.filter((i) => i.side === side).map((i) => i.row);
      let run = [];
      for (let i = 0; i < rows.length; i++) {
        if (run.length === 0 || rows[i] === run[run.length - 1] + 1) run.push(rows[i]);
        else { this._pushZone(zones, run, side); run = [rows[i]]; }
      }
      this._pushZone(zones, run, side);
    }
    return zones;
  }

  _pushZone(zones, run, side) {
    if (run.length >= this.cfg.stackedMin) {
      zones.push({
        side,
        fromRow: run[0],
        toRow: run[run.length - 1],
        count: run.length,
        low: rowToPrice(run[0]),
        high: rowToPrice(run[run.length - 1]),
      });
    }
  }
}

/** Wire-friendly bar: Maps are useless over JSON. */
export const serializeBar = (bar) => ({
  seq: bar.seq,
  startTs: bar.startTs,
  endTs: bar.endTs,
  open: bar.open, high: bar.high, low: bar.low, close: bar.close,
  volume: bar.volume, trades: bar.trades,
  delta: bar.delta, maxDelta: bar.maxDelta, minDelta: bar.minDelta,
  buyVolume: bar.buyVolume, sellVolume: bar.sellVolume,
  poc: bar.poc,
  closed: bar.closed,
  deltaDivergence: bar.deltaDivergence ?? null,
  imbalances: bar.imbalances,
  stacked: bar.stacked,
  rows: [...bar.rows.values()],
});
