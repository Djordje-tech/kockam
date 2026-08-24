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

test('a session rolls at the Globex open and yesterday becomes reference', async (t) => {
  const { SessionManager } = await import('../src/engine/sessions.js');
  const m = new SessionManager();
  const at = (iso, price, qty = 1) =>
    m.onTrade({ ts: new Date(iso).getTime(), price, qty, side: 'buy' });

  at('2026-08-24T14:00:00Z', 100);          // 10:00 NY — regular trade
  at('2026-08-24T14:30:00Z', 105);
  at('2026-08-24T15:30:00Z', 95);
  at('2026-08-24T20:00:00Z', 102);          // 16:00 NY — after the bell
  const rolled = at('2026-08-24T23:00:00Z', 101);   // 19:00 NY — new session

  assert.ok(rolled, 'crossing 18:00 New York ends the session');
  assert.equal(rolled.dayKey, '2026-08-24');
  assert.equal(rolled.high, 105);
  assert.equal(rolled.low, 95);
  assert.equal(rolled.close, 102);

  at('2026-08-25T02:00:00Z', 108);          // overnight
  const s = m.snapshot();
  assert.equal(s.session.overnight.high, 108);
  assert.equal(s.session.overnight.low, 101);

  const codes = s.levels.map((l) => l.code);
  for (const code of ['PDH', 'PDL', 'PDC', 'ONH', 'ONL']) {
    assert.ok(codes.includes(code), `${code} should be published as a level`);
  }
  assert.equal(s.levels.find((l) => l.code === 'PDH').price, 105);
});

test('the initial balance closes an hour after the cash open', async () => {
  const { SessionManager } = await import('../src/engine/sessions.js');
  const m = new SessionManager();
  const at = (iso, price) =>
    m.onTrade({ ts: new Date(iso).getTime(), price, qty: 1, side: 'buy' });

  at('2026-08-25T13:35:00Z', 100);          // 09:35 NY
  at('2026-08-25T14:20:00Z', 110);          // 10:20 NY, still inside the hour
  assert.equal(m.snapshot().session.initialBalance.high, 110);

  at('2026-08-25T15:00:00Z', 130);          // 11:00 NY, the hour is up
  const ib = m.snapshot().session.initialBalance;
  assert.equal(ib.complete, true);
  assert.equal(ib.high, 110, 'a later high does not widen the initial balance');
});

test('VWAP bands widen with dispersion, not with price level', async () => {
  const { Vwap } = await import('../src/engine/vwap.js');
  const tight = new Vwap();
  const wide = new Vwap();
  for (let i = 0; i < 100; i++) {
    tight.onTrade({ price: 100 + (i % 2), qty: 1, ts: i });
    wide.onTrade({ price: 100 + (i % 2) * 40, qty: 1, ts: i });
  }
  assert.ok(Math.abs(tight.value - 100.5) < 0.01);
  assert.ok(wide.sigma > tight.sigma * 10);
  assert.ok(tight.bands().upper1 > tight.value && tight.bands().lower1 < tight.value);
});

test('VWAP weights by size, so one big print moves it more than many small ones', async () => {
  const { Vwap } = await import('../src/engine/vwap.js');
  const v = new Vwap();
  for (let i = 0; i < 9; i++) v.onTrade({ price: 100, qty: 1, ts: i });
  v.onTrade({ price: 200, qty: 91, ts: 10 });
  assert.ok(v.value > 190, `one 91-lot at 200 should dominate nine 1-lots, got ${v.value}`);
});
