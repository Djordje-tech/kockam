import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { formatChips } from "../format";
import StreetViewPanel from "../components/StreetViewPanel";
import GuessMap from "../components/GuessMap";

function emitAsync(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => {
      if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

export default function Duel() {
  const { user, updateBalance } = useAuth();
  const socket = useSocket();
  const [config, setConfig] = useState({ betOptions: [500, 1000, 2500, 5000], googleMapsBrowserKey: "" });

  const [duelState, setDuelState] = useState(null); // last duel:state payload
  const [roundData, setRoundData] = useState(null); // duel:start payload
  const [resultData, setResultData] = useState(null); // duel:result payload
  const [code, setCode] = useState(null);
  const [joinInput, setJoinInput] = useState("");
  const [selectedBet, setSelectedBet] = useState(500);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [photoSrc, setPhotoSrc] = useState(null);
  const timerRef = useRef(null);
  const photoUrlRef = useRef(null);

  useEffect(() => {
    api.get("/config").then((res) => setConfig(res.data));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onState = (s) => {
      setDuelState(s);
      setCode(s.code);
    };
    const onStart = async (payload) => {
      setRoundData(payload);
      setResultData(null);
      setPin(null);
      setTimeLeft(payload.timeLimitSec);
      if (payload.mode === "photo") {
        if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
        setPhotoSrc(null);
        try {
          const photoRes = await api.get(payload.photoUrl, { responseType: "blob" });
          const objectUrl = URL.createObjectURL(photoRes.data);
          photoUrlRef.current = objectUrl;
          setPhotoSrc(objectUrl);
        } catch {
          // ignore, photo frame will just stay blank
        }
      }
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => (t <= 1 ? (clearInterval(timerRef.current), 0) : t - 1));
      }, 1000);
    };
    const onResult = (payload) => {
      clearInterval(timerRef.current);
      setResultData(payload);
      updateBalance(payload.you.balance);
    };
    const onOpponentLeft = () => {
      clearInterval(timerRef.current);
      setError("Your opponent left the duel.");
      resetToLobby();
    };
    const onError = (e) => setError(e.error || "Something went wrong");

    socket.on("duel:state", onState);
    socket.on("duel:start", onStart);
    socket.on("duel:result", onResult);
    socket.on("duel:opponent-left", onOpponentLeft);
    socket.on("duel:error", onError);
    return () => {
      socket.off("duel:state", onState);
      socket.off("duel:start", onStart);
      socket.off("duel:result", onResult);
      socket.off("duel:opponent-left", onOpponentLeft);
      socket.off("duel:error", onError);
    };
  }, [socket]);

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    []
  );

  function resetToLobby() {
    setDuelState(null);
    setRoundData(null);
    setResultData(null);
    setCode(null);
    setPin(null);
  }

  async function createDuel() {
    if (!socket) return setError("Not connected yet — try again in a second.");
    setError("");
    setBusy(true);
    try {
      const res = await emitAsync(socket, "duel:create", { betAmount: selectedBet });
      setCode(res.code);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinDuel() {
    if (!socket) return setError("Not connected yet — try again in a second.");
    setError("");
    setBusy(true);
    try {
      await emitAsync(socket, "duel:join", { code: joinInput.trim().toUpperCase() });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function readyUp() {
    setError("");
    try {
      await emitAsync(socket, "duel:ready", {});
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelDuel() {
    if (socket) await emitAsync(socket, "duel:cancel", {}).catch(() => {});
    resetToLobby();
  }

  async function submitGuess() {
    if (!pin || !socket) return;
    try {
      await emitAsync(socket, "duel:guess", { lat: pin[0], lng: pin[1] });
    } catch (err) {
      setError(err.message);
    }
  }

  const status = duelState?.status;
  const inRound = status === "playing" && !resultData;

  return (
    <div className="page">
      <div style={{ width: "100%", maxWidth: 900 }}>
        <h2 style={{ margin: "0 0 4px" }}>⚔️ 1v1 Duel</h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0, marginBottom: 20, fontSize: 14 }}>
          Challenge a friend head to head. Same bet, same location, same clock — closest guess takes both stacks.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {!duelState && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="panel-card">
              <h3 style={{ marginTop: 0 }}>Create a Duel</h3>
              <div className="chip-grid">
                {config.betOptions.map((amount) => (
                  <button
                    key={amount}
                    className={`chip-btn ${selectedBet === amount ? "selected" : ""}`}
                    disabled={amount > (user?.balance ?? 0)}
                    onClick={() => setSelectedBet(amount)}
                  >
                    🪙{formatChips(amount)}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={createDuel} disabled={busy}>
                Create — Bet {formatChips(selectedBet)}
              </button>
            </div>

            <div className="panel-card">
              <h3 style={{ marginTop: 0 }}>Join a Duel</h3>
              <p style={{ fontSize: 13, color: "var(--text-dim)" }}>Got a code from a friend? Enter it here.</p>
              <div className="field">
                <label>Duel code</label>
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                  placeholder="e.g. AB3XZ"
                  maxLength={5}
                  style={{ textTransform: "uppercase", letterSpacing: 3, fontWeight: 700, textAlign: "center" }}
                />
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={joinDuel} disabled={busy || !joinInput}>
                Join Duel
              </button>
            </div>
          </div>
        )}

        {duelState && status === "waiting" && (
          <div className="panel-card" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>Send this code to your friend</div>
            <div style={{ fontSize: 48, fontWeight: 900, letterSpacing: 8, color: "var(--gold-bright)", marginBottom: 10 }}>
              {code}
            </div>
            <div style={{ color: "var(--text-dim)", marginBottom: 24 }}>🪙 Bet: {duelState.bet?.toLocaleString()} — waiting for opponent to join…</div>
            <button className="btn btn-ghost" onClick={cancelDuel}>
              Cancel
            </button>
          </div>
        )}

        {duelState && status === "ready" && (
          <div className="panel-card" style={{ textAlign: "center", padding: 30 }}>
            <div style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 20 }}>
              🪙 Bet: {duelState.bet?.toLocaleString()} chips each — winner takes {formatChips(duelState.bet * 2)}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 40, marginBottom: 24 }}>
              <div>
                <div style={{ fontWeight: 800 }}>{duelState.you?.username} (you)</div>
                <div style={{ color: duelState.you?.ready ? "var(--green)" : "var(--text-dim)" }}>
                  {duelState.you?.ready ? "✅ Ready" : "⏳ Not ready"}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 800 }}>{duelState.opponent?.username}</div>
                <div style={{ color: duelState.opponent?.ready ? "var(--green)" : "var(--text-dim)" }}>
                  {duelState.opponent?.ready ? "✅ Ready" : "⏳ Not ready"}
                </div>
              </div>
            </div>
            {!duelState.you?.ready ? (
              <button className="btn btn-primary" onClick={readyUp}>
                I'm Ready
              </button>
            ) : (
              <div style={{ color: "var(--text-dim)" }}>Waiting for opponent…</div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={cancelDuel}>
                Leave
              </button>
            </div>
          </div>
        )}

        {duelState && status === "playing" && roundData && !resultData && (
          <div>
            <div className="photo-frame" style={{ marginBottom: 16 }}>
              {roundData.mode === "streetview" && (
                <StreetViewPanel panoId={roundData.panoId} apiKey={config.googleMapsBrowserKey} />
              )}
              {roundData.mode === "photo" && photoSrc && <img src={photoSrc} alt="Guess the location" />}
              {roundData.mode === "photo" && !photoSrc && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                  Loading location…
                </div>
              )}
              <div className="timer-badge">⏱ {timeLeft}s</div>
              <div className="bet-badge">🪙 {duelState.bet} vs {duelState.opponent?.username}</div>
            </div>
            <GuessMap pin={pin} onPick={setPin} disabled={!inRound || duelState.you?.hasGuessed} reveal={null} />
            <div style={{ marginTop: 16, textAlign: "center" }}>
              {duelState.you?.hasGuessed ? (
                <div className="claim-banner" style={{ justifyContent: "center" }}>
                  ✅ Guess locked in — waiting for {duelState.opponent?.username}…
                </div>
              ) : (
                <button className="btn btn-primary" onClick={submitGuess} disabled={!pin}>
                  {pin ? "🔒 Lock In Guess" : "Drop a pin on the map above"}
                </button>
              )}
            </div>
          </div>
        )}

        {resultData && (
          <div className="panel-card">
            <div
              className={`reveal-result ${resultData.result === "WIN" ? "JACKPOT" : resultData.result === "LOSE" ? "BUST" : "PUSH"}`}
              style={{ textAlign: "center" }}
            >
              {resultData.result === "WIN" ? "🏆 YOU WIN" : resultData.result === "LOSE" ? "💥 YOU LOSE" : "➖ PUSH"}
            </div>
            <div style={{ textAlign: "center", color: "var(--text-dim)", marginBottom: 16 }}>
              It was <strong>{resultData.locationName}</strong>
            </div>
            <div className="reveal-stats" style={{ marginBottom: 16 }}>
              <div className="stat-box">
                <div className="label">Your distance</div>
                <div className="value">{resultData.you.distanceKm ?? "no guess"} {resultData.you.distanceKm != null ? "km" : ""}</div>
              </div>
              <div className="stat-box">
                <div className="label">{resultData.opponent.username}'s distance</div>
                <div className="value">{resultData.opponent.distanceKm ?? "no guess"} {resultData.opponent.distanceKm != null ? "km" : ""}</div>
              </div>
              <div className="stat-box" style={{ gridColumn: "1 / -1" }}>
                <div className="label">Result</div>
                <div className="value" style={{ color: resultData.potWon > 0 ? "var(--green)" : "var(--red)" }}>
                  {resultData.potWon > 0 ? `+${resultData.potWon.toLocaleString()}` : `-${duelState.bet?.toLocaleString() || ""}`} chips
                </div>
              </div>
            </div>
            <GuessMap
              pin={resultData.you.guess ? [resultData.you.guess.lat, resultData.you.guess.lng] : null}
              onPick={() => {}}
              disabled
              reveal={{ actualLat: resultData.actualLat, actualLng: resultData.actualLng }}
            />
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={resetToLobby}>
              New Duel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
