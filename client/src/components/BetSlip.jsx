import { formatChips } from "../format";
import { streakMultiplier } from "./StreakBadge";
import { sfx } from "../sound";

export default function BetSlip({
  betOptions,
  selectedBet,
  onSelectBet,
  balance,
  onDeal,
  dealing,
  canSubmitGuess,
  onSubmitGuess,
  hasPin,
  onAddChips,
  streak = 0,
}) {
  const bonus = streakMultiplier(streak);
  return (
    <div className="bet-slip">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>{canSubmitGuess ? "Step 2 — Drop Your Pin" : "Step 1 — Place Your Bet"}</h3>
        <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onAddChips}>
          + Add Chips
        </button>
      </div>

      {!canSubmitGuess ? (
        <>
          <div className="chip-grid">
            {betOptions.map((amount) => (
              <button
                key={amount}
                className={`chip-btn ${selectedBet === amount ? "selected" : ""}`}
                disabled={dealing || amount > balance}
                onClick={() => {
                  sfx.chip();
                  onSelectBet(amount);
                }}
              >
                🪙{formatChips(amount)}
              </button>
            ))}
          </div>

          <button className="btn btn-primary" style={{ width: "100%" }} onClick={onDeal} disabled={dealing || selectedBet > balance}>
            {dealing ? "Dealing…" : `🎲 Deal — Bet ${formatChips(selectedBet)}`}
          </button>
        </>
      ) : (
        <>
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: "var(--text-dim)",
              lineHeight: 1.7,
            }}
          >
            {hasPin ? (
              <>✅ Pin placed. Lock it in, or click the map again to move it.</>
            ) : (
              <>👉 Look around, then click anywhere on the map below to drop your guess.</>
            )}
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={onSubmitGuess} disabled={!hasPin}>
            {hasPin ? "🔒 Lock In Guess" : "Drop a pin on the map"}
          </button>
        </>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: "var(--text-dim)" }}>
        <div style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 11, marginBottom: 8, color: "var(--text-dim)" }}>
          Payout odds
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 6 }}>
          <span>🎯 Within 50 km</span>
          <span style={{ textAlign: "right", color: "var(--gold-bright)", fontWeight: 700 }}>5x JACKPOT</span>
          <span>🟢 Within 300 km</span>
          <span style={{ textAlign: "right", color: "var(--green)", fontWeight: 700 }}>2.5x WIN</span>
          <span>🟢 Within 1000 km</span>
          <span style={{ textAlign: "right", color: "var(--green)", fontWeight: 700 }}>1.2x WIN</span>
          <span>🔵 Within 3000 km</span>
          <span style={{ textAlign: "right", color: "var(--neon-cyan)", fontWeight: 700 }}>0.5x PUSH</span>
          <span>🔴 Further / no guess</span>
          <span style={{ textAlign: "right", color: "var(--red)", fontWeight: 700 }}>BUST</span>
          {bonus > 1 && (
            <>
              <span>🔥 Streak of {streak}</span>
              <span style={{ textAlign: "right", color: "var(--gold-bright)", fontWeight: 700 }}>
                × {bonus} on every win
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
