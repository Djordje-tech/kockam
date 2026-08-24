import { config } from '../config.js';

/**
 * Deribit options chain -> the input for dealer gamma.
 *
 * Deribit's public REST needs no key and no entitlement, and its book summary
 * carries open interest and mark IV per instrument, which is exactly the two
 * numbers GEX needs. For crypto it is the whole listed options market in one
 * call, so the gamma map is complete rather than a sampled approximation.
 */
export async function fetchDeribitChain(currency = config.optionsCurrency) {
  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`deribit ${res.status}`);
  const { result } = await res.json();
  if (!Array.isArray(result)) throw new Error('deribit: unexpected payload');

  const chain = [];
  let spot = 0;
  for (const r of result) {
    // instrument_name looks like BTC-27JUN25-120000-C
    const parts = String(r.instrument_name).split('-');
    if (parts.length !== 4) continue;
    const [, expiry, strikeStr, cp] = parts;
    const strike = Number(strikeStr);
    const expiryMs = parseDeribitExpiry(expiry);
    if (!strike || !expiryMs) continue;
    if (r.underlying_price) spot = r.underlying_price;
    chain.push({
      strike,
      expiryMs,
      type: cp === 'C' ? 'call' : 'put',
      oi: Number(r.open_interest) || 0,
      iv: Number(r.mark_iv) || 0,          // percent; computeGex normalises
      volume: Number(r.volume) || 0,
    });
  }
  return { chain, spot };
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
                 JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "27JUN25" -> ms. Deribit expiries settle 08:00 UTC. */
export function parseDeribitExpiry(s) {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(s);
  if (!m) return null;
  const [, d, mon, yy] = m;
  const month = MONTHS[mon];
  if (month === undefined) return null;
  return Date.UTC(2000 + Number(yy), month, Number(d), 8, 0, 0);
}
