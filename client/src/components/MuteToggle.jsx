import { useEffect, useState } from "react";
import { isMuted, setMuted, onMuteChange, sfx } from "../sound";

export default function MuteToggle() {
  const [muted, setLocal] = useState(isMuted);

  useEffect(() => onMuteChange(setLocal), []);

  return (
    <button
      className="btn btn-ghost mute-toggle"
      title={muted ? "Sound off — click to unmute" : "Sound on — click to mute"}
      aria-label={muted ? "Unmute" : "Mute"}
      onClick={() => {
        const next = !muted;
        setMuted(next);
        if (!next) sfx.click(); // confirm it's back on
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
