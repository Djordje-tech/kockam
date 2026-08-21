import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setAuthToken } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("kockam_token"));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthToken(token);
    if (token) localStorage.setItem("kockam_token", token);
    else localStorage.removeItem("kockam_token");
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/me")
      .then((res) => setUser(res.data.user))
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback(async (username, password) => {
    const res = await api.post("/auth/login", { username, password });
    setToken(res.data.token);
    setUser(res.data.user);
  }, []);

  const register = useCallback(async (username, password) => {
    const res = await api.post("/auth/register", { username, password });
    setToken(res.data.token);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const updateBalance = useCallback((balance) => {
    setUser((u) => (u ? { ...u, balance } : u));
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, loading, login, register, logout, updateBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
