import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeClassifier } from '../src/core/tradeClassifier.js';
import { parseSymbol, frontMonth, thirdFriday, sessionInfo } from '../src/instruments/futures.js';

test('an explicit aggressor side always wins', () => {
  const c = new TradeClassifier();
  c.onQuote({ bid: 100, ask: 101, ts: 0 });
  assert.equal(c.classify({ price: 100, ts: 1000, side: 'Buy' }), 'buy',
    'the feed said buy, even though the print was at the bid');
  assert.equal(c.classify({ price: 101, ts: 1000, side: 'SELL' }), 'sell');
  assert.equal(c.stats.explicit, 2);
});

test('dxFeed "Undefined" falls through to the quote rule', () => {
  const c = new TradeClassifier({ quoteLagMs: 0 });
  c.onQuote({ bid: 100, ask: 101, ts: 0 });
  assert.equal(c.classify({ price: 101, ts: 10, side: 'Undefined' }), 'buy');
  assert.equal(c.classify({ price: 100, ts: 20, side: undefined }), 'sell');
  assert.equal(c.stats.explicit, 0);
  assert.equal(c.stats.quote, 2);
});

test('prints inside the spread split on the midpoint', () => {
  const c = new TradeClassifier({ quoteLagMs: 0 });
  c.onQuote({ bid: 100, ask: 104, ts: 0 });
  assert.equal(c.classify({ price: 103, ts: 10 }), 'buy');
  assert.equal(c.classify({ price: 101, ts: 20 }), 'sell');
  assert.equal(c.stats.midpoint, 2);
});

test('a print exactly at the midpoint uses the tick rule, then repeats itself', () => {
  const c = new TradeClassifier({ quoteLagMs: 0 });
  c.onQuote({ bid: 100, ask: 102, ts: 0 });
  c.classify({ price: 102, ts: 10 });                          // buy, sets lastPrice
  assert.equal(c.classify({ price: 101, ts: 20 }), 'sell', 'down from 102 is a sell');
  assert.equal(c.classify({ price: 101, ts: 30 }), 'sell', 'unchanged repeats');
});

test('classification uses the quote from before the trade, not the one it caused', () => {
  const c = new TradeClassifier({ quoteLagMs: 200 });
  c.onQuote({ bid: 100, ask: 101, ts: 0 });      // the market before the sweep
  c.onQuote({ bid: 101, ask: 102, ts: 900 });    // the book has already moved up
  // A print at 101 against the *new* quote reads as a sell at the bid. Against
  // the quote that was standing when the order arrived it is a buy at the ask,
  // which is what actually happened.
  assert.equal(c.classify({ price: 101, ts: 1000 }), 'buy');
});

test('with no quote at all it degrades to the tick rule instead of failing', () => {
  const c = new TradeClassifier();
  assert.equal(c.classify({ price: 100, ts: 1 }), 'buy', 'first print seeds the state');
  assert.equal(c.classify({ price: 99, ts: 2 }), 'sell');
  assert.equal(c.classify({ price: 101, ts: 3 }), 'buy');
  assert.equal(c.quality().tick, 3);
});

test('quality reports lower confidence when sides were guessed', () => {
  const explicit = new TradeClassifier();
  for (let i = 0; i < 10; i++) explicit.classify({ price: 100, ts: i, side: 'Buy' });
  assert.equal(explicit.quality().confidence, 1);

  const guessed = new TradeClassifier();
  for (let i = 0; i < 10; i++) guessed.classify({ price: 100 + i, ts: i });
  assert.ok(guessed.quality().confidence < 0.6);
});

test('symbols resolve however the trader happens to type them', () => {
  for (const s of ['MNQ1!', '/MNQ', 'mnq', 'MNQ']) {
    assert.equal(parseSymbol(s).product, 'MNQ');
    assert.equal(parseSymbol(s).spec.tickSize, 0.25);
  }
  assert.equal(parseSymbol('QQQ').kind, 'equity');
  assert.equal(parseSymbol('MNQZ5').continuous, false, 'a dated contract is not the front month');
  assert.equal(parseSymbol('ES1!').spec.multiplier, 50);
});

test('front month rolls ahead of expiry rather than on it', () => {
  const expiry = thirdFriday(2026, 8);                      // 18 Sep 2026
  const before = frontMonth('MNQ', new Date(expiry.getTime() - 20 * 864e5));
  assert.equal(before.monthCode, 'U', 'still September with 20 days to go');
  const inRoll = frontMonth('MNQ', new Date(expiry.getTime() - 5 * 864e5));
  assert.equal(inRoll.monthCode, 'Z', 'inside the roll window it is already December');
});

test('the trading day flips at the Globex open, not at midnight', () => {
  const afternoon = sessionInfo(new Date('2026-08-24T20:00:00Z'));   // 16:00 NY
  const evening = sessionInfo(new Date('2026-08-24T23:00:00Z'));     // 19:00 NY
  assert.equal(afternoon.dayKey, '2026-08-24');
  assert.equal(evening.dayKey, '2026-08-25', 'after 18:00 NY belongs to the next session');
  assert.equal(sessionInfo(new Date('2026-08-24T14:00:00Z')).session, 'RTH');
  assert.equal(afternoon.session, 'ETH');
});
