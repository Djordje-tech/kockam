import { db } from "./db.js";
import { verifyToken } from "./auth.js";
import { randomLocation } from "./locations.js";
import { haversineKm } from "./scoring.js";
import { STREET_VIEW_ENABLED, findRandomPanorama, reverseGeocode } from "./streetview.js";

const DUEL_TIME_LIMIT_SEC = 20;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

// code -> duel object. Ephemeral, in-memory — a duel only needs to live for
// the few minutes of a single 1v1 match.
export const duels = new Map();
const socketToCode = new Map();

function randomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (duels.has(code));
  return code;
}

function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function creditBalance(userId, amount) {
  const user = getUser(userId);
  const newBalance = user.balance + amount;
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, userId);
  return newBalance;
}

function otherPlayer(duel, userId) {
  return duel.host.userId === userId ? duel.guest : duel.host;
}
function thisPlayer(duel, userId) {
  return duel.host.userId === userId ? duel.host : duel.guest;
}

function publicState(duel, forUserId) {
  const you = thisPlayer(duel, forUserId);
  const opp = duel.guest && duel.host ? otherPlayer(duel, forUserId) : null;
  return {
    code: duel.code,
    bet: duel.bet,
    status: duel.status,
    you: you && { username: you.username, ready: you.ready, hasGuessed: !!you.guess },
    opponent: opp && { username: opp.username, ready: opp.ready, hasGuessed: !!opp.guess },
  };
}

function broadcastState(io, duel) {
  if (duel.host?.socketId) io.to(duel.host.socketId).emit("duel:state", publicState(duel, duel.host.userId));
  if (duel.guest?.socketId) io.to(duel.guest.socketId).emit("duel:state", publicState(duel, duel.guest.userId));
}

async function pickLocation() {
  const pano = STREET_VIEW_ENABLED ? await findRandomPanorama() : null;
  if (pano) return { mode: "streetview", lat: pano.lat, lng: pano.lng, panoId: pano.panoId };
  const loc = randomLocation();
  return { mode: "photo", lat: loc.lat, lng: loc.lng, locationId: loc.id, locationName: loc.name };
}

function cleanupDuel(duel) {
  clearTimeout(duel.timer);
  duels.delete(duel.code);
  if (duel.host?.socketId) socketToCode.delete(duel.host.socketId);
  if (duel.guest?.socketId) socketToCode.delete(duel.guest.socketId);
}

async function startDuel(io, duel) {
  duel.status = "playing";
  duel.location = await pickLocation();
  duel.startedAt = Date.now();

  const payload = {
    mode: duel.location.mode,
    panoId: duel.location.panoId || null,
    photoUrl: duel.location.mode === "photo" ? `/duel/${duel.code}/photo` : null,
    timeLimitSec: DUEL_TIME_LIMIT_SEC,
    bet: duel.bet,
  };
  io.to(duel.host.socketId).emit("duel:start", { ...payload, opponent: duel.guest.username });
  io.to(duel.guest.socketId).emit("duel:start", { ...payload, opponent: duel.host.username });
  broadcastState(io, duel);

  duel.timer = setTimeout(() => resolveDuel(io, duel), DUEL_TIME_LIMIT_SEC * 1000 + 2000);
}

function maybeResolve(io, duel) {
  if (duel.host.guess && duel.guest.guess) resolveDuel(io, duel);
}

function resolveDuel(io, duel) {
  if (duel.status !== "playing") return; // already resolved (timer + guess race)
  clearTimeout(duel.timer);
  duel.status = "resolved";

  const distFor = (player) =>
    player.guess ? haversineKm(duel.location.lat, duel.location.lng, player.guess.lat, player.guess.lng) : Infinity;
  const distHost = distFor(duel.host);
  const distGuest = distFor(duel.guest);

  let winner = null; // 'host' | 'guest' | null (push)
  if (Number.isFinite(distHost) || Number.isFinite(distGuest)) {
    if (distHost < distGuest) winner = "host";
    else if (distGuest < distHost) winner = "guest";
  }

  const pot = duel.bet * 2;
  let hostBalance, guestBalance;
  if (winner === "host") {
    hostBalance = creditBalance(duel.host.userId, pot);
    guestBalance = getUser(duel.guest.userId).balance;
  } else if (winner === "guest") {
    guestBalance = creditBalance(duel.guest.userId, pot);
    hostBalance = getUser(duel.host.userId).balance;
  } else {
    hostBalance = creditBalance(duel.host.userId, duel.bet);
    guestBalance = creditBalance(duel.guest.userId, duel.bet);
  }

  finishLocationLabel(duel).then((locationName) => {
    const build = (self, opp, selfKey, selfBalance) => ({
      code: duel.code,
      actualLat: duel.location.lat,
      actualLng: duel.location.lng,
      locationName,
      you: {
        username: self.username,
        guess: self.guess,
        distanceKm: Number.isFinite(distFor(self)) ? Math.round(distFor(self) * 10) / 10 : null,
        balance: selfBalance,
      },
      opponent: {
        username: opp.username,
        guess: opp.guess,
        distanceKm: Number.isFinite(distFor(opp)) ? Math.round(distFor(opp) * 10) / 10 : null,
      },
      result: winner === null ? "PUSH" : winner === selfKey ? "WIN" : "LOSE",
      potWon: winner === null ? 0 : winner === selfKey ? pot : 0,
    });

    io.to(duel.host.socketId).emit("duel:result", build(duel.host, duel.guest, "host", hostBalance));
    io.to(duel.guest.socketId).emit("duel:result", build(duel.guest, duel.host, "guest", guestBalance));
    cleanupDuel(duel);
  });
}

async function finishLocationLabel(duel) {
  if (duel.location.mode === "streetview") {
    return (await reverseGeocode(duel.location.lat, duel.location.lng)) || "Unknown location";
  }
  return duel.location.locationName;
}

function handleOpponentLeft(io, duel, leaverRole) {
  const remaining = leaverRole === "host" ? duel.guest : duel.host;
  if (remaining?.socketId) io.to(remaining.socketId).emit("duel:opponent-left");
  cleanupDuel(duel);
}

export function registerDuelHandlers(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = verifyToken(token);
        socket.userId = payload.id;
        socket.username = payload.username;
      } catch {
        // leave socket unauthenticated; duel actions will be rejected below
      }
    }
    next();
  });

  io.on("connection", (socket) => {
    function requireAuth(cb) {
      if (!socket.userId) return cb?.({ error: "Not authenticated" });
      return true;
    }

    socket.on("duel:create", ({ betAmount } = {}, cb) => {
      if (requireAuth(cb) !== true) return;
      const user = getUser(socket.userId);
      if (!Number.isFinite(betAmount) || betAmount <= 0) return cb?.({ error: "Invalid bet" });
      if (user.balance < betAmount) return cb?.({ error: "Insufficient balance" });

      const code = randomCode();
      const duel = {
        code,
        bet: betAmount,
        status: "waiting",
        host: { userId: socket.userId, username: user.username, socketId: socket.id, ready: false, guess: null },
        guest: null,
        location: null,
        timer: null,
      };
      duels.set(code, duel);
      socketToCode.set(socket.id, code);
      socket.join(`duel:${code}`);
      cb?.({ code });
      broadcastState(io, duel);
    });

    socket.on("duel:join", ({ code } = {}, cb) => {
      if (requireAuth(cb) !== true) return;
      const duel = duels.get((code || "").toUpperCase());
      if (!duel) return cb?.({ error: "Duel not found" });
      if (duel.status !== "waiting") return cb?.({ error: "Duel already started" });
      if (duel.host.userId === socket.userId) return cb?.({ error: "Can't join your own duel" });
      const user = getUser(socket.userId);
      if (user.balance < duel.bet) return cb?.({ error: "Insufficient balance for this bet" });

      duel.guest = { userId: socket.userId, username: user.username, socketId: socket.id, ready: false, guess: null };
      duel.status = "ready";
      socketToCode.set(socket.id, duel.code);
      socket.join(`duel:${duel.code}`);
      cb?.({ code: duel.code, bet: duel.bet });
      broadcastState(io, duel);
    });

    socket.on("duel:ready", (_payload, cb) => {
      if (requireAuth(cb) !== true) return;
      const duel = duels.get(socketToCode.get(socket.id));
      if (!duel || !duel.guest) return cb?.({ error: "No active duel" });
      const player = thisPlayer(duel, socket.userId);
      if (!player) return cb?.({ error: "Not part of this duel" });
      player.ready = true;
      cb?.({ ok: true });
      broadcastState(io, duel);

      if (duel.host.ready && duel.guest.ready) {
        const host = getUser(duel.host.userId);
        const guest = getUser(duel.guest.userId);
        if (host.balance < duel.bet || guest.balance < duel.bet) {
          duel.host.ready = false;
          duel.guest.ready = false;
          io.to(duel.host.socketId).emit("duel:error", { error: "One of you no longer has enough chips for this bet" });
          io.to(duel.guest.socketId).emit("duel:error", { error: "One of you no longer has enough chips for this bet" });
          return broadcastState(io, duel);
        }
        creditBalance(duel.host.userId, -duel.bet);
        creditBalance(duel.guest.userId, -duel.bet);
        startDuel(io, duel);
      }
    });

    socket.on("duel:guess", ({ lat, lng } = {}, cb) => {
      if (requireAuth(cb) !== true) return;
      const duel = duels.get(socketToCode.get(socket.id));
      if (!duel || duel.status !== "playing") return cb?.({ error: "No active round" });
      const player = thisPlayer(duel, socket.userId);
      if (!player || player.guess) return cb?.({ error: "Already guessed" });
      if (typeof lat !== "number" || typeof lng !== "number") return cb?.({ error: "Invalid guess" });
      player.guess = { lat, lng };
      cb?.({ ok: true });
      broadcastState(io, duel);
      maybeResolve(io, duel);
    });

    socket.on("duel:cancel", (_payload, cb) => {
      const duel = duels.get(socketToCode.get(socket.id));
      if (!duel) return cb?.({ ok: true });
      if (duel.status === "waiting" || duel.status === "ready") {
        const role = duel.host.userId === socket.userId ? "host" : "guest";
        handleOpponentLeft(io, duel, role);
      }
      cb?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const code = socketToCode.get(socket.id);
      const duel = duels.get(code);
      if (!duel) return;

      if (duel.status === "playing") {
        const role = duel.host.socketId === socket.id ? "host" : "guest";
        const player = duel[role];
        player.left = true;
        if (!player.guess) {
          // Treat a mid-round disconnect as a forfeited guess so the other
          // player isn't stuck waiting on someone who's gone.
          maybeResolveWithForfeit(io, duel, role);
        }
      } else {
        const role = duel.host.socketId === socket.id ? "host" : "guest";
        handleOpponentLeft(io, duel, role);
      }
    });
  });
}

function maybeResolveWithForfeit(io, duel, forfeitingRole) {
  const opponent = forfeitingRole === "host" ? duel.guest : duel.host;
  if (opponent.guess || opponent.left) resolveDuel(io, duel);
  // otherwise wait for the opponent to guess or the timer to fire — the
  // forfeited player will simply score Infinity distance at resolution.
}
