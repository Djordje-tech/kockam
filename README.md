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
- **Client**: React (Vite), React Router, Leaflet/OpenStreetMap, MapillaryJS, Framer Motion, Socket.IO client

## How a round works

1. Sign up (username + password) and get a starting stack of 5,000 chips, plus
   a claimable +1,000 daily bonus. "Add Chips" opens a fake checkout — no card
   data is ever sent anywhere, it just instantly credits chips for the vibe.
2. Pick a bet size and hit **Deal**.
3. **If a Mapillary access token is configured** (see below), you land in a
   real, walkable street-level image at a random spot on Earth — drag to look
   around, click the arrows to move to the next image, similar to Street
   View. **Without a token**, the game automatically falls back to a curated
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

## 1v1 Duels

The **Duel** tab is real-time head-to-head play over Socket.IO, not solo vs.
the house:

1. Create a duel and pick a bet — you get a 5-character room code to send a
   friend (Discord, text, whatever).
2. They open Duel → Join and enter the code. Both players ready up.
3. Once both are ready, the bet is deducted from both and a single shared
   location (Mapillary street-level image or landmark photo, same rules as
   solo) is dealt to both players at once, same clock.
4. Whoever guesses closer wins — the winner takes both bets (2x their stake),
   a tie refunds each their own bet. Disconnecting mid-round without guessing
   counts as a forfeit so your opponent isn't stuck waiting forever.

## Running locally

### Server

```bash
cd server
npm install
cp .env.example .env   # optional, sets JWT secret / port / Mapillary token
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

## Enabling real, walkable street-level imagery (optional but recommended)

Without this, the game still fully works using the Wikipedia-photo fallback.
With it, rounds use real Mapillary street-level images you can walk around
in. Unlike Google Street View, **this needs no billing account or credit
card** — just a free account:

1. Create a free account at [mapillary.com](https://www.mapillary.com).
2. Go to [mapillary.com/dashboard/developers](https://www.mapillary.com/dashboard/developers)
   and register an application.
3. Copy the **Client Token** it gives you.
4. Put it in `server/.env` as `MAPILLARY_ACCESS_TOKEN` — the same value is
   used both server-side (to search for images) and client-side (to render
   the viewer), so that's the only credential needed.
5. Restart the server. `/api/config` will now report `mapillaryEnabled: true`
   and rounds will use real street-level imagery.

If no coverage is found near a random spot after a few tries, or the token
isn't set, the server transparently falls back to the landmark-photo mode —
nothing breaks either way.

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
   `JWT_SECRET` (any long random string), and optionally
   `MAPILLARY_ACCESS_TOKEN` for real walkable street-level imagery.
5. Deploy. Render gives you a permanent `https://your-app-name.onrender.com`
   URL — that's the link anyone can open to play or join a duel.

Note: the free tier's SQLite file is not guaranteed to persist across
redeploys (it does survive the service sleeping/waking from inactivity) — so
treat accounts/balances there as disposable for a demo, not something to
build a real balance on long-term. For real persistence, add Render's paid
persistent disk add-on and point `server/src/db.js` at that mount path.
