import { EventEmitter } from 'node:events';
import { config } from '../config.js';

/**
 * Binance USD-M futures feed.
 *
 * Why this venue for a free product: aggTrade carries the taker side on every
 * print (`m` = buyer was the maker, i.e. the aggressor sold), and the depth
 * diff stream is unthrottled at 100ms with no entitlement, no exchange fee and
 * no delayed-data tier. That is the same raw material a CME order-flow seat
 * charges for, and it is what lets this run at zero cost.
 *
 * The depth stream is a diff stream, so correctness requires the documented
 * dance: buffer diffs, take a REST snapshot, drop diffs older than the
 * snapshot, verify the first applied diff brackets it, and resync on any gap.
 */
export class BinanceFeed extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.symbol = (opts.symbol ?? config.symbol).toUpperCase();
    this.lower = this.symbol.toLowerCase();
    this.rest = opts.rest ?? 'https://fapi.binance.com';
    this.wsBase = opts.ws ?? 'wss://fstream.binance.com';
    this.buffer = [];
    this.synced = false;
    this.lastUpdateId = 0;
    this.retries = 0;
  }

  start() {
    this._connect();
    return this;
  }

  stop() {
    this.stopped = true;
    try { this.ws?.close(); } catch { /* already gone */ }
  }

  _connect() {
    const streams = [`${this.lower}@aggTrade`, `${this.lower}@depth@100ms`, `${this.lower}@bookTicker`];
    const url = `${this.wsBase}/stream?streams=${streams.join('/')}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retries = 0;
      this.emit('status', { state: 'connected', url });
      this._resync().catch((e) => this.emit('error', e));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._route(msg.data ?? msg);
    });
    ws.addEventListener('close', () => this._reconnect('closed'));
    ws.addEventListener('error', (e) => {
      this.emit('error', e.message ? new Error(e.message) : new Error('websocket error'));
    });
  }

  _reconnect(why) {
    if (this.stopped) return;
    this.synced = false;
    this.buffer = [];
    const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
    this.emit('status', { state: 'reconnecting', why, delay });
    setTimeout(() => this._connect(), delay);
  }

  _route(d) {
    switch (d.e) {
      case 'aggTrade':
        this.emit('trade', {
          ts: d.T,
          price: +d.p,
          qty: +d.q,
          // `m` true => the buyer was the maker => the taker hit the bid.
          side: d.m ? 'sell' : 'buy',
          id: d.a,
        });
        break;
      case 'depthUpdate':
        this._onDepth(d);
        break;
      case 'bookTicker':
        this.emit('quote', { ts: d.E, bid: +d.b, bidQty: +d.B, ask: +d.a, askQty: +d.A });
        break;
    }
  }

  async _resync() {
    this.synced = false;
    this.buffer = [];
    const res = await fetch(`${this.rest}/fapi/v1/depth?symbol=${this.symbol}&limit=1000`);
    if (!res.ok) throw new Error(`depth snapshot ${res.status}`);
    const snap = await res.json();
    this.lastUpdateId = snap.lastUpdateId;
    this.emit('depth', {
      snapshot: true, ts: Date.now(),
      bids: snap.bids.map(([p, q]) => [+p, +q]),
      asks: snap.asks.map(([p, q]) => [+p, +q]),
      lastUpdateId: snap.lastUpdateId,
    });
    // Replay whatever arrived while the snapshot was in flight.
    const pending = this.buffer;
    this.buffer = [];
    this.synced = true;
    for (const d of pending) this._applyDepth(d);
  }

  _onDepth(d) {
    if (!this.synced) { this.buffer.push(d); return; }
    this._applyDepth(d);
  }

  _applyDepth(d) {
    if (d.u < this.lastUpdateId) return;                 // stale, predates snapshot
    if (this.firstApplied && d.pu !== this.lastUpdateId) {
      // Sequence gap: the book is no longer trustworthy, take a fresh snapshot.
      this.emit('status', { state: 'gap', expected: this.lastUpdateId, got: d.pu });
      this._resync().catch((e) => this.emit('error', e));
      return;
    }
    this.firstApplied = true;
    this.lastUpdateId = d.u;
    this.emit('depth', {
      snapshot: false, ts: d.E,
      bids: d.b.map(([p, q]) => [+p, +q]),
      asks: d.a.map(([p, q]) => [+p, +q]),
    });
  }

  /** Contract tick size, so the row aggregation matches the instrument. */
  async fetchTickSize() {
    const res = await fetch(`${this.rest}/fapi/v1/exchangeInfo`);
    if (!res.ok) return null;
    const info = await res.json();
    const sym = info.symbols?.find((s) => s.symbol === this.symbol);
    const f = sym?.filters?.find((x) => x.filterType === 'PRICE_FILTER');
    return f ? +f.tickSize : null;
  }
}
