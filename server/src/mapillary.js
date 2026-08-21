import { randomSeedPoint } from "./seedPoints.js";

// Mapillary (owned by Meta) is a free, crowd-sourced street-level imagery
// platform — unlike Google Street View, its client access token needs no
// billing account or credit card, just a free account + app registration at
// mapillary.com/dashboard/developers. The same token is safe to use both
// server-side (Graph API search below) and client-side (MapillaryJS viewer).
const ACCESS_TOKEN = process.env.MAPILLARY_ACCESS_TOKEN || "";
export const MAPILLARY_ENABLED = Boolean(ACCESS_TOKEN);

// Mapillary rejects any search box larger than 0.010 square degrees, so the
// side length has to stay under sqrt(0.010) ≈ 0.1. 0.09 gives 0.0081 sq deg
// — a roughly 7-10km box around the seed point, with margin to spare.
const BBOX_DEGREES = 0.09;
const RESULT_LIMIT = 10;

// A real image search regularly takes several seconds, which is far too long
// to make a player watch a "Dealing…" button. So searching happens in the
// background into a small pool, and starting a round just takes whatever is
// ready. Background work can afford a patient timeout; the player never
// waits on it.
const BACKGROUND_TIMEOUT_MS = 15000;
const POOL_TARGET = 4;
// How long a round start is willing to wait when the pool happens to be
// empty (mostly just the first round after boot) before using a photo.
const COLD_START_WAIT_MS = 4000;
const CONSECUTIVE_FAILURE_CAP = 6;
const RETRY_BACKOFF_MS = 30000;

const pool = [];
let refilling = false;
let pausedUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One search attempt against a random seed point. Resolves to
// { id, lat, lng }, or null when the area has no coverage / the call failed.
async function searchOnce(timeoutMs) {
  const seed = randomSeedPoint();
  const half = BBOX_DEGREES / 2;
  const bbox = [seed.lng - half, seed.lat - half, seed.lng + half, seed.lat + half].join(",");

  try {
    const url = new URL("https://graph.mapillary.com/images");
    url.searchParams.set("access_token", ACCESS_TOKEN);
    url.searchParams.set("fields", "id,computed_geometry");
    url.searchParams.set("bbox", bbox);
    url.searchParams.set("limit", String(RESULT_LIMIT));

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.error(`[mapillary] ${res.status} near ${seed.city}:`, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    const candidates = (json.data || []).filter((img) => img.computed_geometry?.coordinates);
    if (candidates.length === 0) {
      console.log(`[mapillary] no coverage near ${seed.city}`);
      return null;
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const [lng, lat] = pick.computed_geometry.coordinates;
    console.log(`[mapillary] queued image ${pick.id} near ${seed.city}`);
    return { id: pick.id, lat, lng };
  } catch (err) {
    console.error(`[mapillary] request failed near ${seed.city}:`, err.message);
    return null;
  }
}

// Tops the pool back up in the background. Safe to call as often as you
// like — only one refill runs at a time, and it backs off after a run of
// failures so a broken token or blocked network doesn't spin forever.
function refillPool() {
  if (!ACCESS_TOKEN || refilling || Date.now() < pausedUntil) return;
  refilling = true;

  (async () => {
    let consecutiveFailures = 0;
    try {
      while (pool.length < POOL_TARGET) {
        const image = await searchOnce(BACKGROUND_TIMEOUT_MS);
        if (image) {
          pool.push(image);
          consecutiveFailures = 0;
          continue;
        }
        if (++consecutiveFailures >= CONSECUTIVE_FAILURE_CAP) {
          pausedUntil = Date.now() + RETRY_BACKOFF_MS;
          console.error(
            `[mapillary] ${consecutiveFailures} failures in a row — pausing lookups for ` +
              `${RETRY_BACKOFF_MS / 1000}s (rounds use landmark photos meanwhile)`
          );
          return;
        }
      }
    } finally {
      refilling = false;
    }
  })();
}

// Hands out a ready-made location. Returns null when nothing is available,
// in which case the caller falls back to the curated-landmark photo mode.
export async function findRandomMapillaryImage() {
  if (!ACCESS_TOKEN) return null;

  refillPool();
  if (pool.length > 0) return pool.shift();

  // Cold start: give the background search a short grace period rather than
  // immediately giving up on street view. Only worth waiting while a refill
  // is actually in flight — if lookups are backed off after repeated
  // failures, nothing is coming and waiting just stalls the round.
  if (refilling) {
    const waitUntil = Date.now() + COLD_START_WAIT_MS;
    while (Date.now() < waitUntil && refilling) {
      await sleep(250);
      if (pool.length > 0) return pool.shift();
    }
  }

  console.log("[mapillary] no location ready in time, using photo mode for this round");
  return null;
}

// Warm the pool at boot so the first round doesn't have to wait.
if (ACCESS_TOKEN) refillPool();

// Runs one search with timing and reports exactly what happened, so a
// misbehaving token / network / API can be diagnosed from the browser
// instead of by reading server logs.
export async function diagnose() {
  if (!ACCESS_TOKEN) {
    return { ok: false, reason: "MAPILLARY_ACCESS_TOKEN is not set in server/.env" };
  }

  const seed = randomSeedPoint();
  const half = BBOX_DEGREES / 2;
  const bbox = [seed.lng - half, seed.lat - half, seed.lng + half, seed.lat + half];
  const url = new URL("https://graph.mapillary.com/images");
  url.searchParams.set("access_token", ACCESS_TOKEN);
  url.searchParams.set("fields", "id,computed_geometry");
  url.searchParams.set("bbox", bbox.join(","));
  url.searchParams.set("limit", String(RESULT_LIMIT));

  const started = Date.now();
  const base = {
    searchedNear: `${seed.city}, ${seed.country}`,
    bboxAreaSqDeg: Number(((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])).toFixed(5)),
    tokenPreview: `${ACCESS_TOKEN.slice(0, 4)}…${ACCESS_TOKEN.slice(-4)} (${ACCESS_TOKEN.length} chars)`,
    poolReady: pool.length,
    lookupsPaused: Date.now() < pausedUntil,
  };

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const tookMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        reason: `Mapillary answered HTTP ${res.status}`,
        body: (await res.text().catch(() => "")).slice(0, 500),
        tookMs,
        ...base,
      };
    }
    const json = await res.json();
    const found = (json.data || []).filter((i) => i.computed_geometry?.coordinates).length;
    return {
      ok: found > 0,
      reason: found > 0 ? "Search worked" : "Request succeeded but this area has no coverage",
      imagesFound: found,
      tookMs,
      note: tookMs > BACKGROUND_TIMEOUT_MS ? "Slower than the background timeout — that's the problem" : undefined,
      ...base,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Request failed: ${err.message}`,
      tookMs: Date.now() - started,
      hint: "A timeout here means graph.mapillary.com is unreachable or very slow from this machine (VPN/firewall?)",
      ...base,
    };
  }
}

// Best-effort "City, Country" label for the reveal screen, via OpenStreetMap's
// free Nominatim reverse-geocoding API (no key needed). Falls back to null
// (client just shows coordinates) if the lookup fails.
export async function reverseGeocode(lat, lng) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "10"); // city/town level, not house-level

    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "kockam-geo-guesser (personal project)" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const a = json.address || {};
    const city = a.city || a.town || a.village || a.county || a.state;
    const country = a.country;
    return [city, country].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}
