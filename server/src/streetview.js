import { randomSeedPoint } from "./seedPoints.js";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
export const STREET_VIEW_ENABLED = Boolean(API_KEY);

const MAX_ATTEMPTS = 6;
const SEARCH_RADIUS_M = 40000;

// Resolves a random real Street View panorama by trying seed points until
// Google confirms coverage nearby. Returns { lat, lng, panoId } for a real
// spot, or null if no coverage was found after a few tries (caller should
// fall back to the curated-landmark photo mode).
function metadataUrl(seed) {
  const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  url.searchParams.set("location", `${seed.lat},${seed.lng}`);
  url.searchParams.set("radius", String(SEARCH_RADIUS_M));
  url.searchParams.set("source", "outdoor");
  url.searchParams.set("key", API_KEY);
  return url;
}

export async function findRandomPanorama() {
  if (!API_KEY) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = randomSeedPoint();
    try {
      const res = await fetch(metadataUrl(seed), { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      if (json.status === "OK" && json.pano_id) {
        return { lat: json.location.lat, lng: json.location.lng, panoId: json.pano_id };
      }
      // ZERO_RESULTS just means this spot has no coverage — normal, keep
      // trying. Anything else (REQUEST_DENIED, OVER_QUERY_LIMIT, …) is a
      // setup problem worth surfacing rather than silently swallowing.
      if (json.status !== "ZERO_RESULTS") {
        console.error(
          `[streetview] ${json.status} near ${seed.city}${json.error_message ? `: ${json.error_message}` : ""}`
        );
      }
    } catch (err) {
      console.error(`[streetview] request failed near ${seed.city}:`, err.message);
    }
  }
  console.log("[streetview] no panorama found this round, using a landmark photo");
  return null;
}

// Runs one lookup and reports exactly what happened, so a misconfigured key
// or blocked API can be diagnosed by opening a URL in the browser instead of
// reading server logs.
export async function diagnose() {
  if (!API_KEY) {
    return { ok: false, reason: "GOOGLE_MAPS_API_KEY is not set in server/.env" };
  }

  const seed = randomSeedPoint();
  const started = Date.now();
  const base = {
    searchedNear: `${seed.city}, ${seed.country}`,
    serverKey: `${API_KEY.slice(0, 6)}…${API_KEY.slice(-4)} (${API_KEY.length} chars)`,
    browserKeySet: Boolean(process.env.GOOGLE_MAPS_BROWSER_KEY),
  };

  try {
    const res = await fetch(metadataUrl(seed), { signal: AbortSignal.timeout(15000) });
    const json = await res.json();
    const tookMs = Date.now() - started;

    if (json.status === "OK") {
      return { ok: true, reason: "Street View lookup works", panoId: json.pano_id, tookMs, ...base };
    }
    const hints = {
      REQUEST_DENIED:
        "The key is rejected — check the Street View Static API is enabled and the key has no restriction blocking server use.",
      OVER_QUERY_LIMIT: "Quota or billing problem on the Google Cloud project.",
      ZERO_RESULTS: "This particular spot has no coverage — normal, the game just retries elsewhere.",
    };
    return {
      ok: false,
      reason: `Google answered ${json.status}`,
      googleMessage: json.error_message,
      hint: hints[json.status],
      tookMs,
      ...base,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Request failed: ${err.message}`,
      tookMs: Date.now() - started,
      hint: "maps.googleapis.com is unreachable or very slow from this machine (VPN/firewall?).",
      ...base,
    };
  }
}

// Best-effort "City, Country" label for the reveal screen. Falls back to
// null (client just shows coordinates) if geocoding fails or is unavailable.
export async function reverseGeocode(lat, lng) {
  if (!API_KEY) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("result_type", "locality|administrative_area_level_1|country");
    url.searchParams.set("key", API_KEY);

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    const result = json.results?.[0];
    if (!result) return null;

    const get = (type) => result.address_components.find((c) => c.types.includes(type))?.long_name;
    const city = get("locality") || get("administrative_area_level_1");
    const country = get("country");
    return [city, country].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}
