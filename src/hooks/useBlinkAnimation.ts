import { useRef } from "react";

const BLINK_DURATION_MS = 180;
const MIN_INTERVAL = 2000;
const MAX_INTERVAL = 5000;

function randomInterval() {
  return MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL);
}

/**
 * まばたきアニメーション。
 * tick() が true を返している間は「目閉じ」状態。
 */
export function useBlinkAnimation() {
  const state = useRef({
    isBlinking: false,
    lastBlinkStart: 0,
    nextBlinkAt: performance.now() + randomInterval(),
  });

  const tick = (timestamp: number): boolean => {
    const s = state.current;

    if (s.isBlinking) {
      if (timestamp - s.lastBlinkStart >= BLINK_DURATION_MS) {
        s.isBlinking = false;
        s.nextBlinkAt = timestamp + randomInterval();
      }
      return true;
    }

    if (timestamp >= s.nextBlinkAt) {
      s.isBlinking = true;
      s.lastBlinkStart = timestamp;
      return true;
    }

    return false;
  };

  return tick;
}
