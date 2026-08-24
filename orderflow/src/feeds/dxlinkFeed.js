import { EventEmitter } from 'node:events';
import {
  DXLinkWebSocketClient, DXLinkFeed, DXLinkDepthOfMarket,
  FeedContract, FeedDataFormat,
} from '@dxfeed/dxlink-api';
import { config } from '../config.js';
import { TastytradeApi } from './tastytradeApi.js';
import { parseSymbol, frontMonth, CONTRACTS } from '../instruments/futures.js';

/**
 * Live futures and equities feed: tastytrade for entitlement and symbology,
 * dxFeed's DXLink for the stream itself.
 *
 * dxFeed is the same vendor the commercial order flow platforms run on, and
 * the official `@dxfeed/dxlink-api` client speaks the protocol, so this
 * adapter is symbol resolution and event translation rather than a protocol
 * implementation.
 *
 * Two things differ from the crypto path and shape the design:
 *
 *   - `Trade` events carry no aggressor side. `TimeAndSale` does, but only
 *     with the entitlement for it, so we subscribe to both and let the
 *     classifier resolve the side, reporting how it did (see TradeClassifier).
 *   - Depth is a separate DXLink service with its own entitlement. When it is
 *     not available the terminal still produces footprint, delta and profile;
 *     it just cannot see resting size, so book-derived detectors go quiet
 *     rather than inventing numbers.
 */
export class DxLinkFeed extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.api = opts.api ?? new TastytradeApi();
    this.requested = opts.symbol ?? config.symbol;
    this.depthLimit = opts.depthLimit ?? 20;
    this.instrument = null;
    this.streamerSymbol = null;
    this.stopped = false;
    this.hasDepth = false;
    this.sawAggressor = false;
  }

  async start() {
    try {
      await this._resolveSymbol();
      await this._connect();
    } catch (e) {
      this.emit('error', e);
      this.emit('status', { state: 'failed', why: e.message });
    }
    return this;
  }

  stop() {
    this.stopped = true;
    try { this.client?.close(); } catch { /* already down */ }
  }

  // ---- symbology --------------------------------------------------------

  /**
   * "MNQ1!", "/MNQ" and "MNQ" all mean the front month. The venue is asked
   * which contract that currently is, because the roll follows volume rather
   * than the calendar; the local roll table is only the fallback.
   */
  async _resolveSymbol() {
    const parsed = parseSymbol(this.requested);
    this.parsed = parsed;

    if (parsed.kind === 'equity' || parsed.kind === 'unknown') {
      const eq = await this.api.equity(parsed.product);
      this.streamerSymbol = eq.streamerSymbol;
      this.instrument = { ...parsed, ...eq, tickSize: parsed.spec.tickSize };
    } else if (!parsed.continuous) {
      this.streamerSymbol = `/${this.requested.replace(/^\//, '')}:${parsed.spec.exchange}`;
      this.instrument = { ...parsed, tickSize: parsed.spec.tickSize };
    } else {
      const contracts = await this.api.futuresForProduct(parsed.product);
      const active = contracts.find((c) => c.activeMonth) ?? contracts[0];
      if (!active) {
        const fallback = frontMonth(parsed.product);
        if (!fallback) throw new Error(`no contract found for ${parsed.product}`);
        this.streamerSymbol = `/${fallback.symbol}:${parsed.spec.exchange}`;
        this.instrument = { ...parsed, symbol: fallback.symbol, tickSize: parsed.spec.tickSize };
      } else {
        this.streamerSymbol = active.streamerSymbol;
        this.instrument = {
          ...parsed,
          symbol: active.symbol,
          expiresAt: active.expiresAt,
          tickSize: active.tickSize || parsed.spec.tickSize,
          multiplier: active.notional || parsed.spec.multiplier,
        };
      }
    }

    this.emit('instrument', {
      requested: this.requested,
      resolved: this.instrument.symbol ?? this.instrument.product,
      streamerSymbol: this.streamerSymbol,
      tickSize: this.instrument.tickSize,
      multiplier: this.instrument.multiplier ?? this.parsed.spec.multiplier,
      expiresAt: this.instrument.expiresAt ?? null,
    });
  }

  // ---- streaming --------------------------------------------------------

  async _connect() {
    const { url, token } = await this.api.quoteToken();
    const client = new DXLinkWebSocketClient();
    this.client = client;
    client.setAuthToken(token);
    client.connect(url);
    this.emit('status', { state: 'connecting', url });

    client.addConnectionStateChangeListener((state) => {
      this.emit('status', { state: `connection:${state}` });
      if (state === 'NOT_CONNECTED' && !this.stopped) this._scheduleReconnect();
    });

    this.feed = new DXLinkFeed(client, FeedContract.AUTO);
    this.feed.configure({
      // Order flow is destroyed by aggregation: ask for every print.
      acceptAggregationPeriod: 0,
      acceptDataFormat: FeedDataFormat.FULL,
    });
    this.feed.addEventListener((events) => this._onEvents(events));

    const sym = this.streamerSymbol;
    // TimeAndSale carries the aggressor side when entitled; Trade is the
    // fallback that always arrives. Subscribing to both costs nothing and
    // means the terminal works at either entitlement level.
    for (const type of ['Quote', 'Trade', 'TimeAndSale']) {
      this.feed.addSubscriptions({ type, symbol: sym });
    }

    this._connectDepth(client, sym);
  }

  _connectDepth(client, symbol) {
    try {
      this.dom = new DXLinkDepthOfMarket(client, { symbol, sources: [] }, {});
      this.dom.reconfigure({
        acceptAggregationPeriod: 0.1,
        acceptDepthLimit: this.depthLimit,
      });
      this.dom.addSnapshotListener((snapshot) => this._onDepth(snapshot));
      this.dom.addStateChangeListener?.((state) => {
        if (state === 'OPENED') {
          this.hasDepth = true;
          this.emit('status', { state: 'depth:available' });
        }
      });
    } catch (e) {
      // No depth entitlement is a downgrade, not a failure.
      this.emit('status', { state: 'depth:unavailable', why: e.message });
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** (this.retries = (this.retries ?? 0) + 1));
    this.emit('status', { state: 'reconnecting', delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect().catch((e) => this.emit('error', e));
    }, delay);
  }

  _onEvents(events) {
    for (const e of events) {
      switch (e.eventType) {
        case 'Quote':
          this.emit('quote', {
            ts: e.time ?? Date.now(),
            bid: e.bidPrice, ask: e.askPrice,
            bidQty: e.bidSize, askQty: e.askSize,
          });
          break;

        case 'TimeAndSale': {
          // `type` N/C are cancellations and corrections, not new volume.
          if (e.type === 'CANCEL' || e.type === 'CORRECTION') break;
          if (!(e.size > 0)) break;
          const side = mapAggressor(e.aggressorSide);
          if (side) this.sawAggressor = true;
          this.emit('trade', {
            ts: e.time ?? Date.now(),
            price: e.price,
            qty: e.size,
            side,                       // may be null: the classifier resolves it
            id: e.index ?? e.sequence,
            source: 'timeAndSale',
          });
          break;
        }

        case 'Trade':
          // Only used when TimeAndSale is not entitled, otherwise every print
          // would be counted twice.
          if (this.sawAggressor || this.seenTimeAndSale) break;
          if (!(e.size > 0)) break;
          this.emit('trade', {
            ts: e.time ?? Date.now(),
            price: e.price, qty: e.size, side: null, source: 'trade',
          });
          break;

        case 'Summary':
          this.emit('summary', { symbol: e.eventSymbol, openInterest: e.openInterest,
                                 prevDayClose: e.prevDayClosePrice, dayOpen: e.dayOpenPrice });
          break;

        case 'Greeks':
          this.emit('greeks', { symbol: e.eventSymbol, iv: e.volatility, gamma: e.gamma,
                                delta: e.delta, price: e.price });
          break;
      }
      if (e.eventType === 'TimeAndSale') this.seenTimeAndSale = true;
    }
  }

  /** DXLink depth snapshots are order lists; the engine wants price levels. */
  _onDepth(snapshot) {
    const fold = (orders = []) => {
      const levels = new Map();
      for (const o of orders) {
        if (!(o.price > 0) || !(o.size > 0)) continue;
        levels.set(o.price, (levels.get(o.price) ?? 0) + o.size);
      }
      return [...levels.entries()];
    };
    this.emit('depth', {
      snapshot: true,               // DXLink republishes the whole book
      ts: Date.now(),
      bids: fold(snapshot.bids),
      asks: fold(snapshot.asks),
    });
  }

  /** Subscribe the option contracts whose open interest and IV feed the GEX map. */
  subscribeOptions(streamerSymbols) {
    if (!this.feed) return;
    for (const symbol of streamerSymbols) {
      this.feed.addSubscriptions({ type: 'Summary', symbol });
      this.feed.addSubscriptions({ type: 'Greeks', symbol });
    }
  }
}

/** dxFeed sends 'Buy' | 'Sell' | 'Undefined'. */
function mapAggressor(side) {
  if (side === 'Buy' || side === 'B') return 'buy';
  if (side === 'Sell' || side === 'S') return 'sell';
  return null;
}

export { mapAggressor, CONTRACTS };
