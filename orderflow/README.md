# Orderflow Terminal

A real-time order flow, liquidity and dealer-gamma terminal. Footprint charts,
absorption, iceberg detection, liquidity sweeps, volume profile and a live GEX
map — built from market microstructure first principles on data feeds that cost
nothing.

Run it:

```bash
cd orderflow
npm install
npm run sim      # synthetic market, no network needed
npm run live     # Binance USD-M futures, real ticks
npm test
```

Then open <http://localhost:5174>.

## Why this can be free

Commercial order flow platforms are expensive mostly because CME order-by-order
data is expensive — the software rents you an entitlement. Crypto perpetual
venues publish the same class of data with no entitlement, no exchange fee and
no delayed tier:

| What the analysis needs | Where it comes from | Cost |
|---|---|---|
| Tick-by-tick prints **with the taker side** | Binance `aggTrade` (`m` flag) | free |
| Full L2 book, 100ms diffs | Binance `depth@100ms` + REST snapshot | free |
| Complete listed options chain with OI and IV | Deribit `get_book_summary_by_currency` | free |

That is everything the engine consumes. No key, no subscription, no delay.

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
feed (binance | sim) ──► engine ──► detectors ──► signals ──► scorer
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

Everything tunable lives in `src/config.js` and can be overridden by
environment variable:

```bash
FEED=binance SYMBOL=ETHUSDT TICK_SIZE=0.01 TICK_AGG=5 BAR_MS=60000 npm start
```

| Variable | Meaning |
|---|---|
| `FEED` | `sim` or `binance` |
| `SYMBOL` | contract, e.g. `BTCUSDT` |
| `TICK_SIZE` / `TICK_AGG` | footprint rows are `TICK_SIZE * TICK_AGG` wide |
| `BAR_MS` | bar interval |
| `OPTIONS_FEED` | `deribit` or `sim` |
| `SIM_SPEED` | simulator speed as a multiple of real time |

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

The engine, detectors, scoring, gamma map and terminal all work end to end
against the simulator, and the unit and replay tests cover the maths and every
detector. The Binance and Deribit feeds are written against the documented
protocols — including the buffer/snapshot/resync sequence the depth diff stream
requires — but have not been run against the live venues from this environment,
which has no outbound access to either. Run `npm run live` on a machine that
does before trusting a number.

Not included, and worth knowing before you rely on this: no order entry, no
broker connectivity, no historical replay from recorded data, and no
persistence beyond the signal-reliability file.
