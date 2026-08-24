# Orderflow Terminal

A real-time order flow, liquidity and dealer-gamma terminal for **futures and
equities** — MNQ, MES, NQ, ES, QQQ — with a crypto path alongside it. Footprint
charts, absorption, iceberg detection, liquidity sweeps, volume profile and a
live dealer gamma map, built from market microstructure first principles.

## Getting it running

Needs Node 20 or newer. From a fresh machine — Windows `cmd`, PowerShell,
macOS or Linux, the commands are identical:

```bash
git clone https://github.com/Djordje-tech/kockam.git
cd kockam/orderflow
npm install

npm run sim      # synthetic market, no account or network needed
npm run mnq      # live MNQ via tastytrade + dxFeed  (needs .env, see below)
npm run mes      # live MES
npm run nq       # live NQ
npm run qqq      # live QQQ
npm run live     # Binance USD-M futures (crypto path)
npm test
```

Then open <http://localhost:5174>.

`npm run` has to be issued from inside `kockam/orderflow` — that is where this
`package.json` lives. Running it from your home directory gives
`Missing script: "sim"`.

Every setting is a flag, so nothing depends on shell-specific syntax:

```bash
npm run live -- --symbol=ETHUSDT --tick-size=0.01 --tick-agg=10
node src/server.js --feed=sim --speed=40 --bar-ms=15000 --port=8080
```

If the live feed cannot reach the venue — it is blocked in some countries, and
corporate proxies often refuse websockets — it retries with backoff and then
tells you so. Point it at a reachable endpoint with `--rest=` and `--ws=`, or
stay on `npm run sim` in the meantime.

## Live futures: tastytrade + dxFeed

Set up once:

```bash
cp .env.example .env      # then fill in TT_LOGIN and TT_PASSWORD
npm run mnq
```

`.env` is git-ignored and the session token is held in memory only. After the
first login tastytrade issues a remember token; put it in `TT_REMEMBER_TOKEN`
and clear `TT_PASSWORD` if you would rather not keep a password on disk.

The tastytrade API itself is free with an account, and dxFeed is the same data
vendor the commercial order-flow platforms run on. What is *not* free is the
CME data subscription — enable it in tastytrade's own settings. That fee is
the real reason those platforms cost what they cost: you are renting an
entitlement, not software.

**Symbols.** `MNQ`, `MNQ1!`, `/MNQ` and `mnq` all mean the front month, and the
venue is asked which contract that currently is, because the roll follows
volume rather than the calendar. A dated contract like `MNQZ5` is charted as
itself. Tick size comes back with the contract, and footprint rows are sized
from it — 1.00-point rows on a 0.25-tick index future, 5-cent rows on an ETF.

**Gamma.** Nasdaq futures are moved by the gamma sitting in QQQ and NDX, not by
options on the future itself, so charting MNQ against MNQ's own thin chain
would draw a map of the wrong market. MNQ and NQ map to QQQ, MES and ES to SPY,
RTY to IWM; override with `--gamma-underlying=`.

**What each entitlement gets you.** Depth of market and the aggressor flag on
`TimeAndSale` are separately entitled at dxFeed. The terminal works at every
level and tells you which one you are on rather than pretending:

| | With depth + aggressor | Aggressor only | Neither |
|---|---|---|---|
| Footprint, delta, CVD, profile, imbalances | yes | yes | yes, inferred sides |
| Rejection, stacked zones, sweeps | yes | yes | yes |
| Absorption | yes | partial | partial |
| Icebergs, book pressure, ladder | yes | no | no |

## Who was the aggressor

Everything downstream — delta, footprint, absorption, CVD — rests on "did this
print lift the offer or hit the bid". Crypto venues stamp it on every trade.
Most equity and futures feeds do not: dxFeed's `Trade` event carries no side at
all, and `TimeAndSale` carries `aggressorSide` only when entitled.

`src/core/tradeClassifier.js` resolves it in descending order of trust: the
feed's own flag, then the quote rule (at or above the ask is a buy, at or below
the bid is a sell), then which side of the midpoint a print inside the spread
landed on, then the tick rule. That is Lee-Ready, with the one refinement that
matters live — quotes routinely update *ahead* of the print that caused them,
so classification runs against the quote that was standing 250ms earlier
rather than the instantaneous one.

The header then reports what actually happened: `100% aggressor` means the feed
told us, `78% inferred` means most of the chart is a reconstruction. A
footprint built from an entitled flag and one built from the tick rule are not
the same claim, and the trader reading it is entitled to know which they have.

## The crypto path

`npm run live` runs the same engine on Binance USD-M futures, where the data
happens to be free and unentitled:

| What the analysis needs | Where it comes from | Cost |
|---|---|---|
| Tick-by-tick prints **with the taker side** | Binance `aggTrade` (`m` flag) | free |
| Full L2 book, 100ms diffs | Binance `depth@100ms` + REST snapshot | free |
| Listed options chain with OI and IV | Deribit `get_book_summary_by_currency` | free |

Useful for testing detectors against real flow at 3am without a data bill.

## What it computes

Every number on screen is derived here, in `src/engine/`, from raw prints and
book updates.

**Footprint (`footprint.js`)** — per-bar, per-price-row bid and ask volume,
delta, delta extremes, point of control. Diagonal imbalances compare aggressive
buying at a row against aggressive selling one row below, because those two met
the same resting book; runs of three or more in the same direction become a
stacked zone, which is then tracked as a reference level.

**Absorption (`absorption.js`)** — heavy one-sided aggression at a price that
produces no price movement. Three conditions, all required: the volume is a
large multiple of the rolling median row volume, price never travelled more
than `maxTicks` rows in the aggressor's favour, and there is resting size on
the passive side. Any two of them alone fire constantly on ordinary chop.
When an absorption level later breaks, that is published too — the passive
side capitulating is the stronger signal, and most tools simply drop it.

**Icebergs (`iceberg.js`)** — measured, not guessed: volume actually traded at
a level versus the largest size ever displayed there. A replenish is counted
only on a real round trip (eaten to under half its high-water mark, then back
near it, with volume in between), which is what stops ordinary quote flicker
from manufacturing icebergs.

**Liquidity sweeps (`stopRun.js`)** — swing pivots, session extremes, stacked
imbalance edges and gamma strikes are all tracked as stop pools. A poke past
one on a volume burst arms the signal; a reclaim confirms it as a failed
breakout; no reclaim inside the window publishes the opposite conclusion —
`breakoutHeld` — instead of quietly forgetting the setup.

**Rejection (`rejection.js`)** — a long wick is a shape, not information. It
qualifies only when the volume inside the wick was aggressive *in the direction
of the excursion*, i.e. the people who chased it are underwater at the close.

**Volume profile (`volumeProfile.js`)** — session profile, 70% value area,
HVN/LVN from a smoothed profile, and naked points of control carried forward.

**Sessions and levels (`sessions.js`, `vwap.js`)** — a continuous stream has no
boundaries but the market does. Globex opens at 18:00 New York and the trading
day starts there, not at midnight and not at the cash open, so that is where
the profile, cumulative delta and VWAP reset and where yesterday becomes
reference rather than being thrown away. Out of that fall the levels a futures
day is actually traded off: prior day high, low, close, POC and value area
(PDH/PDL/PDC/PDPOC/PDVAH/PDVAL), the overnight range (ONH/ONL), the first hour's
initial balance (IBH/IBL) and the cash open. Each one is fed straight to the
sweep detector, because that is exactly where the stops are. VWAP carries ±1σ
and ±2σ bands computed from running sums, and the header reports position in
deviations rather than points, which mean nothing without the day's range.

**Dealer gamma (`gamma.js`, `blackScholes.js`)** — Black-Scholes gamma per
contract from mark IV and open interest, aggregated by strike as dollar-delta
rehedged per 1% spot move, with dealers assumed long calls and short puts. Net
GEX by strike gives the call wall and put wall. The gamma flip is solved by
scanning candidate spot levels for the sign change in aggregate gamma rather
than by walking cumulative GEX by strike, which lands on the wrong side of the
map whenever the surface is skewed. Vanna and charm are computed alongside.

## The part nobody else ships

Every signal is scored against what price actually did next (`scorer.js`).
Whichever comes first — four rows in the signal's favour or four against —
decides the outcome, and the running hit rate and expectancy per signal type
are published *with the signals themselves*.

So the panel does not just say "absorption at 104,050". It says absorption has
fired 128 times today and resolved in its own direction 56% of them. A detector
that is misfiring in the current regime is visible instead of trusted, which is
the opposite of how indicator suites are normally sold.

## Architecture

```
feed (tastytrade | binance | sim)
        │
        ├─ trades ──► classifier ──► engine ──► detectors ──► signals ──► scorer
                           │                         │
                           ├──► footprint bars       └──► reliability table
                           ├──► volume profile
                           ├──► order book + levels
                           └──► GEX map (deribit | sim)
                                     │
                          coalesced 10Hz frames over WebSocket
                                     │
                              canvas terminal
```

Detectors are independent: each owns its state and returns events rather than
mutating anything shared, so adding one is a file plus two lines in
`engine.js`, and a noisy one can be switched off without touching the pipeline.

The transport coalesces: trades arrive faster than a browser can paint, so the
server emits one frame per 100ms carrying the newest bar state, the book and
any signals that fired in between. Signals are never dropped — only redundant
intermediate bar states are. The client folds frames into one mutable state
object and renders on `requestAnimationFrame`, never on message arrival, which
is what keeps a tick-rate UI from stuttering.

Rendering is immediate-mode canvas. A footprint bar is a few dozen text cells
and a screen holds hundreds of bars at 10Hz; that is fine for canvas and
hopeless for retained-mode DOM.

## The simulator

`FEED=sim` is not a placeholder. The detectors are all "does this pattern exist
in the flow" questions, and the only honest way to test them is a feed where
the answer is known in advance. `simFeed.js` runs a seeded, reproducible market
that deliberately scripts absorption, icebergs and stop runs at known times;
`test/detectors.test.js` replays it through the full engine with no timers and
asserts each detector fires. `SIM_SPEED` is a multiple of real time, so a
60-second bar closes every `60/SIM_SPEED` seconds.

One caveat the simulator makes obvious: it republishes its whole visible book
on every update, where a real diff stream only publishes changed levels. That
inflates iceberg counts under `FEED=sim` relative to `FEED=binance`.

## Configuration

Everything tunable lives in `src/config.js`. Each setting resolves as
**flag, then environment variable, then default** — flags exist because
`FEED=sim node ...` is POSIX-only shell syntax that fails in Windows `cmd` and
PowerShell.

| Flag | Env | Meaning |
|---|---|---|
| `--feed=` | `FEED` | `tastytrade`, `binance` or `sim` |
| `--symbol=` | `SYMBOL` | contract, e.g. `BTCUSDT` |
| `--tick-size=` / `--tick-agg=` | `TICK_SIZE` / `TICK_AGG` | footprint rows are their product |
| `--bar-ms=` | `BAR_MS` | bar interval |
| `--port=` | `PORT` | http port, default 5174 |
| `--speed=` | `SIM_SPEED` | simulator speed as a multiple of real time |
| `--options-feed=` | `OPTIONS_FEED` | `deribit` or `sim` |
| `--gamma-underlying=` | `GAMMA_UNDERLYING` | which chain builds the gamma map |
| `--depth=` | `TT_DEPTH` | depth-of-market levels to request |
| — | `TT_LOGIN` / `TT_PASSWORD` / `TT_REMEMBER_TOKEN` | tastytrade credentials, from `.env` |
| `--rest=` / `--ws=` | `BINANCE_REST` / `BINANCE_WS` | override venue endpoints |

## Controls

Wheel zooms price rows, shift-wheel zooms bar width, drag pans, double click
returns to following the market. `F` `I` `P` `G` `S` `L` toggle footprint
numbers, imbalances, profile, gamma levels, signals and the liquidity strip.

## HTTP

| Route | Returns |
|---|---|
| `GET /api/snapshot` | full engine state |
| `GET /api/gamma` | current GEX map |
| `GET /api/signals` | recent signals, reliability table, resolved history |
| `GET /api/health` | feed status |
| `WS /stream` | snapshot on connect, then 10Hz frames |

## Status

The engine, detectors, scoring, gamma map and terminal work end to end against
the simulator, and 30 unit and replay tests cover the maths, the classifier,
the contract and session logic, and every detector.

The live feeds are written against documented protocols and, for tastytrade,
against the official `@dxfeed/dxlink-api` client and the tastytrade SDK's own
endpoints — so there is no guessed wire format anywhere. But this development
environment has no outbound access to tastytrade, dxFeed, Binance or Deribit,
so **no live venue path has been exercised end to end**. Symbol resolution,
entitlement fallbacks and the depth translation are written carefully and
tested where they are pure functions; they have not seen a real session. Run
`npm run mnq` on a machine with access before trusting a number on the screen.

Not included, and worth knowing before you rely on this: no order entry, no
broker connectivity, no historical replay from recorded data, and no
persistence beyond the signal-reliability file.
