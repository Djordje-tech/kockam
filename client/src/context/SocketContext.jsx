import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const socketRef = useRef(null);
  const [feed, setFeed] = useState([]);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Try WebSocket first rather than the default long-polling handshake:
    // hosting proxies are far more reliable with a straight WS upgrade, and
    // polling still remains as an automatic fallback.
    const s = io({
      path: "/socket.io",
      auth: token ? { token } : {},
      transports: ["websocket", "polling"],
    });
    socketRef.current = s;
    setSocket(s);
    s.on("live-feed", (event) => {
      setFeed((prev) => [event, ...prev].slice(0, 40));
    });
    return () => s.disconnect();
  }, [token]);

  return <SocketContext.Provider value={{ feed, socket }}>{children}</SocketContext.Provider>;
}

export function useLiveFeed() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useLiveFeed must be used within SocketProvider");
  return ctx.feed;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx.socket;
}
