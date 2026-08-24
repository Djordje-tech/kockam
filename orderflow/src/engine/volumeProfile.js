import { config } from '../config.js';
import { toRow, rowToPrice } from '../core/prices.js';

/**
 * Session / composite volume profile with value area, HVN-LVN structure and
 * naked (untested) points of control carried forward from previous sessions.
 */
export class VolumeProfile {
  constructor(label = 'session') {
    this.label = label;
    this.rows = new Map();      // row -> { row, bid, ask, total }
    this.total = 0;
    this.startTs = null;
    this.endTs = null;
  }

  onTrade(t) {
    const row = toRow(t.price);
    let cell = this.rows.get(row);
    if (!cell) this.rows.set(row, (cell = { row, bid: 0, ask: 0, total: 0 }));
    if (t.side === 'buy') cell.ask += t.qty; else cell.bid += t.qty;
    cell.total += t.qty;
    this.total += t.qty;
    if (this.startTs === null) this.startTs = t.ts;
    this.endTs = t.ts;
  }

  poc() {
    let best = null, bestVol = -1;
    for (const c of this.rows.values()) {
      if (c.total > bestVol) { bestVol = c.total; best = c; }
    }
    return best;
  }

  /** Classic 70% value area: walk outward from the POC taking the fatter side. */
  valueArea(pct = config.profile.valueAreaPct) {
    const poc = this.poc();
    if (!poc) return null;
    const sorted = [...this.rows.values()].sort((a, b) => a.row - b.row);
    const idx = sorted.findIndex((c) => c.row === poc.row);
    const target = this.total * pct;
    let acc = poc.total, lo = idx, hi = idx;
    while (acc < target && (lo > 0 || hi < sorted.length - 1)) {
      const below = lo > 0 ? sorted[lo - 1].total : -1;
      const above = hi < sorted.length - 1 ? sorted[hi + 1].total : -1;
      if (above >= below) { hi++; acc += sorted[hi].total; }
      else { lo--; acc += sorted[lo].total; }
    }
    return {
      poc: rowToPrice(poc.row),
      val: rowToPrice(sorted[lo].row),
      vah: rowToPrice(sorted[hi].row),
      coverage: this.total ? acc / this.total : 0,
    };
  }

  /**
   * High/low volume nodes from a smoothed profile. LVNs are where price moved
   * fast last time it was there, so they tend to be traversed fast again.
   */
  nodes(smoothing = config.profile.hvnLvnSmoothing) {
    const sorted = [...this.rows.values()].sort((a, b) => a.row - b.row);
    if (sorted.length < smoothing * 2 + 3) return { hvn: [], lvn: [] };
    const smooth = sorted.map((c, i) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - smoothing); j <= Math.min(sorted.length - 1, i + smoothing); j++) {
        sum += sorted[j].total; n++;
      }
      return { row: c.row, v: sum / n };
    });
    const hvn = [], lvn = [];
    const avg = this.total / sorted.length;
    for (let i = 1; i < smooth.length - 1; i++) {
      const [p, c, n] = [smooth[i - 1], smooth[i], smooth[i + 1]];
      if (c.v > p.v && c.v > n.v && c.v > avg * 1.3) hvn.push({ price: rowToPrice(c.row), volume: c.v });
      if (c.v < p.v && c.v < n.v && c.v < avg * 0.6) lvn.push({ price: rowToPrice(c.row), volume: c.v });
    }
    return { hvn, lvn };
  }

  serialize(maxRows = 400) {
    const rows = [...this.rows.values()].sort((a, b) => b.total - a.total).slice(0, maxRows);
    return {
      label: this.label,
      total: this.total,
      startTs: this.startTs,
      endTs: this.endTs,
      rows: rows.sort((a, b) => a.row - b.row),
      valueArea: this.valueArea(),
      nodes: this.nodes(),
    };
  }
}

/** Points of control from prior sessions that price has not traded back to. */
export class NakedPocTracker {
  constructor() { this.pocs = []; }

  addSessionPoc(price, ts) {
    this.pocs.push({ price, ts, tested: false });
    if (this.pocs.length > 40) this.pocs.shift();
  }

  onPrice(price) {
    for (const p of this.pocs) {
      if (!p.tested && Math.abs(toRow(price) - toRow(p.price)) === 0) p.tested = true;
    }
  }

  naked() { return this.pocs.filter((p) => !p.tested); }
}
