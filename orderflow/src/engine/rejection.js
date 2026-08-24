import { config } from '../config.js';
import { toRow, rowToPrice } from '../core/prices.js';

/**
 * Tick / wick rejection with order flow confirmation.
 *
 * A long wick on its own is a shape. It becomes information when the volume
 * that printed in the wick was aggressive in the direction of the excursion
 * and price still came back — those aggressors are underwater at the close.
 */
export class RejectionDetector {
  constructor(opts = {}) {
    this.cfg = { ...config.rejection, ...opts };
  }

  /** @param {object} bar finalized footprint bar */
  onBarClose(bar) {
    const range = bar.high - bar.low;
    if (range <= 0 || bar.volume <= 0) return null;

    const body = Math.abs(bar.close - bar.open);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const out = [];

    const check = (wick, side) => {
      if (wick / range < this.cfg.minWickRatio) return;
      const extremeRow = side === 'upper' ? toRow(bar.high) : toRow(bar.low);
      let wickVol = 0, wickDelta = 0;
      for (const cell of bar.rows.values()) {
        const inWick = side === 'upper'
          ? cell.row >= toRow(Math.max(bar.open, bar.close))
          : cell.row <= toRow(Math.min(bar.open, bar.close));
        if (!inWick) continue;
        wickVol += cell.bid + cell.ask;
        wickDelta += cell.ask - cell.bid;
      }
      const share = wickVol / bar.volume;
      if (share < this.cfg.minExtremeVolShare) return;

      // The aggression inside the wick must point the wrong way for whoever
      // chased it: buying into a rejected high, selling into a rejected low.
      const trapped = side === 'upper' ? wickDelta > 0 : wickDelta < 0;
      if (!trapped) return;

      out.push({
        type: 'rejection',
        ts: bar.endTs,
        bias: side === 'upper' ? 'bearish' : 'bullish',
        price: side === 'upper' ? bar.high : bar.low,
        level: rowToPrice(extremeRow),
        wickRatio: wick / range,
        wickVolume: wickVol,
        wickDelta,
        volumeShare: share,
        bodyRatio: body / range,
        strength: Math.min(1, (wick / range) * share * 3),
        note: side === 'upper'
          ? 'high rejected with buyers trapped in the wick'
          : 'low rejected with sellers trapped in the wick',
      });
    };

    check(upperWick, 'upper');
    check(lowerWick, 'lower');
    return out.length ? out : null;
  }
}
