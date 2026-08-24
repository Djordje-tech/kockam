import { config } from '../config.js';

/**
 * tastytrade REST client — the small slice needed to reach market data.
 *
 * Credentials never live in this repo. They are read from the environment, and
 * the session token is kept in memory only. tastytrade issues a remember token
 * on login which can be exchanged for a new session without re-sending the
 * password; we use it so a long-running terminal does not have to hold the
 * password anywhere.
 */
export class TastytradeApi {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl ?? config.tastytrade.baseUrl;
    this.login = opts.login ?? config.tastytrade.login;
    this.password = opts.password ?? config.tastytrade.password;
    this.rememberToken = opts.rememberToken ?? config.tastytrade.rememberToken;
    this.sessionToken = null;
    this.userAgent = 'orderflow-terminal/0.1';
  }

  async _fetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };
    if (auth) {
      if (!this.sessionToken) await this.authenticate();
      headers.Authorization = this.sessionToken;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && auth) {
      // Session expired mid-run: re-auth once and replay the request.
      this.sessionToken = null;
      await this.authenticate();
      return this._fetch(path, { method, body, auth });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`tastytrade ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return json.data ?? json;
  }

  async authenticate() {
    if (!this.login) {
      throw new Error(
        'No tastytrade credentials. Set TT_LOGIN and TT_PASSWORD (or TT_REMEMBER_TOKEN) ' +
        'in orderflow/.env — see .env.example.',
      );
    }
    const body = this.rememberToken
      ? { login: this.login, 'remember-token': this.rememberToken, 'remember-me': true }
      : { login: this.login, password: this.password, 'remember-me': true };
    const data = await this._fetch('/sessions', { method: 'POST', body, auth: false });
    this.sessionToken = data['session-token'];
    // Each login rotates the remember token; keep the new one for the next one.
    if (data['remember-token']) this.rememberToken = data['remember-token'];
    if (!this.sessionToken) throw new Error('tastytrade: no session-token in response');
    return this.sessionToken;
  }

  /** Streamer URL and short-lived token for the dxFeed connection. */
  async quoteToken() {
    const data = await this._fetch('/api-quote-tokens');
    return { url: data['dxlink-url'], token: data.token, level: data.level };
  }

  /**
   * Resolve a product code to the contract that is actually trading.
   * The venue knows which month carries the volume; the local roll calendar is
   * only a fallback for when this lookup is unavailable.
   */
  async futuresForProduct(productCode) {
    const data = await this._fetch(`/instruments/futures?product-code=${encodeURIComponent(productCode)}`);
    const items = data.items ?? [];
    return items
      .filter((f) => f['active-month'] !== undefined || f['streamer-symbol'])
      .map((f) => ({
        symbol: f.symbol,
        streamerSymbol: f['streamer-symbol'],
        expiresAt: f['expires-at'],
        activeMonth: !!f['active-month'],
        nextActiveMonth: !!f['next-active-month'],
        tickSize: Number(f['tick-sizes']?.[0]?.value) || null,
        notional: Number(f['notional-multiplier']) || null,
        displayFactor: Number(f['display-factor']) || 1,
      }))
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
  }

  async equity(symbol) {
    const data = await this._fetch(`/instruments/equities/${encodeURIComponent(symbol)}`);
    return { symbol: data.symbol, streamerSymbol: data['streamer-symbol'] ?? data.symbol };
  }

  /** Equity/ETF option chain, flattened to what the gamma engine consumes. */
  async equityOptionChain(symbol) {
    const data = await this._fetch(`/option-chains/${encodeURIComponent(symbol)}/nested`);
    return flattenNestedChain(data.items ?? []);
  }

  /** Options on futures, e.g. the NQ chain for a Nasdaq gamma map. */
  async futuresOptionChain(productCode) {
    const data = await this._fetch(`/futures-option-chains/${encodeURIComponent(productCode)}/nested`);
    return flattenNestedChain(data.items ?? [], true);
  }
}

/**
 * The nested chain is grouped expiration -> strike -> {call, put}. The gamma
 * engine wants one flat row per contract, carrying the streamer symbol so the
 * open interest and implied volatility can be streamed for it.
 */
function flattenNestedChain(items, futures = false) {
  const out = [];
  for (const item of items) {
    for (const exp of item.expirations ?? []) {
      const expiryMs = parseExpiry(exp['expiration-date']);
      if (!expiryMs) continue;
      for (const s of exp.strikes ?? []) {
        const strike = Number(s['strike-price']);
        if (!Number.isFinite(strike)) continue;
        if (s['call-streamer-symbol']) {
          out.push({ strike, expiryMs, type: 'call', streamerSymbol: s['call-streamer-symbol'],
                     symbol: s.call, futures, oi: 0, iv: 0 });
        }
        if (s['put-streamer-symbol']) {
          out.push({ strike, expiryMs, type: 'put', streamerSymbol: s['put-streamer-symbol'],
                     symbol: s.put, futures, oi: 0, iv: 0 });
        }
      }
    }
  }
  return out;
}

/** Expirations come back as YYYY-MM-DD; US options settle 16:00 New York. */
function parseExpiry(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  // 20:00 UTC is 16:00 EDT / 15:00 EST — close enough for a gamma surface,
  // and wrong by an hour only during the winter half of the year.
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 20, 0, 0);
}

export { flattenNestedChain, parseExpiry };
