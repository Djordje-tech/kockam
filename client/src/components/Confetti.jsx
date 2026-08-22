import { useEffect, useRef } from "react";

const COLORS = ["#ffcc55", "#ffe28a", "#ff3fa4", "#35e6d6", "#33e08a", "#f1eefc"];

// A canvas burst for the moments worth celebrating. It runs on its own
// animation frame and stops itself once every piece has fallen off-screen, so
// there's nothing to clean up but the effect.
export default function Confetti({ active, pieces = 140 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const w = () => canvas.width / dpr;
    const h = () => canvas.height / dpr;

    // Fired from the middle of the screen, up and outwards, then gravity.
    const confetti = Array.from({ length: pieces }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      return {
        x: w() / 2,
        y: h() / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        size: 5 + Math.random() * 7,
        spin: (Math.random() - 0.5) * 0.3,
        rot: Math.random() * Math.PI,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      };
    });

    let frame;
    const draw = () => {
      ctx.clearRect(0, 0, w(), h());
      let alive = false;
      for (const p of confetti) {
        p.vy += 0.28; // gravity
        p.vx *= 0.99; // air
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        if (p.y < h() + 40) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w(), h());
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [active, pieces]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="confetti-canvas" />;
}
