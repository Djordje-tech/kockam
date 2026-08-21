import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";

import { db } from "./db.js";
import { signToken, authMiddleware } from "./auth.js";
import { randomLocation, LOCATIONS } from "./locations.js";
import { haversineKm, scoreFromDistance, resolveBet } from "./scoring.js";
import { getLocationPhoto } from "./photo.js";
import { startLiveFeed } from "./liveFeed.js";
import { STREET_VIEW_ENABLED, findRandomPanorama, reverseGeocode, diagnose } from "./streetview.js";
import { registerRoomHandlers, rooms } from "./rooms.js";

const app = express();
app.use(cors());
app.use(express.json());

const STARTING_BALANCE = 5000;
const DAILY_BONUS = 1000;
const ROUND_TIME_LIMIT_SEC = 20;
const BET_OPTIONS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const GOOGLE_MAPS_BROWSER_KEY = process.env.GOOGLE_MAPS_BROWSER_KEY || "";

function publicUser(row) {
  return { id: row.id, username: row.username, balance: row.balance };
}

// Express 4 doesn't forward rejected promises from async handlers to the
// error middleware on its own — wrap them so failures come back as JSON
// instead of a bare, undiagnosable 500.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- Auth ----------

app.post("/api/auth/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: "Username min 3 chars, password min 4 chars" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Username already taken" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, balance) VALUES (?, ?, ?)")
    .run(username, hash, STARTING_BALANCE);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get("/api/me", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

app.post("/api/daily-claim", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  const now = new Date();
  if (user.last_daily_claim) {
    const last = new Date(user.last_daily_claim);
    const hoursSince = (now - last) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return res.status(429).json({ error: "Already claimed", hoursRemaining: Math.ceil(24 - hoursSince) });
    }
  }
  const newBalance = user.balance + DAILY_BONUS;
  db.prepare("UPDATE users SET balance = ?, last_daily_claim = ? WHERE id = ?").run(
    newBalance,
    now.toISOString(),
    user.id
  );
  res.json({ balance: newBalance, bonus: DAILY_BONUS });
});

// ---------- Fake wallet top-up (no real payment processing anywhere) ----------

const TOPUP_PACKAGES = {
  mini: 500,
  starter: 2000,
  popular: 10000,
  high_roller: 25000,
  whale: 50000,
  mega_whale: 150000,
};

app.post("/api/wallet/topup", authMiddleware, (req, res) => {
  const { pkg } = req.body || {};
  const amount = TOPUP_PACKAGES[pkg];
  if (!amount) return res.status(400).json({ error: "Unknown package" });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  const newBalance = user.balance + amount;
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, user.id);
  res.json({ balance: newBalance, credited: amount });
});

// ---------- Game ----------

// Open http://localhost:4000/api/debug/streetview in a browser to see, in
// plain JSON, whether Street View lookups are working and why not if they
// aren't.
app.get(
  "/api/debug/streetview",
  ah(async (req, res) => {
    res.json(await diagnose());
  })
);

app.get("/api/config", (req, res) => {
  res.json({
    betOptions: BET_OPTIONS,
    timeLimitSec: ROUND_TIME_LIMIT_SEC,
    startingBalance: STARTING_BALANCE,
    streetViewEnabled: STREET_VIEW_ENABLED,
    googleMapsBrowserKey: STREET_VIEW_ENABLED ? GOOGLE_MAPS_BROWSER_KEY : "",
  });
});

app.post("/api/round/start", authMiddleware, ah(async (req, res) => {
  const { betAmount } = req.body || {};
  if (!BET_OPTIONS.includes(betAmount)) {
    return res.status(400).json({ error: "Invalid bet amount" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (user.balance < betAmount) return res.status(400).json({ error: "Insufficient balance" });

  // Prefer a real, walkable Street View panorama; fall back to the curated
  // landmark-photo mode if no API key is configured or none was found.
  const pano = STREET_VIEW_ENABLED ? await findRandomPanorama() : null;
  const mode = pano ? "streetview" : "photo";
  const location = pano ? null : randomLocation();

  const newBalance = user.balance - betAmount;
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, user.id);

  const info = db
    .prepare(
      `INSERT INTO rounds (user_id, mode, location_id, location_name, pano_id, lat, lng, bet_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      user.id,
      mode,
      pano ? null : location.id,
      pano ? null : location.name,
      pano ? pano.panoId : null,
      pano ? pano.lat : location.lat,
      pano ? pano.lng : location.lng,
      betAmount
    );

  res.json({
    roundId: info.lastInsertRowid,
    mode,
    betAmount,
    timeLimitSec: ROUND_TIME_LIMIT_SEC,
    photoUrl: mode === "photo" ? `/round/${info.lastInsertRowid}/photo` : null,
    panoId: mode === "streetview" ? pano.panoId : null,
    balance: newBalance,
  });
}));

app.get("/api/round/:id/photo", authMiddleware, ah(async (req, res) => {
  const round = db
    .prepare("SELECT * FROM rounds WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!round || round.mode !== "photo") return res.status(404).end();
  const location = LOCATIONS.find((l) => l.id === round.location_id);
  const { buffer, contentType } = await getLocationPhoto(location);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.send(buffer);
}));

async function resolveLocationLabel(round) {
  if (round.mode === "streetview") {
    return (await reverseGeocode(round.lat, round.lng)) || "Unknown location";
  }
  return round.location_name;
}

app.post("/api/round/:id/guess", authMiddleware, ah(async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat/lng required" });
  }
  const round = db
    .prepare("SELECT * FROM rounds WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "pending") return res.status(400).json({ error: "Round already resolved" });

  const distanceKm = haversineKm(round.lat, round.lng, lat, lng);
  const score = scoreFromDistance(distanceKm);
  const { multiplier, result, payout } = resolveBet(distanceKm, round.bet_amount);
  const locationName = await resolveLocationLabel(round);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  const newBalance = user.balance + payout;

  db.prepare(
    `UPDATE rounds SET guess_lat = ?, guess_lng = ?, distance_km = ?, score = ?, multiplier = ?,
     payout = ?, result = ?, location_name = ?, status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
  ).run(lat, lng, distanceKm, score, multiplier, payout, result, locationName, round.id);
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, user.id);

  const payload = {
    roundId: round.id,
    locationName,
    actualLat: round.lat,
    actualLng: round.lng,
    guessLat: lat,
    guessLng: lng,
    distanceKm: Math.round(distanceKm * 10) / 10,
    score,
    betAmount: round.bet_amount,
    multiplier,
    payout,
    result,
    balance: newBalance,
  };

  io.emit("live-feed", {
    id: `user-${round.id}`,
    username: user.username,
    bot: false,
    locationName,
    betAmount: round.bet_amount,
    payout,
    result,
    multiplier,
    at: new Date().toISOString(),
  });

  res.json(payload);
}));

app.post("/api/round/:id/forfeit", authMiddleware, ah(async (req, res) => {
  const round = db
    .prepare("SELECT * FROM rounds WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "pending") return res.status(400).json({ error: "Round already resolved" });

  const locationName = await resolveLocationLabel(round);

  db.prepare(
    `UPDATE rounds SET score = 0, multiplier = 0, payout = 0, result = 'BUST', location_name = ?,
     status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
  ).run(locationName, round.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  res.json({
    roundId: round.id,
    locationName,
    actualLat: round.lat,
    actualLng: round.lng,
    betAmount: round.bet_amount,
    payout: 0,
    result: "BUST",
    balance: user.balance,
    timedOut: true,
  });
}));

app.get("/api/leaderboard", (req, res) => {
  const rows = db
    .prepare("SELECT username, balance FROM users ORDER BY balance DESC LIMIT 10")
    .all();
  res.json({ leaderboard: rows });
});

app.get(
  "/api/room/:code/photo",
  authMiddleware,
  ah(async (req, res) => {
    const room = rooms.get((req.params.code || "").toUpperCase());
    if (!room || !room.players.has(req.userId) || room.location?.mode !== "photo") {
      return res.status(404).end();
    }
    const location = LOCATIONS.find((l) => l.id === room.location.locationId);
    const { buffer, contentType } = await getLocationPhoto(location);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  })
);

// Serve the built client (npm run build in ../client) so one deployed
// service is both the API and the site — no separate frontend host, no
// cross-origin setup needed. No-op locally if the client hasn't been built,
// since the Vite dev server handles the frontend there instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
const clientBuilt = fs.existsSync(path.join(clientDist, "index.html"));

if (clientBuilt) {
  app.use(express.static(clientDist));
  // Hand every non-API, non-socket path to the SPA so client-side routes
  // (/play, /multiplayer, …) survive a refresh. Socket.IO attaches to the
  // raw HTTP server and answers first, but excluding it here too means a
  // misrouted handshake fails loudly instead of quietly receiving HTML.
  app.get(/^(?!\/(api|socket\.io)\/?).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  console.warn(
    `[server] No built client at ${clientDist} — serving the API only.\n` +
      `[server] In production run 'npm run build' in client/ before starting;\n` +
      `[server] locally that's expected, the Vite dev server serves the frontend.`
  );
}

// Safety net: turn any uncaught route error into a JSON response (with the
// message in dev) instead of a bare 500 that the client can't show.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.emit("hello", { message: "connected to kockam live feed" });
});

registerRoomHandlers(io);
startLiveFeed(io);

server.listen(PORT, () => {
  console.log(`kockam server listening on :${PORT}`);
  console.log(`[server] site: ${clientBuilt ? "serving built client" : "API only (no client build found)"}`);
  console.log(`[server] street view: ${STREET_VIEW_ENABLED ? "enabled" : "disabled (no GOOGLE_MAPS_API_KEY)"}`);
  console.log(`[server] socket.io: mounted at /socket.io`);
});
