import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { toRow } from '../core/prices.js';

/**
 * Live signal scoring.
 *
 * Every platform in this space shows you signals. None of them tell you
 * whether their own signals have been working today. Each fired signal is
 * tracked forward: whichever comes first, `successTicks` rows in the signal's
 * favour or `failTicks` against, decides the outcome. The running hit rate per
 * signal type is published with the signals themselves, so a detector that is
 * misfiring in the current regime is visible instead of trusted.
 */
export class SignalScorer {
  constructor(opts = {}) {
    this.cfg = { ...config.scoring, ...opts };
    this.pending = [];
    this.stats = new Map();      // type -> { fired, wins, losses, neutral, sumR }
    this.history = [];
    this.file = opts.file ?? null;
    if (this.file) this._load();
  }

  track(signal) {
    if (!signal || !signal.bias || !Number.isFinite(signal.price)) return signal;
    const id = `${signal.type}:${signal.ts}:${signal.price}`;
    signal.id = id;
    this.pending.push({
      id, type: signal.type, bias: signal.bias, ts: signal.ts,
      entryRow: toRow(signal.price), entry: signal.price,
      strength: signal.strength ?? 0.5, best: 0, worst: 0,
    });
    const s = this._stat(signal.type);
    s.fired++;
    signal.stats = this.summaryFor(signal.type);
    return signal;
  }

  onPrice(price, ts) {
    if (!this.pending.length) return [];
    const row = toRow(price);
    const resolved = [];
    for (const p of this.pending) {
      if (p.done) continue;
      const travel = p.bias === 'bullish' ? row - p.entryRow : p.entryRow - row;
      p.best = Math.max(p.best, travel);
      p.worst = Math.min(p.worst, travel);

      if (travel >= this.cfg.successTicks) this._resolve(p, 'win', price, ts, resolved);
      else if (travel <= -this.cfg.failTicks) this._resolve(p, 'loss', price, ts, resolved);
      else if (ts - p.ts > this.cfg.horizonMs) this._resolve(p, 'neutral', price, ts, resolved);
    }
    if (resolved.length) {
      this.pending = this.pending.filter((p) => !p.done);
      this._save();
    }
    return resolved;
  }

  _resolve(p, outcome, price, ts, out) {
    p.done = true;
    p.outcome = outcome;
    p.exit = price;
    p.exitTs = ts;
    const s = this._stat(p.type);
    if (outcome === 'win') s.wins++;
    else if (outcome === 'loss') s.losses++;
    else s.neutral++;
    // R here is travel measured in "fail distance" units — a win is +1R.
    s.sumR += p.best >= this.cfg.successTicks ? 1
            : p.worst <= -this.cfg.failTicks ? -1
            : p.best / this.cfg.successTicks;
    const rec = { id: p.id, type: p.type, bias: p.bias, ts: p.ts, entry: p.entry,
                  exit: price, outcome, best: p.best, worst: p.worst };
    this.history.push(rec);
    if (this.history.length > 500) this.history.shift();
    out.push(rec);
  }

  _stat(type) {
    let s = this.stats.get(type);
    if (!s) this.stats.set(type, (s = { fired: 0, wins: 0, losses: 0, neutral: 0, sumR: 0 }));
    return s;
  }

  summaryFor(type) {
    const s = this._stat(type);
    const decided = s.wins + s.losses;
    return {
      fired: s.fired,
      wins: s.wins,
      losses: s.losses,
      hitRate: decided ? s.wins / decided : null,
      expectancyR: decided ? s.sumR / decided : null,
    };
  }

  table() {
    return [...this.stats.keys()].map((t) => ({ type: t, ...this.summaryFor(t) }))
      .sort((a, b) => b.fired - a.fired);
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw.stats || {})) this.stats.set(k, v);
      this.history = raw.history || [];
    } catch { /* first run */ }
  }

  _save() {
    if (!this.file) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify({
          stats: Object.fromEntries(this.stats),
          history: this.history.slice(-500),
        }));
      } catch { /* non-fatal */ }
    }, 2000).unref?.();
  }
}
