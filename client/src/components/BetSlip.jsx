export default function BetSlip({ betOptions, selectedBet, onSelectBet, balance, onDeal, dealing, canSubmitGuess, onSubmitGuess, hasPin }) {
  return (
    <div className="bet-slip">
      <h3>Place Your Bet</h3>
      <div className="chip-grid">
        {betOptions.map((amount) => (
          <button
            key={amount}
            className={`chip-btn ${selectedBet === amount ? "selected" : ""}`}
            disabled={dealing || amount > balance}
            onClick={() => onSelectBet(amount)}
          >
            🪙{amount}
          </button>
        ))}
      </div>

      {!canSubmitGuess ? (
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={onDeal} disabled={dealing || selectedBet > balance}>
          {dealing ? "Dealing…" : `Deal — Bet ${selectedBet}`}
        </button>
      ) : (
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={onSubmitGuess} disabled={!hasPin}>
          {hasPin ? "Lock In Guess" : "Drop a pin on the map"}
        </button>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
        <div>🎯 &lt;50km → 5x JACKPOT</div>
        <div>🟢 &lt;300km → 2.5x WIN</div>
        <div>🟢 &lt;1000km → 1.2x WIN</div>
        <div>🔵 &lt;3000km → 0.5x PUSH</div>
        <div>🔴 further → BUST, bet lost</div>
      </div>
    </div>
  );
}
