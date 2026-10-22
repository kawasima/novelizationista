import { useEffect, useRef } from "react";

export function useAnimationLoop(tick: (timestamp: number) => void) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    let rafId: number;
    const loop = (timestamp: number) => {
      tickRef.current(timestamp);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
