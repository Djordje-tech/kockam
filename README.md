# Kockam — Geo Guesser

A full-stack GeoGuessr-style game with a casino betting layer on top. Players
wager **play chips** on how accurately they can place a world landmark on the
map — closer guesses pay out bigger multipliers, misses lose the bet.

> **No real money is ever involved.** Balances are fake in-game chips only —
> there is no deposit, withdrawal, or payment processing anywhere in this
> project. It's a geography skill game with a gambling *look and feel*
> (chip bets, payout tiers, live win ticker, leaderboard), not a real-money
> gambling product.

## Stack

- **Server**: Node.js, Express, Socket.IO, SQLite (`better-sqlite3`), JWT auth
- **Client**: React (Vite), React Router, Leaflet/OpenStreetMap, Framer Motion, Socket.IO client

## How a round works

1. Sign up (username + password) and get a starting stack of 5,000 chips, plus
   a claimable +1,000 daily bonus.
2. Pick a bet size and hit **Deal** — the server picks a random real-world
   landmark and deducts the bet up front.
3. A photo of the location is fetched server-side from Wikipedia's public
   page-summary API (no API key / no billing needed) and streamed back to the
   client — the source URL is never exposed to the browser, so you can't peek
   at the answer via the image filename.
4. Drop a pin on the world map before the 60-second clock runs out.
5. The server computes the real distance (haversine) and resolves the payout:

   | Distance      | Result    | Payout multiplier |
   |----------------|-----------|--------------------|
   | < 50 km        | JACKPOT   | 5x                 |
   | < 300 km       | WIN       | 2.5x               |
   | < 1000 km      | WIN       | 1.2x               |
   | < 3000 km      | PUSH      | 0.5x               |
   | further / timeout | BUST   | 0x (bet lost)      |

6. A live feed shows real player results plus cosmetic simulated activity from
   other "players" for a busy-casino-floor feel — purely visual, it never
   touches real balances. There's also a top-10 chip leaderboard.

## Running locally

### Server

```bash
cd server
npm install
cp .env.example .env   # optional, sets JWT secret / port
npm run dev             # http://localhost:4000
```

### Client

```bash
cd client
npm install
npm run dev              # http://localhost:5173
```

The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:4000`,
so just open the client URL — no CORS setup needed in development.

### Notes on the location photos

Photos are fetched live from Wikipedia at request time and cached in memory —
this requires normal outbound internet access from wherever the server runs.
If a fetch fails (offline, or a network policy blocks Wikipedia), the server
falls back to a generated placeholder card so the round still works — you'll
just see a "Live view unavailable" gradient instead of the real photo until
connectivity is available.
