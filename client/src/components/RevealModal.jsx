import { motion, AnimatePresence } from "framer-motion";

const RESULT_LABEL = {
  JACKPOT: "🎉 JACKPOT!",
  WIN: "✅ WIN",
  PUSH: "➖ PUSH",
  BUST: "💥 BUST",
};

export default function RevealModal({ reveal, onClose }) {
  if (!reveal) return null;
  const net = reveal.payout - reveal.betAmount;

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div
          className="reveal-card"
          initial={{ scale: 0.85, y: 30, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <div className={`reveal-result ${reveal.result}`}>{RESULT_LABEL[reveal.result]}</div>
          <div className="reveal-sub">
            It was <strong>{reveal.locationName}</strong>
            {reveal.timedOut ? " — time ran out" : `, ${reveal.distanceKm} km away`}
          </div>

          <div className="reveal-stats">
            <div className="stat-box">
              <div className="label">Bet</div>
              <div className="value">🪙{reveal.betAmount}</div>
            </div>
            <div className="stat-box">
              <div className="label">Payout</div>
              <div className="value" style={{ color: net >= 0 ? "var(--green)" : "var(--red)" }}>
                {net >= 0 ? "+" : "-"}🪙{Math.abs(net)}
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
                  <div className="value">{reveal.multiplier}x</div>
                </div>
              </>
            )}
          </div>

          <button className="btn btn-primary" style={{ width: "100%" }} onClick={onClose}>
            Next Round
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
