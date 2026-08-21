import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;
    socket.on("live-feed", (event) => {
      setFeed((prev) => [event, ...prev].slice(0, 40));
    });
    return () => socket.disconnect();
  }, []);

  return <SocketContext.Provider value={{ feed }}>{children}</SocketContext.Provider>;
}

export function useLiveFeed() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useLiveFeed must be used within SocketProvider");
  return ctx.feed;
}
