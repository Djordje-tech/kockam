import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../googleMapsLoader";

export default function StreetViewPanel({ panoId, apiKey }) {
  const divRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);

    loadGoogleMaps(apiKey)
      .then((google) => {
        if (cancelled || !divRef.current) return;
        new google.maps.StreetViewPanorama(divRef.current, {
          pano: panoId,
          // Keep it a fair guessing game: no place names, road labels, or
          // native map link that would hand the player the answer.
          addressControl: false,
          showRoadLabels: false,
          linksControl: true,
          panControl: true,
          zoomControl: true,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
        });
      })
      .catch(() => !cancelled && setError(true));

    return () => {
      cancelled = true;
    };
  }, [panoId, apiKey]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
        Couldn't load Street View — check your Google Maps API key.
      </div>
    );
  }

  return <div ref={divRef} style={{ width: "100%", height: "100%" }} />;
}
