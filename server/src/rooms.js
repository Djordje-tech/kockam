import { db } from "./db.js";
import { verifyToken } from "./auth.js";
import { randomLocation } from "./locations.js";
import { haversineKm } from "./scoring.js";
import { STREET_VIEW_ENABLED, findRandomPanorama, reverseGeocode } from "./streetview.js";

const ROUND_TIME_LIMIT_SEC = 20;
const MAX_PLAYERS = 8;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

// code -> room. In-memory: a room only needs to outlive the match itself.
export const rooms = new Map();
const socketToCode = new Map();

function randomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

const getUser = (userId) => db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

function creditBalance(userId, amount) {
  const user = getUser(userId);
  const newBalance = user.balance + amount;
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, userId);
  return newBalance;
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({
    username: p.username,
    isHost: p.userId === room.hostUserId,
    hasGuessed: !!p.guess,
    connected: p.connected,
  }));
}

function publicState(room, forUserId) {
  return {
    code: room.code,
    bet: room.bet,
    status: room.status,
    pot: room.bet * room.players.size,
    youAreHost: room.hostUserId === forUserId,
    canStart: room.players.size >= 2,
    players: playerList(room),
  };
}

function broadcastState(io, room) {
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit("room:state", publicState(room, p.userId));
  }
}

function emitAll(io, room, event, payload) {
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit(event, payload);
  }
}

function closeRoom(room) {
  clearTimeout(room.timer);
  rooms.delete(room.code);
  for (const p of room.players.values()) {
    if (p.socketId) socketToCode.delete(p.socketId);
  }
}

async function pickLocation() {
  const pano = STREET_VIEW_ENABLED ? await findRandomPanorama() : null;
  if (pano) return { mode: "streetview", lat: pano.lat, lng: pano.lng, panoId: pano.panoId };
  const loc = randomLocation();
  return { mode: "photo", lat: loc.lat, lng: loc.lng, locationId: loc.id, locationName: loc.name };
}

async function startRound(io, room) {
  room.status = "playing";
  room.location = await pickLocation();
  for (const p of room.players.values()) p.guess = null;

  emitAll(io, room, "room:start", {
    mode: room.location.mode,
    panoId: room.location.panoId || null,
    photoUrl: room.location.mode === "photo" ? `/room/${room.code}/photo` : null,
    timeLimitSec: ROUND_TIME_LIMIT_SEC,
    bet: room.bet,
    pot: room.bet * room.players.size,
  });
  broadcastState(io, room);

  room.timer = setTimeout(() => finishRound(io, room), ROUND_TIME_LIMIT_SEC * 1000 + 2000);
}

function everyoneGuessed(room) {
  return [...room.players.values()].every((p) => p.guess || !p.connected);
}

async function finishRound(io, room) {
  if (room.status !== "playing") return; // already settled (timer vs. last guess race)
  clearTimeout(room.timer);
  room.status = "results";

  const scored = [...room.players.values()].map((p) => ({
    player: p,
    distanceKm: p.guess
      ? haversineKm(room.location.lat, room.location.lng, p.guess.lat, p.guess.lng)
      : Infinity,
  }));
  scored.sort((a, b) => a.distanceKm - b.distanceKm);

  const pot = room.bet * scored.length;
  const best = scored[0].distanceKm;
  // Everyone who actually guessed and tied for closest splits the pot. If
  // nobody guessed at all, refund rather than pocketing the stakes.
  const winners = Number.isFinite(best) ? scored.filter((s) => s.distanceKm === best) : scored;
  const share = Math.floor(pot / winners.length);
  const winnerIds = new Set(winners.map((w) => w.player.userId));

  const balances = new Map();
  for (const w of winners) balances.set(w.player.userId, creditBalance(w.player.userId, share));

  const locationName =
    room.location.mode === "streetview"
      ? (await reverseGeocode(room.location.lat, room.location.lng)) || "Unknown location"
      : room.location.locationName;

  const standings = scored.map((s, i) => ({
    rank: i + 1,
    username: s.player.username,
    distanceKm: Number.isFinite(s.distanceKm) ? Math.round(s.distanceKm * 10) / 10 : null,
    guess: s.player.guess,
    won: winnerIds.has(s.player.userId) ? share : 0,
    net: (winnerIds.has(s.player.userId) ? share : 0) - room.bet,
  }));

  for (const p of room.players.values()) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit("room:result", {
      code: room.code,
      locationName,
      actualLat: room.location.lat,
      actualLng: room.location.lng,
      bet: room.bet,
      pot,
      standings,
      you: {
        username: p.username,
        balance: balances.get(p.userId) ?? getUser(p.userId).balance,
        won: winnerIds.has(p.userId) ? share : 0,
        isWinner: winnerIds.has(p.userId),
      },
    });
  }

  // Drop anyone who disconnected mid-round, then park the room back in the
  // lobby so the group can immediately play another round together.
  for (const [userId, p] of [...room.players.entries()]) {
    if (!p.connected) room.players.delete(userId);
  }
  if (room.players.size === 0) return closeRoom(room);
  if (!room.players.has(room.hostUserId)) {
    room.hostUserId = [...room.players.values()][0].userId;
  }
  room.status = "lobby";
  broadcastState(io, room);
}

function removePlayer(io, room, userId) {
  const player = room.players.get(userId);
  if (!player) return;

  if (room.status === "playing") {
    // Keep them in the standings as a no-guess so the round can settle, but
    // mark them gone so nobody waits on them.
    player.connected = false;
    player.socketId = null;
    if (everyoneGuessed(room)) finishRound(io, room);
    else broadcastState(io, room);
    return;
  }

  room.players.delete(userId);
  if (room.players.size === 0) return closeRoom(room);
  if (room.hostUserId === userId) {
    room.hostUserId = [...room.players.values()][0].userId;
  }
  broadcastState(io, room);
}

export function registerRoomHandlers(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = verifyToken(token);
        socket.userId = payload.id;
        socket.username = payload.username;
      } catch {
        // stays unauthenticated; room actions below reject it
      }
    }
    next();
  });

  io.on("connection", (socket) => {
    const needsAuth = (cb) => {
      if (!socket.userId) {
        cb?.({ error: "Not authenticated" });
        return true;
      }
      return false;
    };
    const currentRoom = () => rooms.get(socketToCode.get(socket.id));

    socket.on("room:create", ({ betAmount } = {}, cb) => {
      if (needsAuth(cb)) return;
      if (!Number.isFinite(betAmount) || betAmount <= 0) return cb?.({ error: "Invalid bet" });
      const user = getUser(socket.userId);
      if (user.balance < betAmount) return cb?.({ error: "Insufficient balance" });

      const code = randomCode();
      const room = {
        code,
        bet: betAmount,
        hostUserId: socket.userId,
        status: "lobby",
        players: new Map(),
        location: null,
        timer: null,
      };
      room.players.set(socket.userId, {
        userId: socket.userId,
        username: user.username,
        socketId: socket.id,
        guess: null,
        connected: true,
      });
      rooms.set(code, room);
      socketToCode.set(socket.id, code);
      cb?.({ code });
      broadcastState(io, room);
    });

    socket.on("room:join", ({ code } = {}, cb) => {
      if (needsAuth(cb)) return;
      const room = rooms.get((code || "").toUpperCase());
      if (!room) return cb?.({ error: "Room not found" });
      if (room.players.has(socket.userId)) return cb?.({ error: "You're already in this room" });
      if (room.status === "playing") return cb?.({ error: "That round already started — try again in a moment" });
      if (room.players.size >= MAX_PLAYERS) return cb?.({ error: `Room is full (${MAX_PLAYERS} players)` });

      const user = getUser(socket.userId);
      if (user.balance < room.bet) return cb?.({ error: "Insufficient balance for this room's bet" });

      room.players.set(socket.userId, {
        userId: socket.userId,
        username: user.username,
        socketId: socket.id,
        guess: null,
        connected: true,
      });
      socketToCode.set(socket.id, room.code);
      cb?.({ code: room.code, bet: room.bet });
      broadcastState(io, room);
    });

    socket.on("room:start", (_payload, cb) => {
      if (needsAuth(cb)) return;
      const room = currentRoom();
      if (!room) return cb?.({ error: "No active room" });
      if (room.hostUserId !== socket.userId) return cb?.({ error: "Only the host can start" });
      if (room.status !== "lobby") return cb?.({ error: "Round already in progress" });
      if (room.players.size < 2) return cb?.({ error: "Need at least 2 players" });

      const broke = [...room.players.values()].filter((p) => getUser(p.userId).balance < room.bet);
      if (broke.length > 0) {
        return cb?.({ error: `${broke.map((p) => p.username).join(", ")} can't cover the bet` });
      }
      for (const p of room.players.values()) creditBalance(p.userId, -room.bet);

      cb?.({ ok: true });
      startRound(io, room);
    });

    socket.on("room:guess", ({ lat, lng } = {}, cb) => {
      if (needsAuth(cb)) return;
      const room = currentRoom();
      if (!room || room.status !== "playing") return cb?.({ error: "No round in progress" });
      const player = room.players.get(socket.userId);
      if (!player) return cb?.({ error: "You're not in this room" });
      if (player.guess) return cb?.({ error: "Already guessed" });
      if (typeof lat !== "number" || typeof lng !== "number") return cb?.({ error: "Invalid guess" });

      player.guess = { lat, lng };
      cb?.({ ok: true });
      broadcastState(io, room);
      if (everyoneGuessed(room)) finishRound(io, room);
    });

    socket.on("room:leave", (_payload, cb) => {
      const room = currentRoom();
      if (room) {
        socketToCode.delete(socket.id);
        removePlayer(io, room, socket.userId);
      }
      cb?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const room = currentRoom();
      socketToCode.delete(socket.id);
      if (room) removePlayer(io, room, socket.userId);
    });
  });
}
