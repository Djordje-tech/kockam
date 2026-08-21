import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password);
      navigate("/play");
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="auth-card">
        <h1>{mode === "login" ? "Welcome back" : "Join the table"}</h1>
        <p className="sub">
          {mode === "login"
            ? "Sign in and keep the streak alive."
            : "Create an account and grab your starting chip stack."}
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="switch-line">
          {mode === "login" ? (
            <>
              New here? <button onClick={() => setMode("register")}>Create an account</button>
            </>
          ) : (
            <>
              Already have an account? <button onClick={() => setMode("login")}>Sign in</button>
            </>
          )}
        </div>

        <div className="disclaimer">
          Kockam uses 100% play chips — no real money is ever wagered, deposited, or withdrawn.
          For entertainment purposes only.
        </div>
      </div>
    </div>
  );
}
