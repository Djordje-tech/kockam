import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from "react-leaflet";
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

function ClickCatcher({ onPick, disabled }) {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

export default function GuessMap({ pin, onPick, disabled, reveal }) {
  return (
    <div className="map-frame">
      <MapContainer center={[20, 10]} zoom={2} worldCopyJump style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        <ClickCatcher onPick={onPick} disabled={disabled} />
        {pin && <Marker position={pin} icon={guessIcon} />}
        {reveal && (
          <>
            <Marker position={[reveal.actualLat, reveal.actualLng]} icon={actualIcon} />
            {pin && <Polyline positions={[pin, [reveal.actualLat, reveal.actualLng]]} color="#ff3fa4" dashArray="6 8" />}
          </>
        )}
      </MapContainer>
    </div>
  );
}
