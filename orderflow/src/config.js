// Central tuning surface. Everything a detector needs to be re-tuned per
// instrument lives here so the engine code stays free of magic numbers.

/**
 * Settings resolve as: command-line flag, then environment variable, then the
 * default here. Flags matter because `FEED=sim node ...` is POSIX-only shell
 * syntax — it fails outright in Windows cmd and PowerShell — so every npm
 * script passes `--feed=sim` instead and works the same on all three.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Credentials live in orderflow/.env, which is git-ignored. Loaded by hand
// rather than with a dependency: it is a dozen lines and one fewer thing to
// audit for something that reads a password file.
loadDotEnv();

const env = process.env;

const flags = new Map(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i === -1 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
    }),
);

/** @param {string} flag CLI name, @param {string} envName env var name */
const opt = (flag, envName, fallback) => flags.get(flag) ?? env[envName] ?? fallback;
const num = (flag, envName, fallback) => Number(opt(flag, envName, fallback));

const feed = String(opt('feed', 'FEED', 'sim')).toLowerCase();

export const config = {
  feed,                                 // 'sim' | 'binance'
  symbol: String(opt('symbol', 'SYMBOL', 'BTCUSDT')).toUpperCase(),
  optionsFeed: opt('options-feed', 'OPTIONS_FEED', feed === 'binance' ? 'deribit' : 'sim'),
  optionsCurrency: opt('options-currency', 'OPTIONS_CURRENCY', 'BTC'),
  port: num('port', 'PORT', 5174),
  simSpeed: num('speed', 'SIM_SPEED', 12),
  // Overridable so a blocked or regional endpoint can be pointed elsewhere.
  binanceRest: opt('rest', 'BINANCE_REST', 'https://fapi.binance.com'),
  binanceWs: opt('ws', 'BINANCE_WS', 'wss://fstream.binance.com'),

  // tastytrade + dxFeed: the futures and equities path.
  tastytrade: {
    baseUrl: opt('tt-url', 'TT_URL', 'https://api.tastyworks.com'),
    login: opt('tt-login', 'TT_LOGIN', ''),
    password: opt('tt-password', 'TT_PASSWORD', ''),
    rememberToken: opt('tt-remember', 'TT_REMEMBER_TOKEN', ''),
    depthLimit: num('depth', 'TT_DEPTH', 20),
  },
  // Which underlying's options build the gamma map. NQ and MNQ have no liquid
  // options of their own worth mapping, so the Nasdaq gamma that actually
  // moves them is QQQ's; left empty it is derived in resolveInstrument().
  gammaUnderlying: opt('gamma-underlying', 'GAMMA_UNDERLYING', ''),
  gammaMaxStrikes: num('gamma-strikes', 'GAMMA_STRIKES', 400),

  // Price bucketing. Footprint rows are tickSize * tickAggregation wide.
  tickSize: num('tick-size', 'TICK_SIZE', 1),
  tickAggregation: num('tick-agg', 'TICK_AGG', 5),

  // Bar construction
  bar: {
    intervalMs: num('bar-ms', 'BAR_MS', 60_000),
    maxBars: 600,
  },

  footprint: {
    imbalanceRatio: 3,      // diagonal ask[p] vs bid[p-1] ratio to flag
    minImbalanceVol: 0.4,   // in contracts/coins, ignore dust levels
    stackedMin: 3,          // consecutive imbalanced rows = stacked zone
  },

  absorption: {
    windowMs: 12_000,
    maxTicks: 3,            // price may not travel further than this, in rows
    volumeMultiple: 3.0,    // aggressive vol vs rolling median row volume
    minEvents: 12,          // min number of prints at the level
    cooldownMs: 20_000,
  },

  iceberg: {
    minRefills: 4,          // level replenished this many times
    hiddenMultiple: 2.5,    // traded volume vs largest displayed size
    reportCooldownMs: 15_000,
    ttlMs: 90_000,
  },

  stopRun: {
    sweepTicks: 6,          // how far past the level counts as a sweep
    reclaimTicks: 2,        // how far back inside counts as a reclaim
    reclaimMs: 45_000,      // reclaim must happen inside this window
    burstMultiple: 2.5,     // aggressive volume burst vs baseline
    burstMs: 3_000,
    pivotLookback: 3,       // bars each side for a swing pivot
  },

  rejection: {
    minWickRatio: 0.55,     // wick / total bar range
    minExtremeVolShare: 0.2,// share of bar volume printed in the wick
    minBodyOpposition: 0.0, // delta at the extreme must oppose the wick
  },

  profile: {
    valueAreaPct: 0.7,
    hvnLvnSmoothing: 3,
  },

  gamma: {
    riskFreeRate: 0.045,
    contractMultiplier: 1,  // Deribit BTC options = 1 BTC
    maxDaysOut: 45,         // ignore far-dated noise
    refreshMs: 60_000,
  },

  // Every signal is scored against what price did afterwards.
  scoring: {
    horizonMs: 120_000,
    successTicks: 4,        // rows of favourable travel = a win
    failTicks: 4,           // rows against = a loss
  },
};

/**
 * Footprint row width. A live feed resolves the real tick size at connect
 * time, so this reads `config` on every call rather than freezing a value at
 * import — a row size baked in before the instrument was known would silently
 * bucket a 0.25-tick future as if it were a 1.00-tick one.
 */
export const rowSize = () => config.tickSize * config.tickAggregation;

/** Applied once a feed reports what it actually connected to. */
export function applyInstrument({ tickSize, tickAggregation, symbol }) {
  if (tickSize > 0) config.tickSize = tickSize;
  if (tickAggregation > 0) config.tickAggregation = tickAggregation;
  if (symbol) config.resolvedSymbol = symbol;
}

/** Row aggregation that makes a readable footprint for each kind of product. */
export function defaultAggregation(group) {
  switch (group) {
    case 'equityIndex': return 4;    // 1.00 point rows on a 0.25 tick
    case 'etf': return 5;            // 5 cent rows
    case 'energy': return 5;
    case 'metals': return 5;
    default: return config.tickAggregation;
  }
}

function loadDotEnv() {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(dir, '..', '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i === -1) continue;
      const key = trimmed.slice(0, i).trim();
      let value = trimmed.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Real environment variables win, so a shell override still works.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch { /* a malformed .env should not stop the terminal booting */ }
}
