import { useEffect, useRef, useState } from "react";
import { Viewer } from "mapillary-js";
import "mapillary-js/dist/mapillary.css";

export default function MapillaryPanel({ imageId, accessToken }) {
  const divRef = useRef(null);
  const viewerRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    if (!divRef.current) return;

    let viewer;
    try {
      viewer = new Viewer({
        accessToken,
        container: divRef.current,
        imageId,
        component: { cover: false, bearing: false, zoom: true, direction: true },
      });
      viewerRef.current = viewer;
    } catch {
      setError(true);
      return;
    }

    return () => {
      viewer.remove();
      viewerRef.current = null;
    };
  }, [imageId, accessToken]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
        Couldn't load street view — check your Mapillary access token.
      </div>
    );
  }

  return <div ref={divRef} style={{ width: "100%", height: "100%" }} />;
}
