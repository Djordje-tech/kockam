import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "kockam.sqlite");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 5000,
    last_daily_claim TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'photo',
    location_id INTEGER,
    location_name TEXT,
    pano_id TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    bet_amount INTEGER NOT NULL,
    guess_lat REAL,
    guess_lng REAL,
    distance_km REAL,
    score INTEGER,
    multiplier REAL,
    payout INTEGER,
    result TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Migration for databases created before Street View mode existed: those
// have location_id/location_name as NOT NULL, which breaks inserting a
// streetview round (which has no landmark id/name). SQLite can't just drop a
// NOT NULL constraint, so rebuild the table when that's detected.
const roundsInfo = db.prepare("PRAGMA table_info(rounds)").all();
const locationIdCol = roundsInfo.find((c) => c.name === "location_id");
const hasMode = roundsInfo.some((c) => c.name === "mode");
const needsRebuild = roundsInfo.length > 0 && (!hasMode || locationIdCol?.notnull === 1);

if (needsRebuild) {
  db.exec("ALTER TABLE rounds RENAME TO rounds_old");
  db.exec(`
    CREATE TABLE rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'photo',
      location_id INTEGER,
      location_name TEXT,
      pano_id TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      bet_amount INTEGER NOT NULL,
      guess_lat REAL,
      guess_lng REAL,
      distance_km REAL,
      score INTEGER,
      multiplier REAL,
      payout INTEGER,
      result TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.exec(`
    INSERT INTO rounds (id, user_id, mode, location_id, location_name, lat, lng, bet_amount,
      guess_lat, guess_lng, distance_km, score, multiplier, payout, result, status, created_at, resolved_at)
    SELECT id, user_id, 'photo', location_id, location_name, lat, lng, bet_amount,
      guess_lat, guess_lng, distance_km, score, multiplier, payout, result, status, created_at, resolved_at
    FROM rounds_old;
  `);
  db.exec("DROP TABLE rounds_old");
}

export default db;
