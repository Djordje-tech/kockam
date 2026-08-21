// Loads the Google Maps JavaScript API script once and caches the promise so
// repeated rounds don't re-inject the script tag.
let loadPromise = null;

export function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
