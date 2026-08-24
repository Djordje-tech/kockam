import { EventEmitter } from 'node:events';
import { config } from '../config.js';

/**
 * Deterministic synthetic market.
 *
 * This is not decoration: the detectors are all "does this pattern exist in the
 * flow" questions, and the only honest way to test them is a feed where we know
 * the answer. The simulator runs a mean-reverting price with a resting book and
 * deliberately injects the four microstructure events we claim to detect —
 * absorption, icebergs, stop runs and wick rejections — at known times.
 */
export class SimFeed extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.symbol = opts.symbol ?? config.symbol;
    this.price = opts.startPrice ?? 104_000;
    this.tick = opts.tickSize ?? config.tickSize;
    this.speed = opts.speed ?? 1;      // multiples of real time
    this.stepMs = opts.stepMs ?? 40;   // market time advanced per step
    this.seed = opts.seed ?? 42;
    this.drift = 0;
    this.bookDepth = 40;
    this.scripted = null;
    this.running = false;
    this.now = opts.startTs ?? Date.now();
  }

  // xorshift so runs are reproducible across machines
  rnd() {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed % 1_000_000) / 1_000_000;
  }
  gauss() {
    const u = Math.max(1e-9, this.rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rnd());
  }

  start() {
    this.running = true;
    this._emitBook();
    // Market time advances by stepMs per step; the wall-clock interval is that
    // divided by `speed`, so speed is literally "x times real time" and a
    // 60-second bar closes every 60/speed seconds of your life.
    this.timer = setInterval(() => this.step(), Math.max(2, this.stepMs / this.speed));
    return this;
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  /**
   * Timer-free run, used by the tests: the detectors are only trustworthy if
   * they can be replayed deterministically, and timers make that impossible.
   */
  runSync(steps, { bookEvery = 4, scriptEvery = 150 } = {}) {
    this._emitBook();
    for (let i = 0; i < steps; i++) {
      this.step();
      if (i % bookEvery === 0) this._emitBook();
      if (i % scriptEvery === 0) this._maybeScript();
    }
  }

  step() {
    this.now += this.stepMs;
    this.steps = (this.steps ?? 0) + 1;
    if (this.steps % 4 === 0) this._emitBook();
    if (this.steps % 200 === 0) this._maybeScript();
    const s = this.scripted;

    let side, qty = Math.abs(this.gauss()) * 0.6 + 0.05;
    let move = this.gauss() * this.tick * 0.8 + this.drift;

    if (s && this.now < s.until) {
      // While a scripted episode runs, it owns the flow.
      switch (s.kind) {
        case 'absorption':
          side = s.side;
          qty = 1.5 + Math.abs(this.gauss()) * 2.5;
          move = (this.price - s.level) * -0.55;    // pinned to the level
          break;
        case 'iceberg':
          side = s.side;
          qty = 1.2 + Math.abs(this.gauss()) * 1.8;
          this.price = s.level;                      // trades keep printing there
          move = 0;
          break;
        case 'stopRun':
          side = s.side;
          qty = 1.0 + Math.abs(this.gauss()) * 3;
          move = s.phase === 'sweep'
            ? (s.side === 'buy' ? 1 : -1) * this.tick * 3
            : (s.target - this.price) * 0.25;
          if (s.phase === 'sweep' && Math.abs(this.price - s.level) > this.tick * 8) {
            s.phase = 'reclaim';
            s.target = s.level - (s.side === 'buy' ? this.tick * 14 : -this.tick * 14);
          }
          break;
      }
    } else {
      if (s) { this.emit('episodeEnd', s); this.scripted = null; }
      side = this.rnd() > 0.5 ? 'buy' : 'sell';
      move += side === 'buy' ? this.tick * 0.25 : -this.tick * 0.25;
      this.drift *= 0.995;
      if (this.rnd() < 0.01) this.drift = this.gauss() * this.tick * 0.15;
    }

    this.price = Math.max(this.tick, Math.round((this.price + move) / this.tick) * this.tick);
    const trade = {
      ts: this.now,
      price: this.price,
      qty: Math.round(qty * 1000) / 1000,
      side,
      id: this.tradeId = (this.tradeId ?? 0) + 1,
    };
    this.emit('trade', trade);
  }

  _emitBook() {
    const bids = [], asks = [];
    const base = this.price;
    const s = this.scripted;
    for (let i = 1; i <= this.bookDepth; i++) {
      const bp = base - i * this.tick;
      const ap = base + i * this.tick;
      let bq = 0.5 + Math.abs(this.gauss()) * 3 / Math.sqrt(i);
      let aq = 0.5 + Math.abs(this.gauss()) * 3 / Math.sqrt(i);
      // Scripted passive walls: the thing the detectors are meant to find.
      if (s && s.kind === 'absorption' && this.now < s.until) {
        if (s.side === 'sell' && Math.abs(bp - s.level) < this.tick * 2) bq += 60;
        if (s.side === 'buy' && Math.abs(ap - s.level) < this.tick * 2) aq += 60;
      }
      if (s && s.kind === 'iceberg' && this.now < s.until) {
        // Small displayed size that keeps coming back — that is the whole point.
        if (s.side === 'sell' && Math.abs(bp - s.level) <= this.tick) bq = 2 + this.rnd();
        if (s.side === 'buy' && Math.abs(ap - s.level) <= this.tick) aq = 2 + this.rnd();
      }
      bids.push([bp, Math.round(bq * 100) / 100]);
      asks.push([ap, Math.round(aq * 100) / 100]);
    }
    // Always a full replacement: the sim regenerates every visible level,
    // so publishing it as a diff would leave stale levels crossing the book.
    this.emit('depth', { bids, asks, ts: this.now, snapshot: true });
  }

  _maybeScript() {
    if (this.scripted) return;
    const r = this.rnd();
    const dur = 9_000;   // market-time duration of a scripted episode
    if (r < 0.3) {
      this.scripted = { kind: 'absorption', side: this.rnd() > 0.5 ? 'sell' : 'buy',
                        level: this.price, until: this.now + dur };
    } else if (r < 0.55) {
      this.scripted = { kind: 'iceberg', side: this.rnd() > 0.5 ? 'sell' : 'buy',
                        level: this.price, until: this.now + dur };
    } else if (r < 0.75) {
      this.scripted = { kind: 'stopRun', side: this.rnd() > 0.5 ? 'buy' : 'sell',
                        level: this.price, phase: 'sweep', until: this.now + dur * 1.6 };
    }
    if (this.scripted) this.emit('episode', this.scripted);
  }
}

/**
 * Synthetic options chain shaped like a real one: customer call open interest
 * clusters above spot and put open interest below, so dealer gamma comes out
 * positive overhead and negative underneath and the flip lands near the money —
 * which is what makes the gamma panel meaningful offline.
 */
export function simOptionsChain(spot, now = Date.now()) {
  const chain = [];
  const step = Math.max(1, Math.round(spot * 0.01));
  const atm = Math.round(spot / step) * step;
  const bell = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

  for (let i = -12; i <= 12; i++) {
    const strike = atm + i * step;
    if (strike <= 0) continue;
    const m = (strike - spot) / spot;
    const roundStrike = strike % (step * 5) === 0 ? 3 : 1;

    for (const [days, weight] of [[1, 1.0], [7, 1.5], [30, 2.0]]) {
      const expiryMs = now + days * 864e5;
      const iv = 0.55 + Math.abs(m) * 1.2 + (m < 0 ? 0.06 : 0);   // put skew
      chain.push({
        strike, expiryMs, type: 'call', iv,
        oi: Math.round(400 * weight * roundStrike * bell(m, 0.03, 0.045)) + 5,
      });
      chain.push({
        strike, expiryMs, type: 'put', iv: iv + 0.02,
        oi: Math.round(400 * weight * roundStrike * bell(m, -0.04, 0.045)) + 5,
      });
    }
  }
  return chain;
}
