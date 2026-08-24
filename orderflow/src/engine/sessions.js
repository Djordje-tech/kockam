import { VolumeProfile } from './volumeProfile.js';
import { Vwap } from './vwap.js';
import { sessionInfo } from '../instruments/futures.js';

/**
 * Session state and the reference levels a futures day is actually traded off.
 *
 * A continuous stream has no natural boundaries, but the market does: Globex
 * opens at 18:00 New York and the day's statistics start there, not at
 * midnight and not at the cash open. Everything a day trader marks up before
 * the bell — prior day high, low and close, the overnight range, the initial
 * balance, yesterday's value area — falls out of tracking that properly.
 *
 * These levels then feed the sweep detector, because they are precisely where
 * stops sit.
 */
export class SessionManager {
  constructor({ group = 'equityIndex', keepSessions = 10 } = {}) {
    this.group = group;
    this.keepSessions = keepSessions;
    this.dayKey = null;
    this.current = null;
    this.history = [];
    this.vwap = new Vwap();
    this.rthVwap = new Vwap();
  }

  _blank(dayKey, ts) {
    return {
      dayKey,
      startTs: ts,
      high: -Infinity, low: Infinity, open: null, close: null,
      volume: 0, delta: 0,
      profile: new VolumeProfile(dayKey),
      // The overnight session runs until the cash open; its extremes are the
      // first liquidity pool the day session reaches for.
      overnight: { high: -Infinity, low: Infinity, closed: false },
      rth: { high: -Infinity, low: Infinity, open: null, startTs: null,
             profile: new VolumeProfile(`${dayKey}-RTH`) },
      // Initial balance: the first hour of regular trade, the range the rest
      // of the session is measured against.
      initialBalance: { high: -Infinity, low: Infinity, complete: false },
    };
  }

  /**
   * @returns {object|null} the session that just ended, if this trade rolled it
   */
  onTrade(t) {
    const info = sessionInfo(new Date(t.ts), this.group);
    let rolled = null;

    if (info.dayKey !== this.dayKey) {
      rolled = this.current ? this.finalize(this.current) : null;
      this.dayKey = info.dayKey;
      this.current = this._blank(info.dayKey, t.ts);
      this.vwap.reset(t.ts);
      this.rthVwap.reset();
    }

    const s = this.current;
    if (s.open === null) s.open = t.price;
    s.close = t.price;
    if (t.price > s.high) s.high = t.price;
    if (t.price < s.low) s.low = t.price;
    s.volume += t.qty;
    s.delta += t.side === 'buy' ? t.qty : -t.qty;
    s.profile.onTrade(t);
    this.vwap.onTrade(t);

    if (info.isRth) {
      s.overnight.closed = true;
      if (s.rth.startTs === null) { s.rth.startTs = t.ts; s.rth.open = t.price; }
      if (t.price > s.rth.high) s.rth.high = t.price;
      if (t.price < s.rth.low) s.rth.low = t.price;
      s.rth.profile.onTrade(t);
      this.rthVwap.onTrade(t);

      const ib = s.initialBalance;
      if (!ib.complete) {
        if (info.minutesIntoRth >= 60) ib.complete = true;
        else {
          if (t.price > ib.high) ib.high = t.price;
          if (t.price < ib.low) ib.low = t.price;
        }
      }
    } else if (!s.overnight.closed) {
      if (t.price > s.overnight.high) s.overnight.high = t.price;
      if (t.price < s.overnight.low) s.overnight.low = t.price;
    }

    return rolled;
  }

  finalize(session) {
    const va = session.profile.valueArea();
    const rthVa = session.rth.profile.valueArea();
    const done = {
      dayKey: session.dayKey,
      high: finite(session.high), low: finite(session.low),
      open: session.open, close: session.close,
      volume: session.volume, delta: session.delta,
      valueArea: va,
      rthValueArea: rthVa,
      rthHigh: finite(session.rth.high), rthLow: finite(session.rth.low),
    };
    this.history.push(done);
    if (this.history.length > this.keepSessions) this.history.shift();
    return done;
  }

  /**
   * Every level worth drawing, named the way traders name them. The sweep
   * detector consumes this list directly — these are the stop pools.
   */
  referenceLevels() {
    const out = [];
    const prior = this.history[this.history.length - 1];
    if (prior) {
      push(out, prior.high, 'PDH', 'prior day high');
      push(out, prior.low, 'PDL', 'prior day low');
      push(out, prior.close, 'PDC', 'prior day close');
      if (prior.valueArea) {
        push(out, prior.valueArea.poc, 'PDPOC', 'prior day POC');
        push(out, prior.valueArea.vah, 'PDVAH', 'prior day value area high');
        push(out, prior.valueArea.val, 'PDVAL', 'prior day value area low');
      }
    }
    const s = this.current;
    if (s) {
      push(out, finite(s.overnight.high), 'ONH', 'overnight high');
      push(out, finite(s.overnight.low), 'ONL', 'overnight low');
      if (s.initialBalance.complete || finite(s.initialBalance.high) !== null) {
        push(out, finite(s.initialBalance.high), 'IBH', 'initial balance high');
        push(out, finite(s.initialBalance.low), 'IBL', 'initial balance low');
      }
      push(out, finite(s.rth.open), 'RTHO', 'cash open');
    }
    return out;
  }

  snapshot() {
    const s = this.current;
    return {
      dayKey: this.dayKey,
      session: s ? {
        high: finite(s.high), low: finite(s.low), open: s.open, close: s.close,
        volume: s.volume, delta: s.delta,
        overnight: { high: finite(s.overnight.high), low: finite(s.overnight.low) },
        initialBalance: { high: finite(s.initialBalance.high),
                          low: finite(s.initialBalance.low),
                          complete: s.initialBalance.complete },
        rth: { high: finite(s.rth.high), low: finite(s.rth.low), open: s.rth.open },
      } : null,
      vwap: this.vwap.bands(),
      rthVwap: this.rthVwap.bands(),
      levels: this.referenceLevels(),
      priorSessions: this.history.slice(-3),
    };
  }
}

const finite = (v) => (Number.isFinite(v) ? v : null);

function push(list, price, code, label) {
  if (Number.isFinite(price)) list.push({ price, code, label });
}
