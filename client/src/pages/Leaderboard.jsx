import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const { user } = useAuth();

  useEffect(() => {
    api.get("/leaderboard").then((res) => setRows(res.data.leaderboard));
  }, []);

  return (
    <div className="page">
      <div className="panel-card" style={{ width: "100%", maxWidth: 600 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>🏆 High Rollers</h3>
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Chips</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.username} style={{ background: r.username === user?.username ? "rgba(255,204,85,0.06)" : "transparent" }}>
                <td>
                  <span className="rank-badge">{i + 1}</span>
                </td>
                <td>{r.username}</td>
                <td>🪙{r.balance.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty-hint">No players yet — be the first!</div>}
      </div>
    </div>
  );
}
