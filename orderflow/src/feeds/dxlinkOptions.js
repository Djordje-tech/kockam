import { config } from '../config.js';

/**
 * Builds the dealer gamma input from a tastytrade chain plus the dxFeed stream.
 *
 * The chain endpoint gives the contracts — strike, expiry, type, streamer
 * symbol — but not the two numbers gamma needs. Those arrive as events:
 * `Summary` carries open interest, `Greeks` carries implied volatility. So the
 * chain is fetched once, the near-the-money contracts are subscribed, and this
 * class folds the events back onto the chain rows until it has a surface.
 *
 * Only strikes near spot are subscribed. A full QQQ chain is several thousand
 * contracts, almost all of them carrying gamma too small to move anything, and
 * subscribing to all of them wastes the streamer's quote budget for nothing.
 */
export class DxLinkOptionsCollector {
  constructor({ api, feed, underlying, futuresProduct = null } = {}) {
    this.api = api;
    this.feed = feed;
    this.underlying = underlying;
    this.futuresProduct = futuresProduct;
    this.rows = new Map();        // streamerSymbol -> chain row
    this.subscribed = new Set();
    this.lastChainFetch = 0;
  }

  /** Fetch (or refresh) the chain and subscribe the strikes worth watching. */
  async refresh(spot) {
    if (!spot) return;
    const stale = Date.now() - this.lastChainFetch > 6 * 3600_000;
    if (!this.rows.size || stale) {
      const chain = this.futuresProduct
        ? await this.api.futuresOptionChain(this.futuresProduct)
        : await this.api.equityOptionChain(this.underlying);
      this.rows.clear();
      for (const row of chain) this.rows.set(row.streamerSymbol, row);
      this.lastChainFetch = Date.now();
    }
    this._subscribeNear(spot);
  }

  _subscribeNear(spot) {
    const maxDays = config.gamma.maxDaysOut;
    const now = Date.now();
    const near = [...this.rows.values()]
      .filter((r) => r.expiryMs > now && (r.expiryMs - now) / 864e5 <= maxDays)
      .filter((r) => Math.abs(r.strike - spot) <= spot * 0.15)
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, config.gammaMaxStrikes);

    const fresh = near.map((r) => r.streamerSymbol).filter((s) => !this.subscribed.has(s));
    if (!fresh.length) return;
    for (const s of fresh) this.subscribed.add(s);
    this.feed.subscribeOptions(fresh);
  }

  onSummary({ symbol, openInterest }) {
    const row = this.rows.get(symbol);
    if (row && Number.isFinite(openInterest)) row.oi = openInterest;
  }

  onGreeks({ symbol, iv }) {
    const row = this.rows.get(symbol);
    if (row && Number.isFinite(iv) && iv > 0) row.iv = iv;
  }

  /**
   * The rows that are actually usable. A contract with no open interest or no
   * implied volatility contributes nothing to dealer gamma, and including it
   * as a zero would quietly drag the surface flat.
   */
  chain() {
    return [...this.rows.values()].filter((r) => r.oi > 0 && r.iv > 0);
  }

  coverage() {
    const subscribed = this.subscribed.size;
    const populated = this.chain().length;
    return { subscribed, populated, ready: populated >= Math.min(20, subscribed * 0.3) };
  }
}

/**
 * Which underlying's options actually govern a futures contract.
 *
 * Nasdaq futures are moved by the gamma sitting in QQQ and NDX, not by options
 * on the future itself, so charting MNQ against MNQ's own thin option chain
 * would draw a map of the wrong market.
 */
export function gammaUnderlyingFor(product) {
  if (config.gammaUnderlying) return { underlying: config.gammaUnderlying, futuresProduct: null };
  switch (product) {
    case 'NQ': case 'MNQ': return { underlying: 'QQQ', futuresProduct: null };
    case 'ES': case 'MES': return { underlying: 'SPY', futuresProduct: null };
    case 'RTY': case 'M2K': return { underlying: 'IWM', futuresProduct: null };
    case 'YM': case 'MYM': return { underlying: 'DIA', futuresProduct: null };
    case 'CL': case 'MCL': return { underlying: 'USO', futuresProduct: 'CL' };
    case 'GC': case 'MGC': return { underlying: 'GLD', futuresProduct: 'GC' };
    default: return { underlying: product, futuresProduct: null };
  }
}
