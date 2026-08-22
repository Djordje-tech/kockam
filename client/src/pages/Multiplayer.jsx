import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { sfx } from "../sound";
import Confetti from "../components/Confetti";
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

export default function Multiplayer() {
  const { user, updateBalance } = useAuth();
  const socket = useSocket();
  const [config, setConfig] = useState({ betOptions: [500, 1000, 2500, 5000], googleMapsBrowserKey: "" });

  const [state, setState] = useState(null); // room:state
  const [round, setRound] = useState(null); // room:start
  const [result, setResult] = useState(null); // room:result
  const [joinInput, setJoinInput] = useState("");
  const [selectedBet, setSelectedBet] = useState(1000);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [photoSrc, setPhotoSrc] = useState(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  const photoUrlRef = useRef(null);

  useEffect(() => {
    api.get("/config").then((res) => setConfig(res.data));
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onState = (s) => {
      setState(s);
      if (s.status === "lobby") setRound(null);
    };

    const onStart = async (payload) => {
      sfx.deal();
      setResult(null);
      setRound(payload);
      setPin(null);
      setTimeLeft(payload.timeLimitSec);

      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      setPhotoSrc(null);
      if (payload.mode === "photo" && payload.photoUrl) {
        try {
          const res = await api.get(payload.photoUrl, { responseType: "blob" });
          const objectUrl = URL.createObjectURL(res.data);
          photoUrlRef.current = objectUrl;
          setPhotoSrc(objectUrl);
        } catch {
          /* frame just stays blank */
        }
      }

      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          if (t <= 6) sfx.tick(t <= 4);
          return t - 1;
        });
      }, 1000);
    };

    const onResult = (payload) => {
      clearInterval(timerRef.current);
      if (payload.you.isWinner) sfx.jackpot();
      else sfx.bust();
      setResult(payload);
      updateBalance(payload.you.balance);
    };

    const onError = (e) => setError(e.error || "Something went wrong");

    socket.on("room:state", onState);
    socket.on("room:start", onStart);
    socket.on("room:result", onResult);
    socket.on("room:error", onError);
    return () => {
      socket.off("room:state", onState);
      socket.off("room:start", onStart);
      socket.off("room:result", onResult);
      socket.off("room:error", onError);
    };
  }, [socket]);

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    []
  );

  async function run(fn) {
    if (!socket) return setError("Not connected yet — try again in a second.");
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const createRoom = () => run(() => emitAsync(socket, "room:create", { betAmount: selectedBet }));
  const joinRoom = () => run(() => emitAsync(socket, "room:join", { code: joinInput.trim().toUpperCase() }));
  const startRound = () => run(() => emitAsync(socket, "room:start", {}));
  const submitGuess = () =>
    run(() => emitAsync(socket, "room:guess", { lat: pin[0], lng: pin[1] }));

  async function leaveRoom() {
    if (socket) await emitAsync(socket, "room:leave", {}).catch(() => {});
    setState(null);
    setRound(null);
    setResult(null);
    setPin(null);
  }

  function copyCode() {
    navigator.clipboard?.writeText(state.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  }

  const status = state?.status;
  const you = state?.players?.find((p) => p.username === user?.username);
  const playing = status === "playing" && round && !result;

  return (
    <div className="page">
      <div style={{ width: "100%", maxWidth: 1000 }}>
        <h2 style={{ margin: "0 0 4px" }}>👥 Multiplayer</h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0, marginBottom: 20, fontSize: 14 }}>
          Play against your friends — up to 8 in a room. Everyone antes the same bet, sees the same
          location on the same clock, and the closest guess takes the whole pot.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {/* ---------- No room yet: create or join ---------- */}
        {!state && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="panel-card">
              <h3 style={{ marginTop: 0 }}>Create a Room</h3>
              <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
                Pick the ante. You'll get a code to share with your friends.
              </p>
              <div className="chip-grid">
                {config.betOptions.map((amount) => (
                  <button
                    key={amount}
                    className={`chip-btn ${selectedBet === amount ? "selected" : ""}`}
                    disabled={amount > (user?.balance ?? 0)}
                    onClick={() => {
                      sfx.chip();
                      setSelectedBet(amount);
                    }}
                  >
                    🪙{formatChips(amount)}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={createRoom} disabled={busy}>
                Create — Ante {formatChips(selectedBet)}
              </button>
            </div>

            <div className="panel-card">
              <h3 style={{ marginTop: 0 }}>Join a Room</h3>
              <p style={{ fontSize: 13, color: "var(--text-dim)" }}>Got a code from a friend? Enter it here.</p>
              <div className="field">
                <label>Room code</label>
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                  placeholder="e.g. AB3XZ"
                  maxLength={5}
                  style={{ textTransform: "uppercase", letterSpacing: 3, fontWeight: 700, textAlign: "center" }}
                />
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={joinRoom} disabled={busy || !joinInput}>
                Join Room
              </button>
            </div>
          </div>
        )}

        {/* ---------- Lobby ---------- */}
        {state && status === "lobby" && !result && (
          <div className="panel-card">
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ textAlign: "center", minWidth: 220 }}>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>Room code</div>
                <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: 8, color: "var(--gold-bright)" }}>
                  {state.code}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={copyCode}>
                  {copied ? "✅ Copied" : "📋 Copy code"}
                </button>
                <div style={{ marginTop: 14, fontSize: 13, color: "var(--text-dim)" }}>
                  Ante 🪙{state.bet.toLocaleString()} each · pot 🪙{state.pot.toLocaleString()}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-dim)", marginBottom: 8 }}>
                  Players ({state.players.length}/8)
                </div>
                {state.players.map((p) => (
                  <div
                    key={p.username}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "9px 12px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.03)",
                      marginBottom: 6,
                      fontSize: 14,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>
                      {p.username} {p.username === user?.username && <span style={{ color: "var(--text-dim)" }}>(you)</span>}
                    </span>
                    {p.isHost && <span style={{ color: "var(--gold-bright)", fontSize: 12, fontWeight: 700 }}>👑 HOST</span>}
                  </div>
                ))}

                <div style={{ marginTop: 16 }}>
                  {state.youAreHost ? (
                    <button
                      className="btn btn-primary"
                      style={{ width: "100%" }}
                      onClick={startRound}
                      disabled={busy || !state.canStart}
                    >
                      {state.canStart ? "▶ Start Round" : "Waiting for at least 2 players…"}
                    </button>
                  ) : (
                    <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "10px 0" }}>
                      Waiting for the host to start…
                    </div>
                  )}
                  <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={leaveRoom}>
                    Leave room
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------- Playing ---------- */}
        {playing && (
          <div>
            <div className="photo-frame" style={{ marginBottom: 16 }}>
              {round.mode === "streetview" && (
                <StreetViewPanel panoId={round.panoId} apiKey={config.googleMapsBrowserKey} />
              )}
              {round.mode === "photo" && photoSrc && <img src={photoSrc} alt="Guess the location" />}
              {round.mode === "photo" && !photoSrc && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                  Loading location…
                </div>
              )}
              <div className="timer-badge" style={timeLeft <= 5 ? { borderColor: "var(--red)", color: "var(--red)" } : undefined}>
                ⏱ {timeLeft}s
              </div>
              <div className="bet-badge">🪙 Pot: {round.pot?.toLocaleString()}</div>
            </div>

            <GuessMap pin={pin} onPick={setPin} disabled={!!you?.hasGuessed} reveal={null} />

            <div style={{ marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                {you?.hasGuessed ? (
                  <div className="claim-banner" style={{ margin: 0, justifyContent: "center" }}>
                    ✅ Locked in — waiting for the others…
                  </div>
                ) : (
                  <button className="btn btn-primary" style={{ width: "100%" }} onClick={submitGuess} disabled={!pin}>
                    {pin ? "🔒 Lock In Guess" : "Drop a pin on the map above"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {state.players.map((p) => (
                  <span
                    key={p.username}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      color: p.hasGuessed ? "var(--green)" : "var(--text-dim)",
                    }}
                  >
                    {p.hasGuessed ? "✅" : "⏳"} {p.username}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------- Results ---------- */}
        {result && (
          <div className="panel-card">
            <Confetti active={result.you.isWinner} />
            <div
              className={`reveal-result ${result.you.isWinner ? "JACKPOT" : "BUST"}`}
              style={{ textAlign: "center" }}
            >
              {result.you.isWinner ? "🏆 YOU WIN THE POT" : "💥 YOU LOSE"}
            </div>
            <div style={{ textAlign: "center", color: "var(--text-dim)", marginBottom: 18 }}>
              It was <strong>{result.locationName}</strong> · pot 🪙{result.pot.toLocaleString()}
            </div>

            <table className="leaderboard-table" style={{ marginBottom: 18 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Distance</th>
                  <th style={{ textAlign: "right" }}>Chips</th>
                </tr>
              </thead>
              <tbody>
                {result.standings.map((s) => (
                  <tr
                    key={s.username}
                    style={{ background: s.username === user?.username ? "rgba(255,204,85,0.06)" : "transparent" }}
                  >
                    <td>
                      <span className="rank-badge">{s.rank}</span>
                    </td>
                    <td>
                      {s.username}
                      {s.username === user?.username && <span style={{ color: "var(--text-dim)" }}> (you)</span>}
                    </td>
                    <td>{s.distanceKm != null ? `${s.distanceKm} km` : "no guess"}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: s.net >= 0 ? "var(--green)" : "var(--red)" }}>
                      {s.net >= 0 ? "+" : ""}
                      {s.net.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <GuessMap
              pin={
                result.standings.find((s) => s.username === user?.username)?.guess
                  ? [
                      result.standings.find((s) => s.username === user?.username).guess.lat,
                      result.standings.find((s) => s.username === user?.username).guess.lng,
                    ]
                  : null
              }
              onPick={() => {}}
              disabled
              reveal={{ actualLat: result.actualLat, actualLng: result.actualLng }}
              otherGuesses={result.standings.filter((s) => s.username !== user?.username)}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setResult(null)}>
                Back to lobby
              </button>
              <button className="btn btn-ghost" onClick={leaveRoom}>
                Leave room
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
