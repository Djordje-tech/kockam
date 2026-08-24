import { config } from '../config.js';
import { toRow, rowToPrice } from '../core/prices.js';
import { Ring } from '../core/ring.js';

/**
 * Stop-run (liquidity sweep) detection.
 *
 * Resting stops cluster just past obvious levels — swing pivots, the session
 * and prior-session extremes, the opening range. A stop run pokes through one
 * of those on a burst of aggression and then fails to hold the break.
 *
 * We publish two things, deliberately at different confidence levels:
 *   - `stopRunArmed`  : the sweep is happening right now (early, less certain)
 *   - `stopRun`       : price reclaimed the level (confirmed reversal)
 */
export class StopRunDetector {
  constructor(opts = {}) {
    this.cfg = { ...config.stopRun, ...opts };
    this.levels = new Map();     // key -> { price, kind, label }
    this.armed = [];
    this.recentVol = new Ring(2000);
  }

  setReferenceLevel(key, price, label) {
    if (!Number.isFinite(price)) return;
    this.levels.set(key, { key, price, label, row: toRow(price) });
  }

  /** Refresh swing pivots from closed bars. */
  updatePivots(bars) {
    const n = this.cfg.pivotLookback;
    if (bars.length < n * 2 + 1) return;
    for (let i = bars.length - n - 1; i >= Math.max(n, bars.length - 40); i--) {
      const b = bars[i];
      let isHigh = true, isLow = true;
      for (let j = i - n; j <= i + n; j++) {
        if (j === i || j < 0 || j >= bars.length) continue;
        if (bars[j].high >= b.high) isHigh = false;
        if (bars[j].low <= b.low) isLow = false;
      }
      if (isHigh) this.setReferenceLevel(`ph:${b.seq}`, b.high, 'swing high');
      if (isLow) this.setReferenceLevel(`pl:${b.seq}`, b.low, 'swing low');
    }
    // Keep the map bounded: the freshest 40 pivots plus any named levels.
    const pivots = [...this.levels.values()].filter((l) => l.key.startsWith('p'));
    if (pivots.length > 40) {
      for (const l of pivots.slice(0, pivots.length - 40)) this.levels.delete(l.key);
    }
  }

  _volumeBurst(ts) {
    let recent = 0, baseline = 0, baseN = 0;
    const burstFrom = ts - this.cfg.burstMs;
    const baseFrom = ts - this.cfg.burstMs * 10;
    this.recentVol.scanBack((e) => {
      if (!e || e.ts < baseFrom) return false;
      if (e.ts >= burstFrom) recent += e.qty;
      else { baseline += e.qty; baseN++; }
      return true;
    });
    if (!baseN) return { ratio: 0, recent };
    const baseRate = baseline / 9;   // baseline window is 9x the burst window
    return { ratio: baseRate ? recent / baseRate : 0, recent };
  }

  onTrade(t) {
    this.recentVol.push({ ts: t.ts, qty: t.qty });
    const row = toRow(t.price);
    const events = [];

    for (const lvl of this.levels.values()) {
      const dist = row - lvl.row;
      const isHigh = lvl.label.includes('high');
      const swept = isHigh ? dist > 0 && dist <= this.cfg.sweepTicks
                           : dist < 0 && -dist <= this.cfg.sweepTicks;
      if (!swept) continue;
      if (this.armed.some((a) => a.key === lvl.key && !a.resolved)) continue;

      const burst = this._volumeBurst(t.ts);
      if (burst.ratio < this.cfg.burstMultiple) continue;

      const armed = {
        key: lvl.key, label: lvl.label, level: lvl.price, row: lvl.row,
        direction: isHigh ? 'up' : 'down',
        ts: t.ts, extreme: t.price, burst: burst.ratio, resolved: false,
      };
      this.armed.push(armed);
      events.push({
        type: 'stopRunArmed', ts: t.ts, price: t.price, level: lvl.price,
        bias: isHigh ? 'bearish' : 'bullish',
        confidence: 'early',
        strength: Math.min(1, burst.ratio / (this.cfg.burstMultiple * 2)),
        note: `sweeping ${lvl.label} on ${burst.ratio.toFixed(1)}x volume burst`,
      });
    }

    // Resolve anything already armed.
    for (const a of this.armed) {
      if (a.resolved) continue;
      if (a.direction === 'up') a.extreme = Math.max(a.extreme, t.price);
      else a.extreme = Math.min(a.extreme, t.price);

      const reclaimed = a.direction === 'up'
        ? row <= a.row - this.cfg.reclaimTicks
        : row >= a.row + this.cfg.reclaimTicks;

      if (reclaimed) {
        a.resolved = 'reclaimed';
        events.push({
          type: 'stopRun', ts: t.ts, price: t.price, level: a.price ?? a.level,
          bias: a.direction === 'up' ? 'bearish' : 'bullish',
          confidence: 'confirmed',
          extreme: a.extreme,
          sweptBy: Math.abs(toRow(a.extreme) - a.row),
          strength: Math.min(1, a.burst / (this.cfg.burstMultiple * 2)),
          note: `${a.label} swept and reclaimed — trapped breakout traders`,
        });
      } else if (t.ts - a.ts > this.cfg.reclaimMs) {
        a.resolved = 'held';
        events.push({
          type: 'breakoutHeld', ts: t.ts, price: t.price, level: a.level,
          bias: a.direction === 'up' ? 'bullish' : 'bearish',
          confidence: 'confirmed',
          strength: 0.5,
          note: `${a.label} broke and held — continuation, not a sweep`,
        });
      }
    }
    this.armed = this.armed.filter((a) => !a.resolved || t.ts - a.ts < 60_000).slice(-40);
    return events;
  }

  referenceLevels() {
    return [...this.levels.values()].map((l) => ({ price: l.price, label: l.label, key: l.key }));
  }
}
