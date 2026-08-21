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
- **Client**: React (Vite), React Router, Leaflet/OpenStreetMap, Google Maps Street View, Framer Motion, Socket.IO client

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

## 1v1 Duels

The **Duel** tab is real-time head-to-head play over Socket.IO, not solo vs.
the house:

1. Create a duel and pick a bet — you get a 5-character room code to send a
   friend (Discord, text, whatever).
2. They open Duel → Join and enter the code. Both players ready up.
3. Once both are ready, the bet is deducted from both and a single shared
   location (Street View or landmark photo, same rules as solo) is dealt to
   both players at once, same clock.
4. Whoever guesses closer wins — the winner takes both bets (2x their stake),
   a tie refunds each their own bet. Disconnecting mid-round without guessing
   counts as a forfeit so your opponent isn't stuck waiting forever.

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
