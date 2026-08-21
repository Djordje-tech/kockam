# Kockam — Geo Guesser

A full-stack GeoGuessr-style game with a casino betting layer on top. Players
wager **play chips** on how accurately they can place a real-world location on
the map — closer guesses pay out bigger multipliers, misses lose the bet.

> **No real money is ever involved.** Balances are fake in-game chips only —
> there is no real deposit, withdrawal, or payment processing anywhere in this
> project (the "checkout" screen is a cosmetic fake, see below). It's a
> geography skill game with a gambling *look and feel* (chip bets, payout
> tiers, live win ticker, leaderboard), not a real-money gambling product.

## Stack

- **Server**: Node.js, Express, Socket.IO, SQLite (Node's built-in `node:sqlite`), JWT auth
- **Client**: React (Vite), React Router, Leaflet with CARTO Voyager tiles, Google Maps Street View, Framer Motion, Socket.IO client

## How a round works

1. Sign up (username + password) and get a starting stack of 5,000 chips, plus
   a claimable +1,000 daily bonus. "Add Chips" opens a fake checkout — no card
   data is ever sent anywhere, it just instantly credits chips for the vibe.
2. Pick a bet size and hit **Deal**.
3. **If a Google Maps API key is configured** (see below), you land in a real,
   walkable Street View panorama at a random spot on Earth — drag to look
   around, click the arrows on the road to move, just like the real thing.
   Road labels and the address bar are turned off so the location isn't handed
   to you. **Without a key**, the game automatically falls back to a curated
   set of 40 famous landmarks with a photo fetched from Wikipedia.
4. Drop a pin on the world map before the **20-second** clock runs out.
5. The server computes the real distance (haversine) and resolves the payout:

   | Distance      | Result    | Payout multiplier |
   |----------------|-----------|--------------------|
   | < 50 km        | JACKPOT   | 5x                 |
   | < 300 km       | WIN       | 2.5x               |
   | < 1000 km      | WIN       | 1.2x               |
   | < 3000 km      | PUSH      | 0.5x               |
   | further / timeout | BUST   | 0x (bet lost)      |

6. The reveal screen shows the real location's name, the distance, and a map
   with your pin, the actual spot, and a line between them.
7. A live feed shows real player results plus cosmetic simulated activity from
   other "players" for a busy-casino-floor feel — purely visual, it never
   touches real balances. There's also a top-10 chip leaderboard.

Bets range from 500 to 100,000 chips. Out of chips? "Add Chips" has six fake
purchase bundles from 500 to 150,000 chips — again, no real payment happens.

## Multiplayer

The **Multiplayer** tab is real-time play against your friends over
Socket.IO — up to 8 people in one room:

1. Create a room and pick the ante — you get a 5-character code to share
   (Discord, text, whatever).
2. Everyone else opens Multiplayer → Join and enters the code. The lobby
   shows who's in.
3. The host hits **Start Round**. Every player is charged the ante, and all
   of them get the same location on the same clock at the same moment.
4. Closest guess takes the whole pot. Exact ties split it; if nobody guesses
   at all, everyone is refunded. Not guessing in time (or disconnecting
   mid-round) simply loses your ante rather than stalling the round.
5. The results screen ranks every player by distance and plots all their
   pins on the map next to the real spot. The room then drops back to the
   lobby so you can immediately play another round together.

## Running locally

### Server

```bash
cd server
npm install
cp .env.example .env   # optional, sets JWT secret / port / Street View keys
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

## Enabling real, walkable Street View (optional but recommended)

Without this, the game still fully works using the Wikipedia-photo fallback.
With it, rounds use real Google Street View panoramas you can walk around in.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create
   a project (or use an existing one).
2. Enable billing on the project — Google requires a card on file, but the
   free monthly credit comfortably covers casual/personal use of this game.
3. Enable these three APIs for the project: **Street View Static API**,
   **Geocoding API**, **Maps JavaScript API**.
4. Create **two** API keys under "Credentials":
   - A server key (no restriction needed, used only server-side) →
     `GOOGLE_MAPS_API_KEY` in `server/.env`.
   - A browser key, restricted to your site's HTTP referrer (e.g.
     `localhost:5173/*` for local dev) → `GOOGLE_MAPS_BROWSER_KEY` in
     `server/.env`. This one is loaded into the page, so restricting it to
     your domain is important.
5. Restart the server. `/api/config` will now report `streetViewEnabled: true`
   and rounds will use real Street View.

If the metadata lookup can't find coverage near a random spot, or the key
isn't set, the server transparently falls back to the landmark-photo mode —
nothing breaks either way.

### If rounds keep showing photos instead of Street View

Open **http://localhost:4000/api/debug/streetview** in a browser. It runs a
single lookup and answers in plain JSON — whether it worked, how long it
took, and if it failed, Google's own error message plus a hint (invalid key,
API not enabled, quota, unreachable network). The server log prints the same
reasons per attempt, prefixed `[streetview]`.

## Deploying for free (so anyone can join, not just localhost)

The server can serve the built client itself — one deployed service is both
the site and the API/Socket.IO backend, so there's no separate frontend host
or CORS setup to worry about.

Using [Render](https://render.com) (free web service tier):

1. Push this repo to your own GitHub (already done if you're reading this
   from the repo).
2. On Render: **New +** → **Web Service** → connect this GitHub repo.
3. Settings:
   - **Build Command**: `cd client && npm install && npm run build && cd ../server && npm install`
   - **Start Command**: `cd server && npm start`
   - **Instance type**: Free
4. Add environment variables (same names as `server/.env.example`):
   `JWT_SECRET` (any long random string), and optionally `GOOGLE_MAPS_API_KEY`
   / `GOOGLE_MAPS_BROWSER_KEY` for real Street View. For the browser key's
   HTTP-referrer restriction, use your Render URL instead of localhost, e.g.
   `your-app-name.onrender.com/*`.
5. Deploy. Render gives you a permanent `https://your-app-name.onrender.com`
   URL — that's the link anyone can open to play or join your room.

Note: the free tier's SQLite file is not guaranteed to persist across
redeploys (it does survive the service sleeping/waking from inactivity) — so
treat accounts/balances there as disposable for a demo, not something to
build a real balance on long-term. For real persistence, add Render's paid
persistent disk add-on and point `server/src/db.js` at that mount path.
