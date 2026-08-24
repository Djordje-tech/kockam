import { Ring } from '../core/ring.js';

/**
 * Cumulative volume delta plus divergence against price.
 *
 * The divergence test is the useful part: price printing a higher high while
 * CVD prints a lower high means the buying that lifted price was thinner than
 * the buying that produced the previous high.
 */
export class CvdTracker {
  constructor({ capacity = 600, pivotLookback = 3 } = {}) {
    this.series = new Ring(capacity);
    this.value = 0;
    this.pivotLookback = pivotLookback;
    this.divergences = [];
  }

  onBarClose(bar) {
    this.value += bar.delta;
    this.series.push({
      seq: bar.seq, ts: bar.startTs, cvd: this.value,
      close: bar.close, high: bar.high, low: bar.low, delta: bar.delta,
    });
    const d = this.detectDivergence();
    if (d) {
      this.divergences.push(d);
      if (this.divergences.length > 50) this.divergences.shift();
    }
    return d;
  }

  /** Live value including the open bar, without committing it to the series. */
  liveValue(openBar) {
    return this.value + (openBar?.delta ?? 0);
  }

  pivots(kind) {
    const n = this.pivotLookback;
    const arr = this.series.toArray();
    const out = [];
    for (let i = n; i < arr.length - n; i++) {
      let isPivot = true;
      for (let j = i - n; j <= i + n; j++) {
        if (j === i) continue;
        if (kind === 'high' ? arr[j].high >= arr[i].high : arr[j].low <= arr[i].low) {
          isPivot = false; break;
        }
      }
      if (isPivot) out.push(arr[i]);
    }
    return out;
  }

  detectDivergence() {
    for (const kind of ['high', 'low']) {
      const p = this.pivots(kind);
      if (p.length < 2) continue;
      const [a, b] = [p[p.length - 2], p[p.length - 1]];
      if (kind === 'high' && b.high > a.high && b.cvd < a.cvd) {
        return { type: 'bearish', kind, from: a.seq, to: b.seq, ts: b.ts,
                 price: b.high, note: 'higher high on weaker cumulative delta' };
      }
      if (kind === 'low' && b.low < a.low && b.cvd > a.cvd) {
        return { type: 'bullish', kind, from: a.seq, to: b.seq, ts: b.ts,
                 price: b.low, note: 'lower low on weaker cumulative selling' };
      }
    }
    return null;
  }

  snapshot() {
    return { value: this.value, series: this.series.toArray(), divergences: this.divergences.slice(-10) };
  }
}
