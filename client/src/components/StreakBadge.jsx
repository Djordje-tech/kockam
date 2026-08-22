import { motion, AnimatePresence } from "framer-motion";

// The streak ladder, mirrored from the server's STREAK_BONUS in scoring.js.
export const STREAK_TIERS = [
  { minStreak: 6, multiplier: 3 },
  { minStreak: 5, multiplier: 2.5 },
  { minStreak: 4, multiplier: 2 },
  { minStreak: 3, multiplier: 1.5 },
  { minStreak: 2, multiplier: 1.2 },
  { minStreak: 0, multiplier: 1 },
];

export const streakMultiplier = (streak) =>
  STREAK_TIERS.find((t) => streak >= t.minStreak).multiplier;

// What a win at the next streak level would be worth — the carrot.
export const nextStreakMultiplier = (streak) => streakMultiplier(streak + 1);

const heatClass = (streak) => {
  if (streak >= 6) return "streak-badge blazing";
  if (streak >= 4) return "streak-badge hot";
  return "streak-badge warm";
};

export default function StreakBadge({ streak = 0, atRisk = false }) {
  return (
    <AnimatePresence>
      {streak >= 1 && (
        <motion.div
          key="streak"
          className={`${heatClass(streak)}${atRisk ? " at-risk" : ""}`}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
          title={
            streak >= 2
              ? `${streak} wins in a row — payouts multiplied by ${streakMultiplier(streak)}x. A bust wipes it.`
              : `${streak} win — reach 2 in a row to start multiplying payouts.`
          }
        >
          <span className="flame">🔥</span>
          <span className="count">{streak}</span>
          {streak >= 2 && <span className="mult">{streakMultiplier(streak)}x</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
