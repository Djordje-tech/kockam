import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "node:http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";

import { db } from "./db.js";
import { signToken, authMiddleware } from "./auth.js";
import { randomLocation, LOCATIONS } from "./locations.js";
import { haversineKm, scoreFromDistance, resolveBet } from "./scoring.js";
import { getLocationPhoto } from "./photo.js";
import { startLiveFeed } from "./liveFeed.js";

const app = express();
app.use(cors());
app.use(express.json());

const STARTING_BALANCE = 5000;
const DAILY_BONUS = 1000;
const ROUND_TIME_LIMIT_SEC = 60;
const BET_OPTIONS = [25, 100, 500, 1000, 2500];

function publicUser(row) {
  return { id: row.id, username: row.username, balance: row.balance };
}

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

// ---------- Game ----------

app.get("/api/config", (req, res) => {
  res.json({ betOptions: BET_OPTIONS, timeLimitSec: ROUND_TIME_LIMIT_SEC, startingBalance: STARTING_BALANCE });
});

app.post("/api/round/start", authMiddleware, (req, res) => {
  const { betAmount } = req.body || {};
  if (!BET_OPTIONS.includes(betAmount)) {
    return res.status(400).json({ error: "Invalid bet amount" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (user.balance < betAmount) return res.status(400).json({ error: "Insufficient balance" });

  const location = randomLocation();
  const newBalance = user.balance - betAmount;
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, user.id);

  const info = db
    .prepare(
      `INSERT INTO rounds (user_id, location_id, location_name, lat, lng, bet_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(user.id, location.id, location.name, location.lat, location.lng, betAmount);

  res.json({
    roundId: info.lastInsertRowid,
    betAmount,
    timeLimitSec: ROUND_TIME_LIMIT_SEC,
    photoUrl: `/round/${info.lastInsertRowid}/photo`,
    balance: newBalance,
  });
});

app.get("/api/round/:id/photo", authMiddleware, async (req, res) => {
  const round = db
    .prepare("SELECT * FROM rounds WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!round) return res.status(404).end();
  const location = LOCATIONS.find((l) => l.id === round.location_id);
  const { buffer, contentType } = await getLocationPhoto(location);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.send(buffer);
});

app.post("/api/round/:id/guess", authMiddleware, (req, res) => {
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

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  const newBalance = user.balance + payout;

  db.prepare(
    `UPDATE rounds SET guess_lat = ?, guess_lng = ?, distance_km = ?, score = ?, multiplier = ?,
     payout = ?, result = ?, status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
  ).run(lat, lng, distanceKm, score, multiplier, payout, result, round.id);
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, user.id);

  const payload = {
    roundId: round.id,
    locationName: round.location_name,
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
    locationName: round.location_name,
    country: LOCATIONS.find((l) => l.id === round.location_id)?.country,
    betAmount: round.bet_amount,
    payout,
    result,
    multiplier,
    at: new Date().toISOString(),
  });

  res.json(payload);
});

app.post("/api/round/:id/forfeit", authMiddleware, (req, res) => {
  const round = db
    .prepare("SELECT * FROM rounds WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "pending") return res.status(400).json({ error: "Round already resolved" });

  db.prepare(
    `UPDATE rounds SET score = 0, multiplier = 0, payout = 0, result = 'BUST',
     status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
  ).run(round.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  res.json({
    roundId: round.id,
    locationName: round.location_name,
    actualLat: round.lat,
    actualLng: round.lng,
    betAmount: round.bet_amount,
    payout: 0,
    result: "BUST",
    balance: user.balance,
    timedOut: true,
  });
});

app.get("/api/leaderboard", (req, res) => {
  const rows = db
    .prepare("SELECT username, balance FROM users ORDER BY balance DESC LIMIT 10")
    .all();
  res.json({ leaderboard: rows });
});

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.emit("hello", { message: "connected to kockam live feed" });
});

startLiveFeed(io);

server.listen(PORT, () => {
  console.log(`kockam server listening on :${PORT}`);
});
