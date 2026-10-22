import { useState, useEffect } from "react";
import type { Credits } from "../types/sprite";
import { assetPath } from "../utils/assetPath";

export function useCredits(url: string | null): Credits | null {
  const [credits, setCredits] = useState<Credits | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    fetch(url)
      .then((r) => r.json() as Promise<Credits>)
      .then((data) => {
        if (!cancelled) setCredits({
          ...data,
          bgm: data.bgm ? assetPath(data.bgm) : data.bgm,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return credits;
}
