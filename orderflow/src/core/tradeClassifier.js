import { Ring } from './ring.js';

/**
 * Deciding who was the aggressor on each print.
 *
 * Everything downstream — delta, footprint, absorption, CVD — is built on the
 * answer to "did this trade lift the offer or hit the bid". Crypto venues hand
 * it over on every print. Most equity and futures feeds do not: dxFeed's
 * `Trade` event carries price and size but no side, and `TimeAndSale` carries
 * `aggressorSide` only when the subscription is entitled to it.
 *
 * So the side is resolved in descending order of trust:
 *
 *   1. an explicit aggressor side from the feed, when there is one,
 *   2. the quote rule — at or above the ask is a buy, at or below the bid is
 *      a sell, which resolves the large majority of prints,
 *   3. inside the spread, which side of the midpoint the print landed on,
 *   4. exactly at the midpoint, the tick rule: up from the last print is a
 *      buy, down is a sell, unchanged repeats the previous classification.
 *
 * Steps 2-4 are Lee-Ready. The one refinement that matters in practice is the
 * lag: quotes routinely update *ahead* of the print that caused them, so
 * classifying against the instantaneous quote systematically mislabels fast
 * markets. We keep a short quote history and classify against the quote that
 * was in effect `quoteLagMs` before the trade instead.
 */
export class TradeClassifier {
  constructor({ quoteLagMs = 250, historyMs = 5_000 } = {}) {
    this.quoteLagMs = quoteLagMs;
    this.historyMs = historyMs;
    this.quotes = new Ring(512);
    this.lastPrice = null;
    this.lastSide = 'buy';
    this.stats = { explicit: 0, quote: 0, midpoint: 0, tick: 0 };
  }

  onQuote({ bid, ask, ts }) {
    if (!(bid > 0) || !(ask > 0) || ask < bid) return;
    this.quotes.push({ bid, ask, ts });
    this.current = { bid, ask, ts };
  }

  /** The quote in effect `quoteLagMs` before `ts`, falling back to the oldest held. */
  quoteAt(ts) {
    const target = ts - this.quoteLagMs;
    let found = null;
    this.quotes.scanBack((q) => {
      if (q.ts <= target) { found = q; return false; }
      return true;
    });
    if (found) return found;
    // Nothing old enough yet: the freshest quote beats no quote at all.
    return this.quotes.at(0) ?? this.current ?? null;
  }

  /**
   * @param {{price:number, qty:number, ts:number, side?:string}} trade
   * @returns {'buy'|'sell'}
   */
  classify(trade) {
    const explicit = normaliseSide(trade.side);
    if (explicit) {
      this.stats.explicit++;
      this.lastPrice = trade.price;
      this.lastSide = explicit;
      return explicit;
    }

    const q = this.quoteAt(trade.ts);
    let side = null;
    if (q && trade.ts - q.ts < this.historyMs) {
      if (trade.price >= q.ask) { side = 'buy'; this.stats.quote++; }
      else if (trade.price <= q.bid) { side = 'sell'; this.stats.quote++; }
      else {
        const mid = (q.bid + q.ask) / 2;
        if (trade.price > mid) { side = 'buy'; this.stats.midpoint++; }
        else if (trade.price < mid) { side = 'sell'; this.stats.midpoint++; }
      }
    }

    if (!side) {
      if (this.lastPrice === null || trade.price === this.lastPrice) side = this.lastSide;
      else side = trade.price > this.lastPrice ? 'buy' : 'sell';
      this.stats.tick++;
    }

    this.lastPrice = trade.price;
    this.lastSide = side;
    return side;
  }

  /**
   * How the current session's prints were actually resolved. Published to the
   * UI because a footprint built mostly from the tick rule deserves to be
   * read with more suspicion than one built from an entitled aggressor flag.
   */
  quality() {
    const total = this.stats.explicit + this.stats.quote + this.stats.midpoint + this.stats.tick;
    if (!total) return { total: 0, confidence: null, ...this.stats };
    return {
      ...this.stats,
      total,
      // Explicit sides are ground truth, the quote rule is close to it, the
      // midpoint split is a guess and the tick rule is a last resort.
      confidence: (this.stats.explicit + this.stats.quote * 0.95 +
                   this.stats.midpoint * 0.7 + this.stats.tick * 0.5) / total,
    };
  }
}

function normaliseSide(side) {
  if (!side) return null;
  const s = String(side).toLowerCase();
  if (s === 'buy' || s === 'b') return 'buy';
  if (s === 'sell' || s === 's') return 'sell';
  return null;                    // dxFeed sends 'Undefined' when it does not know
}
