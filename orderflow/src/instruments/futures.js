/**
 * Futures contract specifications and session logic.
 *
 * Tick size and multiplier are fetched from the venue when a feed can supply
 * them; this table is the fallback and the source of truth for everything the
 * API does not return — sensible footprint row aggregation, and the session
 * boundaries that decide when the volume profile resets.
 */
export const CONTRACTS = {
  // CME equity index
  NQ:  { name: 'E-mini Nasdaq 100',   tickSize: 0.25, multiplier: 20,  exchange: 'XCME', months: 'HMUZ', group: 'equityIndex' },
  MNQ: { name: 'Micro Nasdaq 100',    tickSize: 0.25, multiplier: 2,   exchange: 'XCME', months: 'HMUZ', group: 'equityIndex' },
  ES:  { name: 'E-mini S&P 500',      tickSize: 0.25, multiplier: 50,  exchange: 'XCME', months: 'HMUZ', group: 'equityIndex' },
  MES: { name: 'Micro S&P 500',       tickSize: 0.25, multiplier: 5,   exchange: 'XCME', months: 'HMUZ', group: 'equityIndex' },
  RTY: { name: 'E-mini Russell 2000', tickSize: 0.10, multiplier: 50,  exchange: 'XCME', months: 'HMUZ', group: 'equityIndex' },
  M2K: { name: 'Micro Russell 2000',  tickSize: 0.10, multiplier: 5,   exchange: 'XCME', months: 'HMUZ', group: 'equityIndex' },
  YM:  { name: 'E-mini Dow',          tickSize: 1,    multiplier: 5,   exchange: 'XCBT', months: 'HMUZ', group: 'equityIndex' },
  MYM: { name: 'Micro Dow',           tickSize: 1,    multiplier: 0.5, exchange: 'XCBT', months: 'HMUZ', group: 'equityIndex' },
  // energy / metals, same machinery, different clock
  CL:  { name: 'Crude Oil',           tickSize: 0.01, multiplier: 1000, exchange: 'XNYM', months: 'FGHJKMNQUVXZ', group: 'energy' },
  MCL: { name: 'Micro Crude Oil',     tickSize: 0.01, multiplier: 100,  exchange: 'XNYM', months: 'FGHJKMNQUVXZ', group: 'energy' },
  GC:  { name: 'Gold',                tickSize: 0.10, multiplier: 100,  exchange: 'XCEC', months: 'GJMQVZ', group: 'metals' },
  MGC: { name: 'Micro Gold',          tickSize: 0.10, multiplier: 10,   exchange: 'XCEC', months: 'GJMQVZ', group: 'metals' },
};

/** Equities and ETFs go through the same engine; only the specs differ. */
export const EQUITIES = {
  QQQ: { name: 'Invesco QQQ Trust', tickSize: 0.01, multiplier: 1, group: 'etf', gammaUnderlying: 'QQQ' },
  SPY: { name: 'SPDR S&P 500',      tickSize: 0.01, multiplier: 1, group: 'etf', gammaUnderlying: 'SPY' },
  IWM: { name: 'iShares Russell',   tickSize: 0.01, multiplier: 1, group: 'etf', gammaUnderlying: 'IWM' },
};

const MONTH_CODES = { F: 0, G: 1, H: 2, J: 3, K: 4, M: 5, N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11 };
const CODE_FOR_MONTH = Object.fromEntries(Object.entries(MONTH_CODES).map(([c, m]) => [m, c]));

/**
 * A user types MNQ, MNQ1!, /MNQ or a full contract symbol. All of them mean
 * "the front month", which is the only thing worth charting order flow on.
 */
export function parseSymbol(input) {
  const raw = String(input).trim().toUpperCase();
  const cleaned = raw.replace(/^\//, '').replace(/[!#]+$/, '').replace(/\d+$/, '');

  if (EQUITIES[cleaned]) {
    return { kind: 'equity', product: cleaned, spec: EQUITIES[cleaned], continuous: true };
  }
  // A dated contract like MNQZ5 / MNQZ25 keeps its own expiry.
  const dated = /^([A-Z]{1,3})([FGHJKMNQUVXZ])(\d{1,2})$/.exec(raw.replace(/^\//, ''));
  if (dated && CONTRACTS[dated[1]]) {
    return { kind: 'future', product: dated[1], spec: CONTRACTS[dated[1]],
             monthCode: dated[2], yearDigits: dated[3], continuous: false };
  }
  if (CONTRACTS[cleaned]) {
    return { kind: 'future', product: cleaned, spec: CONTRACTS[cleaned], continuous: true };
  }
  // Unknown product: still tradeable, just without a local spec.
  return { kind: 'unknown', product: cleaned, spec: { tickSize: 0.01, multiplier: 1 }, continuous: true };
}

/** Third Friday of a month — expiry for the equity index complex. */
export function thirdFriday(year, month) {
  const d = new Date(Date.UTC(year, month, 1));
  const firstFriday = 1 + ((5 - d.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, month, firstFriday + 14));
}

/**
 * Front month, rolled `rollDaysBefore` days ahead of expiry — the same window
 * the volume actually rolls in, so the chart follows liquidity rather than
 * the calendar.
 */
export function frontMonth(product, now = new Date(), rollDaysBefore = 8) {
  const spec = CONTRACTS[product];
  if (!spec) return null;
  const months = [...spec.months].map((c) => MONTH_CODES[c]).sort((a, b) => a - b);
  const year = now.getUTCFullYear();
  for (const y of [year, year + 1]) {
    for (const m of months) {
      const expiry = thirdFriday(y, m);
      if (expiry.getTime() - now.getTime() > rollDaysBefore * 864e5) {
        return {
          product,
          monthCode: CODE_FOR_MONTH[m],
          year: y,
          expiry,
          symbol: `${product}${CODE_FOR_MONTH[m]}${String(y).slice(-1)}`,
          symbolLongYear: `${product}${CODE_FOR_MONTH[m]}${String(y).slice(-2)}`,
        };
      }
    }
  }
  return null;
}

// ---- sessions -----------------------------------------------------------

const NY = 'America/New_York';

/** Wall-clock time in New York for an instant, without pulling in a tz library. */
export function nyParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, weekday: p.weekday,
    minutes: (+p.hour % 24) * 60 + +p.minute,
  };
}

const RTH = { equityIndex: [570, 960], etf: [570, 960], energy: [540, 850], metals: [500, 780] };

/**
 * Which session an instant belongs to.
 *
 * Globex opens at 18:00 New York and the trading day is named for the *next*
 * calendar day, so anything from 18:00 belongs to tomorrow's session. Getting
 * this wrong is how a volume profile ends up straddling two days.
 */
export function sessionInfo(date = new Date(), group = 'equityIndex') {
  const p = nyParts(date);
  const [rthOpen, rthClose] = RTH[group] ?? RTH.equityIndex;
  const isRth = p.minutes >= rthOpen && p.minutes < rthClose;
  const overnight = p.minutes >= 18 * 60;      // post-18:00 belongs to the next day
  const dayKey = overnight
    ? nextDayKey(p)
    : `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return {
    session: isRth ? 'RTH' : 'ETH',
    dayKey,
    isRth,
    minutesIntoRth: isRth ? p.minutes - rthOpen : null,
    ny: p,
  };
}

function nextDayKey(p) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** True when the instant crosses into a new trading session. */
export function isNewSession(prev, next, group) {
  if (!prev) return false;
  return sessionInfo(prev, group).dayKey !== sessionInfo(next, group).dayKey;
}
