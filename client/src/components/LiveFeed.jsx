import { useLiveFeed } from "../context/SocketContext";

function amountClass(result) {
  if (result === "PUSH") return "push";
  if (result === "JACKPOT" || result === "WIN") return "win";
  return "lose";
}

export default function LiveFeed() {
  const feed = useLiveFeed();

  return (
    <div className="panel-card">
      <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 1 }}>
        🔥 Live Feed
      </h3>
      <div className="live-feed">
        {feed.length === 0 && <div className="empty-hint">Waiting for live action…</div>}
        {feed.map((e) => {
          const net = e.payout - e.betAmount;
          const sign = net > 0 ? "+" : net < 0 ? "-" : "";
          return (
            <div key={e.id} className={`feed-row ${e.result === "JACKPOT" ? "jackpot" : ""}`}>
              <span>
                <span className="who">{e.username}</span>{" "}
                <span className="where">→ {e.locationName}</span>
              </span>
              <span className={`amt ${amountClass(e.result)}`}>
                {e.result === "JACKPOT" ? "🎉 " : ""}
                {sign}
                {Math.abs(net)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
