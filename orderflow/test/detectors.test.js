import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderFlowEngine } from '../src/engine/engine.js';
import { SimFeed, simOptionsChain } from '../src/feeds/simFeed.js';
import { AbsorptionDetector } from '../src/engine/absorption.js';
import { RejectionDetector } from '../src/engine/rejection.js';
import { FootprintBuilder } from '../src/engine/footprint.js';
import { SignalScorer } from '../src/engine/scorer.js';
import { OrderBook } from '../src/core/orderBook.js';

/** Replay the scripted simulator through the full engine, deterministically. */
function replay({ steps = 20_000, seed = 7 } = {}) {
  const engine = new OrderFlowEngine({ symbol: 'TESTUSDT' });
  engine.footprint.intervalMs = 4_000;      // short bars so bar-close logic runs
  const feed = new SimFeed({ seed, startPrice: 104_000, startTs: 1_700_000_000_000 });
  const signals = [];
  engine.on('signal', (s) => signals.push(s));
  feed.on('trade', (t) => engine.onTrade(t));
  feed.on('depth', (d) => engine.onDepth(d));
  feed.runSync(steps);
  engine.onOptionsChain(simOptionsChain(engine.last.price), engine.last.price);
  return { engine, signals, byType: (t) => signals.filter((s) => s.type === t) };
}

test('a scripted replay produces bars, a profile and a tradeable book', () => {
  const { engine } = replay();
  assert.ok(engine.bars.size > 10, 'bars were closed');
  assert.ok(engine.sessionProfile.total > 0);
  assert.ok(engine.book.bestBid() < engine.book.bestAsk(), 'book never crosses');
  assert.ok(engine.sessionProfile.valueArea().vah >= engine.sessionProfile.valueArea().val);
});

test('every detector fires on a replay that scripts its pattern', () => {
  const { signals, byType } = replay();
  assert.ok(signals.length > 20, `expected a stream of signals, got ${signals.length}`);
  for (const type of ['absorption', 'iceberg', 'stackedImbalance']) {
    assert.ok(byType(type).length > 0, `${type} never fired`);
  }
  const sweeps = [...byType('stopRunArmed'), ...byType('stopRun'), ...byType('breakoutHeld')];
  assert.ok(sweeps.length > 0, 'no sweep of any reference level was detected');
});

test('signals carry a direction, a price and a strength the UI can rank by', () => {
  const { signals } = replay();
  for (const s of signals) {
    assert.ok(['bullish', 'bearish'].includes(s.bias), `bad bias on ${s.type}`);
    assert.ok(Number.isFinite(s.price) && s.price > 0);
    assert.ok(s.strength >= 0 && s.strength <= 1, `${s.type} strength out of range`);
    assert.ok(typeof s.note === 'string' && s.note.length > 0);
  }
});

test('scoring resolves signals and reports a hit rate per type', () => {
  const { engine } = replay();
  const table = engine.scorer.table();
  assert.ok(table.length > 0);
  for (const row of table) {
    assert.ok(row.fired > 0);
    if (row.wins + row.losses > 0) {
      assert.ok(row.hitRate >= 0 && row.hitRate <= 1);
    }
  }
});

test('absorption needs heavy volume, no price progress and a resting bid', () => {
  const det = new AbsorptionDetector({ minEvents: 5, volumeMultiple: 1, cooldownMs: 0, maxTicks: 2 });
  const book = new OrderBook();
  book.applySnapshot({ bids: [[100, 500]], asks: [[101, 5]] });
  let fired = null;
  for (let i = 0; i < 40 && !fired; i++) {
    fired = det.onTrade({ ts: 1000 + i * 10, price: 100, qty: 5, side: 'sell' }, book);
  }
  assert.ok(fired, 'heavy selling into a held bid is absorption');
  assert.equal(fired.kind, 'sellersAbsorbed');
  assert.equal(fired.bias, 'bullish');

  // Same flow, but the bid is not there: nothing is absorbing anything.
  const det2 = new AbsorptionDetector({ minEvents: 5, volumeMultiple: 1, cooldownMs: 0, maxTicks: 2 });
  const empty = new OrderBook();
  empty.applySnapshot({ bids: [], asks: [[101, 5]] });
  let fired2 = null;
  for (let i = 0; i < 40 && !fired2; i++) {
    fired2 = det2.onTrade({ ts: 1000 + i * 10, price: 100, qty: 5, side: 'sell' }, empty);
  }
  assert.equal(fired2, null, 'no resting liquidity means no absorption');
});

test('absorption that breaks reports the failure as the opposite signal', () => {
  // A real cooldown, so the level is reported once rather than on every print.
  const det = new AbsorptionDetector({ minEvents: 5, volumeMultiple: 1, cooldownMs: 60_000, maxTicks: 2 });
  const book = new OrderBook();
  book.applySnapshot({ bids: [[100, 500]], asks: [[101, 5]] });
  for (let i = 0; i < 40; i++) det.onTrade({ ts: 1000 + i * 10, price: 100, qty: 5, side: 'sell' }, book);
  const broken = det.onPriceUpdate(80);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].type, 'absorptionFailed');
  assert.equal(broken[0].bias, 'bearish', 'the holder capitulated, so price goes with the sellers');
});

test('rejection needs the wick aggression pointing the wrong way', () => {
  const build = (wickSide) => {
    const fb = new FootprintBuilder({ intervalMs: 10_000 });
    let ts = 0;
    const t = (price, qty, side) => fb.onTrade({ ts: ts += 5, price, qty, side });
    t(100, 5, 'buy');
    if (wickSide === 'trapped') {
      for (let i = 0; i < 8; i++) t(140, 6, 'buy');    // chased the high, then back
    } else {
      for (let i = 0; i < 8; i++) t(140, 6, 'sell');   // sold the high — not trapped
    }
    t(101, 5, 'sell');
    return fb.finalize(fb.current);
  };
  const det = new RejectionDetector({ minWickRatio: 0.4, minExtremeVolShare: 0.2 });
  const trapped = det.onBarClose(build('trapped'));
  assert.ok(trapped?.some((r) => r.bias === 'bearish'), 'buyers trapped in the high is a rejection');
  assert.equal(det.onBarClose(build('willing')), null, 'sellers hitting the high is not a trap');
});

test('the scorer marks a win only when price travels far enough in time', () => {
  const s = new SignalScorer({ successTicks: 2, failTicks: 2, horizonMs: 10_000 });
  s.track({ type: 'x', bias: 'bullish', ts: 0, price: 100, strength: 1 });
  assert.equal(s.onPrice(105, 1_000).length, 0, 'one row of travel is not enough');
  const won = s.onPrice(115, 2_000);
  assert.equal(won[0].outcome, 'win');

  s.track({ type: 'x', bias: 'bullish', ts: 3_000, price: 100, strength: 1 });
  assert.equal(s.onPrice(101, 20_000)[0].outcome, 'neutral', 'stale signals expire flat');
  assert.equal(s.summaryFor('x').fired, 2);
  assert.equal(s.summaryFor('x').hitRate, 1);
});
