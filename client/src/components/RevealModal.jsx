import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "./Confetti";
import { useCountUp } from "../useCountUp";
import { nextStreakMultiplier, streakMultiplier } from "./StreakBadge";
import { sfx } from "../sound";

const RESULT_LABEL = {
  JACKPOT: "🎉 JACKPOT!",
  WIN: "✅ WIN",
  PUSH: "➖ PUSH",
  BUST: "💥 BUST",
};

// How hard the card reacts to the result. A jackpot gets thrown at you; a
// bust gets shaken off.
const ENTRANCE = {
  JACKPOT: { scale: [0.6, 1.12, 1], rotate: [-4, 2, 0] },
  WIN: { scale: [0.8, 1.04, 1] },
  PUSH: { scale: [0.9, 1] },
  BUST: { scale: [0.9, 1], x: [0, -14, 12, -8, 5, 0] },
};

export default function RevealModal({ reveal, onClose }) {
  const isJackpot = reveal?.result === "JACKPOT";
  const payout = reveal?.payout ?? 0;
  const counted = useCountUp(payout, isJackpot ? 1300 : 800, !!reveal && payout > 0);

  useEffect(() => {
    if (!reveal) return;
    if (reveal.result === "JACKPOT") sfx.jackpot();
    else if (reveal.result === "WIN") sfx.win();
    else if (reveal.result === "PUSH") sfx.push();
    else sfx.bust();
    if (payout > 0) sfx.counting();

    // The streak deserves its own note, after the result has landed.
    const timers = [];
    if (reveal.streak > (reveal.streakBefore ?? 0)) {
      timers.push(setTimeout(() => sfx.streakUp(reveal.streak), 500));
    } else if ((reveal.streakBefore ?? 0) >= 2 && reveal.streak === 0) {
      timers.push(setTimeout(() => sfx.streakLost(), 500));
    }
    if (reveal.nearMiss) timers.push(setTimeout(() => sfx.nearMiss(), 850));
    return () => timers.forEach(clearTimeout);
  }, [reveal, payout]);

  if (!reveal) return null;

  const net = reveal.payout - reveal.betAmount;
  const netCounted = payout > 0 ? counted - reveal.betAmount : net;
  const streakBefore = reveal.streakBefore ?? 0;
  const streakLost = streakBefore >= 2 && reveal.streak === 0;
  const bonus = reveal.streakBonus ?? 1;

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <Confetti active={isJackpot} />
        <motion.div
          className={`reveal-card result-${reveal.result}`}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1, ...(ENTRANCE[reveal.result] || ENTRANCE.PUSH) }}
          transition={{ type: "spring", stiffness: 260, damping: 18, duration: 0.6 }}
        >
          <div className={`reveal-result ${reveal.result}`}>{RESULT_LABEL[reveal.result]}</div>
          <div className="reveal-sub">
            It was <strong>{reveal.locationName}</strong>
            {reveal.timedOut ? " — time ran out" : `, ${reveal.distanceKm} km away`}
          </div>

          {/* The sting: how little was between this guess and a bigger payout. */}
          {reveal.nearMiss && (
            <motion.div
              className="near-miss"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
            >
              😤 {reveal.nearMiss.gapKm} km short of a {reveal.nearMiss.tier} ({reveal.nearMiss.tierMultiplier}x)
            </motion.div>
          )}

          <div className="reveal-stats">
            <div className="stat-box">
              <div className="label">Bet</div>
              <div className="value">🪙{reveal.betAmount.toLocaleString()}</div>
            </div>
            <div className="stat-box">
              <div className="label">Payout</div>
              <div className="value" style={{ color: netCounted >= 0 ? "var(--green)" : "var(--red)" }}>
                {netCounted >= 0 ? "+" : "-"}🪙{Math.abs(netCounted).toLocaleString()}
              </div>
            </div>
            {!reveal.timedOut && (
              <>
                <div className="stat-box">
                  <div className="label">Distance</div>
                  <div className="value">{reveal.distanceKm} km</div>
                </div>
                <div className="stat-box">
                  <div className="label">Multiplier</div>
                  <div className="value">
                    {reveal.multiplier}x
                    {bonus > 1 && <span className="bonus-mult"> × {bonus}x 🔥</span>}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Where the run stands now — and what the next win is worth. */}
          {reveal.streak > 0 && (
            <motion.div
              className="streak-line up"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, type: "spring", stiffness: 300 }}
            >
              🔥 {reveal.streak} in a row
              {nextStreakMultiplier(reveal.streak) > streakMultiplier(reveal.streak) ? (
                <> — one more win and every payout goes {nextStreakMultiplier(reveal.streak)}x</>
              ) : (
                <> — payouts running at {streakMultiplier(reveal.streak)}x</>
              )}
            </motion.div>
          )}
          {streakLost && (
            <motion.div
              className="streak-line lost"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
            >
              💔 Streak of {streakBefore} gone — that run was paying {streakMultiplier(streakBefore)}x
            </motion.div>
          )}

          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={() => {
              sfx.click();
              onClose();
            }}
          >
            Next Round
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
