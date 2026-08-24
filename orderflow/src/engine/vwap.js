/**
 * Session VWAP with standard deviation bands.
 *
 * The bands are computed from running sums rather than by keeping every print:
 * variance = E[p²] - E[p]², both volume-weighted. That is one multiply per
 * trade instead of a growing array, which matters at futures tick rates.
 *
 * VWAP is the reference institutional execution is measured against, so the
 * bands are not a volatility envelope — they mark where a session's flow is
 * stretched relative to where the volume actually traded.
 */
export class Vwap {
  constructor() { this.reset(); }

  reset(anchorTs = null) {
    this.sumV = 0;
    this.sumPV = 0;
    this.sumP2V = 0;
    this.anchorTs = anchorTs;
    this.value = null;
    this.sigma = 0;
  }

  onTrade({ price, qty, ts }) {
    if (!(qty > 0)) return;
    if (this.anchorTs === null) this.anchorTs = ts;
    this.sumV += qty;
    this.sumPV += price * qty;
    this.sumP2V += price * price * qty;
    this.value = this.sumPV / this.sumV;
    const variance = this.sumP2V / this.sumV - this.value * this.value;
    this.sigma = variance > 0 ? Math.sqrt(variance) : 0;
  }

  bands(multiples = [1, 2]) {
    if (this.value === null) return null;
    const out = { vwap: this.value, sigma: this.sigma };
    for (const m of multiples) {
      out[`upper${m}`] = this.value + this.sigma * m;
      out[`lower${m}`] = this.value - this.sigma * m;
    }
    return out;
  }
}
