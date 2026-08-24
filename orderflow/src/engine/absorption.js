import { config } from '../config.js';
import { toRow, rowToPrice } from '../core/prices.js';

/**
 * Absorption: heavy one-sided aggression at a price that fails to move price.
 *
 * Sellers hitting the bid hard while the bid holds means a passive buyer is
 * absorbing that supply — the aggressors are the ones who end up trapped. The
 * three conditions we require are all necessary; any two of them alone fire
 * constantly on ordinary chop:
 *
 *   1. aggressive volume at the row is a large multiple of the rolling median
 *      row volume (it is genuinely heavy, not just "some" trading),
 *   2. price never travelled more than `maxTicks` rows in the aggressor's
 *      favour while that volume printed (the effort produced no result),
 *   3. resting size on the passive side is still there or was replenished
 *      (someone is actually holding, not just a thin book soaking prints).
 */
export class AbsorptionDetector {
  constructor(opts = {}) {
    this.cfg = { ...config.absorption, ...opts };
    this.rows = new Map();       // row -> accumulator
    this.recentRowVolumes = [];  // rolling sample for the median
    this.lastFire = new Map();   // row -> ts
    this.active = [];            // absorption zones still being watched
  }

  _acc(row, ts) {
    let a = this.rows.get(row);
    if (!a || ts - a.start > this.cfg.windowMs) {
      a = { row, start: ts, buyVol: 0, sellVol: 0, events: 0,
            maxRow: row, minRow: row, lastTs: ts };
      this.rows.set(row, a);
    }
    return a;
  }

  medianRowVolume() {
    if (this.recentRowVolumes.length < 8) return 0;
    const s = [...this.recentRowVolumes].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /** @returns {object|null} an absorption event, if one just qualified */
  onTrade(t, book) {
    const row = toRow(t.price);
    const now = t.ts;

    // Every row accumulator learns how far price got while it was filling.
    for (const a of this.rows.values()) {
      if (now - a.start > this.cfg.windowMs) continue;
      if (row > a.maxRow) a.maxRow = row;
      if (row < a.minRow) a.minRow = row;
    }

    const acc = this._acc(row, now);
    acc.events++;
    acc.lastTs = now;
    if (t.side === 'buy') acc.buyVol += t.qty; else acc.sellVol += t.qty;

    this.recentRowVolumes.push(t.qty);
    if (this.recentRowVolumes.length > 400) this.recentRowVolumes.shift();

    if (acc.events < this.cfg.minEvents) return null;
    // Cooldown applies only to rows that have already reported, otherwise a
    // detector fed timestamps near zero would suppress its own first signal.
    const last = this.lastFire.get(row);
    if (last !== undefined && now - last < this.cfg.cooldownMs) return null;

    const median = this.medianRowVolume();
    if (!median) return null;
    const heavy = median * this.cfg.minEvents * this.cfg.volumeMultiple;

    // Sellers absorbed: heavy selling at the row, price never broke down.
    if (acc.sellVol >= heavy && (row - acc.minRow) <= this.cfg.maxTicks) {
      const restingBid = this._restingSize(book, t.price, 'bid');
      if (restingBid > 0) {
        return this._fire(acc, 'sellersAbsorbed', 'bullish', t, restingBid, median);
      }
    }
    // Buyers absorbed: heavy buying, price never broke up.
    if (acc.buyVol >= heavy && (acc.maxRow - row) <= this.cfg.maxTicks) {
      const restingAsk = this._restingSize(book, t.price, 'ask');
      if (restingAsk > 0) {
        return this._fire(acc, 'buyersAbsorbed', 'bearish', t, restingAsk, median);
      }
    }
    return null;
  }

  _restingSize(book, price, side) {
    if (!book) return 1;
    const rows = book.rowLiquidity(80);
    return rows.get(toRow(price))?.[side] ?? 0;
  }

  _fire(acc, kind, bias, t, resting, median) {
    this.lastFire.set(acc.row, t.ts);
    const aggressive = kind === 'sellersAbsorbed' ? acc.sellVol : acc.buyVol;
    const travel = kind === 'sellersAbsorbed' ? acc.row - acc.minRow : acc.maxRow - acc.row;
    const evt = {
      type: 'absorption',
      kind, bias,
      ts: t.ts,
      price: rowToPrice(acc.row),
      row: acc.row,
      volume: aggressive,
      restingSize: resting,
      ticksTravelled: travel,
      // Strength blends "how heavy" with "how completely it failed to move".
      strength: Math.min(1, (aggressive / (median * this.cfg.minEvents * this.cfg.volumeMultiple)) *
                            (1 - travel / (this.cfg.maxTicks + 1))),
      note: kind === 'sellersAbsorbed'
        ? 'aggressive selling absorbed by a resting bid'
        : 'aggressive buying absorbed by a resting offer',
    };
    this.active.push({ ...evt, broken: false });
    if (this.active.length > 60) this.active.shift();
    return evt;
  }

  /**
   * An absorption level that later gives way is not noise — it is the stronger
   * signal, because the passive side just capitulated. We surface both.
   */
  onPriceUpdate(price, ts) {
    const row = toRow(price);
    const broken = [];
    for (const z of this.active) {
      if (z.broken) continue;
      const through = z.kind === 'sellersAbsorbed'
        ? row < z.row - this.cfg.maxTicks
        : row > z.row + this.cfg.maxTicks;
      if (through) {
        z.broken = true;
        broken.push({
          type: 'absorptionFailed',
          bias: z.bias === 'bullish' ? 'bearish' : 'bullish',
          // Market time, not wall clock: a signal stamped with the local clock
          // sorts wrongly against every other signal and makes any replay or
          // after-the-fact scoring meaningless.
          ts, price, level: z.price,
          note: 'absorbing side gave up — trapped passive liquidity',
          strength: z.strength,
        });
      }
    }
    return broken;
  }

  activeZones() { return this.active.filter((z) => !z.broken).slice(-20); }
}
