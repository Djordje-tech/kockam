import { randomSeedPoint } from "./seedPoints.js";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
export const STREET_VIEW_ENABLED = Boolean(API_KEY);

const MAX_ATTEMPTS = 6;
const SEARCH_RADIUS_M = 40000;

// Resolves a random real Street View panorama by trying seed points until
// Google confirms coverage nearby. Returns { lat, lng, panoId } for a real
// spot, or null if no coverage was found after a few tries (caller should
// fall back to the curated-landmark photo mode).
export async function findRandomPanorama() {
  if (!API_KEY) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = randomSeedPoint();
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
      url.searchParams.set("location", `${seed.lat},${seed.lng}`);
      url.searchParams.set("radius", String(SEARCH_RADIUS_M));
      url.searchParams.set("source", "outdoor");
      url.searchParams.set("key", API_KEY);

      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      if (json.status === "OK" && json.pano_id) {
        return { lat: json.location.lat, lng: json.location.lng, panoId: json.pano_id };
      }
    } catch {
      // try the next seed point
    }
  }
  return null;
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
