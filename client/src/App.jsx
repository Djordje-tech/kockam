import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import Navbar from "./components/Navbar";
import Auth from "./pages/Auth";
import Game from "./pages/Game";
import Multiplayer from "./pages/Multiplayer";
import Leaderboard from "./pages/Leaderboard";

function PrivateRoute({ children }) {
  const { user, loading, token } = useAuth();
  if (loading) return null;
  if (!token || !user) return <Navigate to="/" replace />;
  return children;
}

function Shell() {
  const { user, loading } = useAuth();
  return (
    <div className="app-shell">
      <Navbar />
      {loading ? null : (
        <Routes>
          <Route path="/" element={user ? <Navigate to="/play" replace /> : <Auth />} />
          <Route
            path="/play"
            element={
              <PrivateRoute>
                <Game />
              </PrivateRoute>
            }
          />
          <Route
            path="/multiplayer"
            element={
              <PrivateRoute>
                <Multiplayer />
              </PrivateRoute>
            }
          />
          <Route
            path="/leaderboard"
            element={
              <PrivateRoute>
                <Leaderboard />
              </PrivateRoute>
            }
          />
        </Routes>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
