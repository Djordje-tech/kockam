import { useEffect, useState } from "react";

// Counts from 0 up to `target` over `duration` ms, easing out so the number
// races ahead and then settles — a payout that lands instantly reads as a
// number, one that climbs reads as winning.
export function useCountUp(target, duration = 900, enabled = true) {
  const [value, setValue] = useState(enabled ? 0 : target);

  useEffect(() => {
    if (!enabled) return setValue(target);
    if (!target) return setValue(target);

    let frame;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, enabled]);

  return value;
}
