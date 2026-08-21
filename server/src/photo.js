// Fetches a representative photo for a location from Wikipedia's public,
// key-less REST API (no billing, no Street View API needed). Falls back to a
// generated placeholder card if the network call fails, so the game still
// works offline. The image is streamed through our own server rather than
// exposing the source URL to the client, so the filename can't spoil the
// answer.

const cache = new Map(); // wiki title -> { buffer, contentType }

function placeholderSvg(seed) {
  const hue = Math.abs(hashCode(seed)) % 360;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue},70%,25%)" />
        <stop offset="100%" stop-color="hsl(${(hue + 60) % 360},70%,10%)" />
      </linearGradient>
    </defs>
    <rect width="1200" height="800" fill="url(#g)" />
    <circle cx="600" cy="360" r="90" fill="rgba(255,255,255,0.08)" />
    <text x="600" y="620" font-family="sans-serif" font-size="34" fill="rgba(255,255,255,0.5)"
      text-anchor="middle">Live view unavailable — offline mode</text>
  </svg>`);
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

export async function getLocationPhoto(location) {
  const key = location.wiki;
  if (cache.has(key)) return cache.get(key);

  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`wiki summary ${res.status}`);
    const json = await res.json();
    const imageUrl = json.originalimage?.source || json.thumbnail?.source;
    if (!imageUrl) throw new Error("no image on page");

    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const entry = { buffer, contentType };
    cache.set(key, entry);
    return entry;
  } catch {
    const entry = { buffer: placeholderSvg(key), contentType: "image/svg+xml" };
    cache.set(key, entry);
    return entry;
  }
}
