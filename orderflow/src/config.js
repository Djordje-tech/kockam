// Central tuning surface. Everything a detector needs to be re-tuned per
// instrument lives here so the engine code stays free of magic numbers.

/**
 * Settings resolve as: command-line flag, then environment variable, then the
 * default here. Flags matter because `FEED=sim node ...` is POSIX-only shell
 * syntax — it fails outright in Windows cmd and PowerShell — so every npm
 * script passes `--feed=sim` instead and works the same on all three.
 */
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

export const rowSize = config.tickSize * config.tickAggregation;
