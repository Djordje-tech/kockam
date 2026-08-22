import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import BetSlip from "../components/BetSlip";
import GuessMap from "../components/GuessMap";
import RevealModal from "../components/RevealModal";
import LiveFeed from "../components/LiveFeed";
import StreetViewPanel from "../components/StreetViewPanel";
import TopUpModal from "../components/TopUpModal";
import { streakMultiplier, nextStreakMultiplier } from "../components/StreakBadge";
import { sfx } from "../sound";

export default function Game() {
  const { user, updateBalance, applyRound } = useAuth();
  const [config, setConfig] = useState({ betOptions: [500, 1000, 2500, 5000], timeLimitSec: 20 });
  const [selectedBet, setSelectedBet] = useState(1000);
  const [round, setRound] = useState(null); // { roundId, betAmount, mode, panoId }
  const [pin, setPin] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [reveal, setReveal] = useState(null);
  const [dealing, setDealing] = useState(false);
  const [claim, setClaim] = useState(null);
  const [photoSrc, setPhotoSrc] = useState(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const timerRef = useRef(null);
  const roundRef = useRef(null);
  const photoUrlRef = useRef(null);

  useEffect(() => {
    api.get("/config").then((res) => {
      setConfig(res.data);
      setSelectedBet(res.data.betOptions[Math.min(1, res.data.betOptions.length - 1)]);
    });
  }, []);

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    []
  );

  async function forfeit() {
    const r = roundRef.current;
    if (!r) return;
    clearInterval(timerRef.current);
    try {
      const res = await api.post(`/round/${r.roundId}/forfeit`);
      applyRound(res.data);
      setReveal(res.data);
    } catch {
      // round may already be resolved by a guess submitted right at the buzzer
    }
  }

  async function onDeal() {
    setDealing(true);
    sfx.deal();
    try {
      const res = await api.post("/round/start", { betAmount: selectedBet });
      updateBalance(res.data.balance);
      const newRound = {
        roundId: res.data.roundId,
        betAmount: selectedBet,
        mode: res.data.mode,
        panoId: res.data.panoId,
      };
      roundRef.current = newRound;
      setRound(newRound);
      setPin(null);
      setReveal(null);
      setTimeLeft(res.data.timeLimitSec);

      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      setPhotoSrc(null);
      if (res.data.mode === "photo") {
        const photoRes = await api.get(res.data.photoUrl, { responseType: "blob" });
        const objectUrl = URL.createObjectURL(photoRes.data);
        photoUrlRef.current = objectUrl;
        setPhotoSrc(objectUrl);
      }

      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            forfeit();
            return 0;
          }
          // The clock only becomes audible in the last five seconds, where it
          // is meant to be felt.
          if (t <= 6) sfx.tick(t <= 4);
          return t - 1;
        });
      }, 1000);
    } catch (err) {
      alert(err.response?.data?.error || "Could not start round");
    } finally {
      setDealing(false);
    }
  }

  async function onSubmitGuess() {
    if (!pin || !round) return;
    clearInterval(timerRef.current);
    try {
      const res = await api.post(`/round/${round.roundId}/guess`, { lat: pin[0], lng: pin[1] });
      applyRound(res.data);
      setReveal(res.data);
    } catch (err) {
      alert(err.response?.data?.error || "Could not submit guess");
    }
  }

  function closeReveal() {
    setReveal(null);
    setRound(null);
    roundRef.current = null;
    setPin(null);
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
    setPhotoSrc(null);
  }

  async function claimDaily() {
    try {
      const res = await api.post("/daily-claim");
      updateBalance(res.data.balance);
      setClaim({ ok: true, bonus: res.data.bonus });
    } catch (err) {
      setClaim({ ok: false, hours: err.response?.data?.hoursRemaining });
    }
  }

  const inRound = !!round && !reveal;
  const urgentTime = inRound && timeLeft <= 5;
  const streak = user?.streak ?? 0;
  // What this round is actually playing for: the multiplier a win would pay
  // at, and the run a bust would end.
  const winMultiplier = nextStreakMultiplier(streak);
  const potentialJackpot = Math.round(selectedBet * 5 * winMultiplier);

  return (
    <div className="page">
      <div className="game-layout">
        <div className="game-main">
          {claim === null && (
            <div className="claim-banner">
              <span>🎁 Claim your free daily chip bonus!</span>
              <button className="btn btn-primary" onClick={claimDaily}>
                Claim 1000 🪙
              </button>
            </div>
          )}
          {claim && claim.ok && (
            <div className="claim-banner">
              <span>✅ Claimed +{claim.bonus} chips. Come back tomorrow!</span>
            </div>
          )}
          {claim && !claim.ok && (
            <div className="claim-banner">
              <span>⏳ Already claimed — next bonus in ~{claim.hours}h</span>
            </div>
          )}

          {streak >= 1 && (
            <div className={`streak-strip${inRound ? " live" : ""}`}>
              <span className="streak-strip-flame">🔥</span>
              <span>
                <strong>{streak} in a row</strong>
                {streakMultiplier(streak) > 1
                  ? ` — payouts running at ${streakMultiplier(streak)}x`
                  : " — one more win starts the multiplier"}
              </span>
              <span className="streak-strip-stake">
                Win this one: up to 🪙{potentialJackpot.toLocaleString()} · Bust: streak gone
              </span>
            </div>
          )}

          <div className="photo-frame">
            {round && round.mode === "streetview" && (
              <StreetViewPanel panoId={round.panoId} apiKey={config.googleMapsBrowserKey} />
            )}
            {round && round.mode === "photo" && photoSrc && <img src={photoSrc} alt="Guess the location" />}
            {round && round.mode === "photo" && !photoSrc && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                Loading location…
              </div>
            )}
            {!round && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                Place a bet and hit Deal to reveal a location
              </div>
            )}
            {inRound && (
              <div className="timer-badge" style={urgentTime ? { borderColor: "var(--red)", color: "var(--red)" } : undefined}>
                ⏱ {timeLeft}s
              </div>
            )}
            {inRound && <div className="bet-badge">🪙 Bet: {round.betAmount}</div>}
          </div>

          <GuessMap
            pin={pin}
            onPick={(p) => {
              sfx.pin();
              setPin(p);
            }}
            disabled={!inRound}
            reveal={reveal}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <BetSlip
            betOptions={config.betOptions}
            selectedBet={selectedBet}
            onSelectBet={setSelectedBet}
            balance={user?.balance ?? 0}
            onDeal={onDeal}
            dealing={dealing}
            canSubmitGuess={inRound}
            onSubmitGuess={onSubmitGuess}
            hasPin={!!pin}
            onAddChips={() => setTopUpOpen(true)}
            streak={streak}
          />
          <LiveFeed />
        </div>
      </div>

      <RevealModal reveal={reveal} onClose={closeReveal} />
      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onCredited={(balance) => updateBalance(balance)}
      />
    </div>
  );
}
