import { randomSeedPoint } from "./seedPoints.js";

// Mapillary (owned by Meta) is a free, crowd-sourced street-level imagery
// platform — unlike Google Street View, its client access token needs no
// billing account or credit card, just a free account + app registration at
// mapillary.com/dashboard/developers. The same token is safe to use both
// server-side (Graph API search below) and client-side (MapillaryJS viewer).
const ACCESS_TOKEN = process.env.MAPILLARY_ACCESS_TOKEN || "";
export const MAPILLARY_ENABLED = Boolean(ACCESS_TOKEN);

const MAX_ATTEMPTS = 10;
// Mapillary rejects any search box larger than 0.010 square degrees, so the
// side length has to stay under sqrt(0.010) ≈ 0.1. 0.09 gives 0.0081 sq deg
// — a roughly 7-10km box around the seed point, with margin to spare.
const BBOX_DEGREES = 0.09;

// Resolves a random real Mapillary image near a random seed point. Returns
// { id, lat, lng } for a real spot, or null if no coverage was found nearby
// after a few tries (caller falls back to the curated-landmark photo mode).
export async function findRandomMapillaryImage() {
  if (!ACCESS_TOKEN) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = randomSeedPoint();
    const half = BBOX_DEGREES / 2;
    const bbox = [seed.lng - half, seed.lat - half, seed.lng + half, seed.lat + half].join(",");

    try {
      const url = new URL("https://graph.mapillary.com/images");
      url.searchParams.set("access_token", ACCESS_TOKEN);
      url.searchParams.set("fields", "id,computed_geometry,is_pano");
      url.searchParams.set("bbox", bbox);
      url.searchParams.set("limit", "50");

      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        console.error(`[mapillary] ${res.status} near ${seed.city}:`, await res.text().catch(() => ""));
        continue;
      }
      const json = await res.json();
      const candidates = (json.data || []).filter((img) => img.computed_geometry?.coordinates);
      if (candidates.length === 0) {
        console.log(`[mapillary] no images found near ${seed.city}`);
        continue;
      }

      // 360° panoramas give the real look-around-everywhere feel, so prefer
      // them; fall back to flat dashcam-style shots when a spot has none.
      const panos = candidates.filter((img) => img.is_pano);
      const pool = panos.length > 0 ? panos : candidates;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const [lng, lat] = pick.computed_geometry.coordinates;
      return { id: pick.id, lat, lng };
    } catch (err) {
      console.error(`[mapillary] request failed near ${seed.city}:`, err.message);
    }
  }
  return null;
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
