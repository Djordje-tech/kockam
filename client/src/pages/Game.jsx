import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import BetSlip from "../components/BetSlip";
import GuessMap from "../components/GuessMap";
import RevealModal from "../components/RevealModal";
import LiveFeed from "../components/LiveFeed";

export default function Game() {
  const { user, updateBalance } = useAuth();
  const [betOptions, setBetOptions] = useState([25, 100, 500, 1000, 2500]);
  const [selectedBet, setSelectedBet] = useState(100);
  const [round, setRound] = useState(null); // { roundId, photoUrl, timeLimitSec }
  const [pin, setPin] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [reveal, setReveal] = useState(null);
  const [dealing, setDealing] = useState(false);
  const [claim, setClaim] = useState(null);
  const [photoSrc, setPhotoSrc] = useState(null);
  const timerRef = useRef(null);
  const roundRef = useRef(null);
  const photoUrlRef = useRef(null);

  useEffect(() => {
    api.get("/config").then((res) => {
      setBetOptions(res.data.betOptions);
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
      updateBalance(res.data.balance);
      setReveal(res.data);
    } catch {
      // round may already be resolved by a guess submitted right at the buzzer
    }
  }

  async function onDeal() {
    setDealing(true);
    try {
      const res = await api.post("/round/start", { betAmount: selectedBet });
      updateBalance(res.data.balance);
      const newRound = { roundId: res.data.roundId, photoUrl: res.data.photoUrl, betAmount: selectedBet };
      roundRef.current = newRound;
      setRound(newRound);
      setPin(null);
      setReveal(null);
      setTimeLeft(res.data.timeLimitSec);

      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      setPhotoSrc(null);
      const photoRes = await api.get(res.data.photoUrl, { responseType: "blob" });
      const objectUrl = URL.createObjectURL(photoRes.data);
      photoUrlRef.current = objectUrl;
      setPhotoSrc(objectUrl);

      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            forfeit();
            return 0;
          }
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
      updateBalance(res.data.balance);
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

          <div className="photo-frame">
            {round && photoSrc ? (
              <img src={photoSrc} alt="Guess the location" />
            ) : round ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                Loading location…
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                Place a bet and hit Deal to reveal a location
              </div>
            )}
            {inRound && <div className="timer-badge">⏱ {timeLeft}s</div>}
            {inRound && <div className="bet-badge">🪙 Bet: {round.betAmount}</div>}
          </div>

          <GuessMap pin={pin} onPick={setPin} disabled={!inRound} reveal={null} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <BetSlip
            betOptions={betOptions}
            selectedBet={selectedBet}
            onSelectBet={setSelectedBet}
            balance={user?.balance ?? 0}
            onDeal={onDeal}
            dealing={dealing}
            canSubmitGuess={inRound}
            onSubmitGuess={onSubmitGuess}
            hasPin={!!pin}
          />
          <LiveFeed />
        </div>
      </div>

      <RevealModal reveal={reveal} onClose={closeReveal} />
    </div>
  );
}
