import { Fragment, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

const guessIcon = new L.DivIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#35e6d6;border:3px solid white;box-shadow:0 0 12px #35e6d6"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const actualIcon = new L.DivIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#ffcc55;border:3px solid white;box-shadow:0 0 12px #ffcc55"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function playerIcon(color, label) {
  return new L.DivIcon({
    className: "",
    html:
      `<div style="display:flex;flex-direction:column;align-items:center">` +
      `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 10px ${color}"></div>` +
      `<div style="margin-top:2px;font:700 10px/1 sans-serif;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap">${label}</div>` +
      `</div>`,
    iconSize: [16, 28],
    iconAnchor: [8, 8],
  });
}

function ClickCatcher({ onPick, disabled }) {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function FitOnReveal({ pin, reveal, others }) {
  const map = useMap();
  useEffect(() => {
    if (!reveal) return;
    const points = [[reveal.actualLat, reveal.actualLng]];
    if (pin) points.push(pin);
    for (const o of others || []) if (o.guess) points.push([o.guess.lat, o.guess.lng]);
    map.fitBounds(points, { padding: [50, 50], maxZoom: 8 });
  }, [reveal, pin, others, map]);
  return null;
}

// Leaflet sizes itself on mount; when the container grows (expand toggle) it
// needs a nudge or the tiles only fill the old box.
function ResizeOnChange({ token }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(id);
  }, [token, map]);
  return null;
}

export default function GuessMap({ pin, onPick, disabled, reveal, otherGuesses }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`map-frame ${expanded ? "map-frame-expanded" : ""}`}>
      <button
        type="button"
        className="map-expand-btn"
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Shrink map" : "Enlarge map"}
      >
        {expanded ? "⤡ Smaller" : "⤢ Bigger map"}
      </button>

      <MapContainer
        center={[25, 5]}
        zoom={2}
        minZoom={2}
        worldCopyJump
        style={{ height: "100%", width: "100%" }}
      >
        {/* Voyager keeps country names and borders legible at world zoom —
            far easier to orient on than the plain OSM style. */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          maxZoom={19}
        />
        <ClickCatcher onPick={onPick} disabled={disabled} />
        <FitOnReveal pin={pin} reveal={reveal} others={otherGuesses} />
        <ResizeOnChange token={expanded} />

        {pin && <Marker position={pin} icon={guessIcon} />}

        {reveal && (
          <>
            <Marker position={[reveal.actualLat, reveal.actualLng]} icon={actualIcon} />
            {pin && (
              <Polyline
                positions={[pin, [reveal.actualLat, reveal.actualLng]]}
                color="#35e6d6"
                dashArray="6 8"
              />
            )}
            {(otherGuesses || []).map(
              (o) =>
                o.guess && (
                  <Fragment key={o.username}>
                    <Marker
                      position={[o.guess.lat, o.guess.lng]}
                      icon={playerIcon("#ff3fa4", o.username)}
                    />
                    <Polyline
                      positions={[
                        [o.guess.lat, o.guess.lng],
                        [reveal.actualLat, reveal.actualLng],
                      ]}
                      color="#ff3fa4"
                      dashArray="4 8"
                      opacity={0.6}
                    />
                  </Fragment>
                )
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}
