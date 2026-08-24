import { config } from '../config.js';

/**
 * Iceberg / refreshing-wall detection.
 *
 * An iceberg shows a small displayed size but keeps replenishing after it is
 * hit. We measure it directly: volume actually traded at the level versus the
 * largest size ever displayed there. When traded volume is several multiples
 * of anything shown, the rest of the order was hidden.
 */
export class IcebergDetector {
  constructor(opts = {}) {
    this.cfg = { ...config.iceberg, ...opts };
    this.reported = new Map();   // price -> ts
    this.walls = [];
    this.sizes = [];             // rolling sample of displayed level sizes
  }

  /** Called after each trade with the book level it consumed. */
  onLevel(level, price, side, ts) {
    if (!level || level.maxDisplayed <= 0) return null;

    // A tiny level traded through a few times is not an iceberg, it is a tiny
    // level. Require the displayed size to be meaningful for this instrument.
    this.sizes.push(level.maxDisplayed);
    if (this.sizes.length > 500) this.sizes.shift();
    if (this.sizes.length >= 30) {
      const sorted = [...this.sizes].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (level.maxDisplayed < median * 0.75) return null;
    }
    const hidden = level.traded - level.maxDisplayed;
    const multiple = level.traded / level.maxDisplayed;

    if (level.refills < this.cfg.minRefills) return null;
    if (multiple < this.cfg.hiddenMultiple) return null;

    const last = this.reported.get(price);
    if (last !== undefined && ts - last < this.cfg.reportCooldownMs) return null;
    this.reported.set(price, ts);

    const evt = {
      type: 'iceberg',
      ts, price, side,                       // side = which side of the book is hiding
      bias: side === 'bid' ? 'bullish' : 'bearish',
      displayed: level.maxDisplayed,
      traded: level.traded,
      hidden: Math.max(0, hidden),
      refills: level.refills,
      strength: Math.min(1, multiple / (this.cfg.hiddenMultiple * 3)),
      note: `${side} refreshed ${level.refills}x, ${multiple.toFixed(1)}x its shown size`,
    };
    this._trackWall(evt);
    return evt;
  }

  _trackWall(evt) {
    const existing = this.walls.find((w) => w.price === evt.price);
    if (existing) Object.assign(existing, evt);
    else this.walls.push({ ...evt });
    const cutoff = evt.ts - this.cfg.ttlMs;
    this.walls = this.walls.filter((w) => w.ts >= cutoff).slice(-40);
  }

  activeWalls(now = Date.now()) {
    return this.walls.filter((w) => now - w.ts < this.cfg.ttlMs);
  }
}
