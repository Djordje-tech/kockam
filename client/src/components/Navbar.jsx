import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <div className="navbar">
      <div className="brand">🎰 KOCKAM</div>
      {user && (
        <div className="nav-links">
          <NavLink to="/play" className={({ isActive }) => (isActive ? "active" : "")}>
            Play
          </NavLink>
          <NavLink to="/multiplayer" className={({ isActive }) => (isActive ? "active" : "")}>
            👥 Multiplayer
          </NavLink>
          <NavLink to="/leaderboard" className={({ isActive }) => (isActive ? "active" : "")}>
            Leaderboard
          </NavLink>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {user && (
          <>
            <div className="balance-pill">
              <span className="chip-icon">🪙</span>
              <span className="amount">{user.balance.toLocaleString()}</span>
            </div>
            <button className="btn btn-ghost" onClick={logout}>
              Log out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
