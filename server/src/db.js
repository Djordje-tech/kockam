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

// Best-effort migration for databases created before mode/pano_id existed.
const existingColumns = db.prepare("PRAGMA table_info(rounds)").all().map((c) => c.name);
if (!existingColumns.includes("mode")) db.exec("ALTER TABLE rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'photo'");
if (!existingColumns.includes("pano_id")) db.exec("ALTER TABLE rounds ADD COLUMN pano_id TEXT");

export default db;
