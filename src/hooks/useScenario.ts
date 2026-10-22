import { useState, useEffect } from "react";
import type { Scenario } from "../types/sprite";
import { assetPath } from "../utils/assetPath";

function resolveScenarioPaths(data: Scenario): Scenario {
  return {
    ...data,
    characters: data.characters.map((c) => ({
      ...c,
      spriteImage: assetPath(c.spriteImage),
      spriteMeta: assetPath(c.spriteMeta),
    })),
    scenes: data.scenes.map((scene) => ({
      ...scene,
      background: scene.background ? assetPath(scene.background) : scene.background,
      bgm: scene.bgm ? assetPath(scene.bgm) : scene.bgm,
      dialogue: scene.dialogue.map((line) => ({
        ...line,
        audio: line.audio ? assetPath(line.audio) : line.audio,
        slide: line.slide ? assetPath(line.slide) : line.slide,
      })),
    }) as typeof scene),
  };
}

export function useScenario(url: string): Scenario | null {
  const [scenario, setScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(url)
      .then((r) => r.json() as Promise<Scenario>)
      .then((data) => {
        if (!cancelled) setScenario(resolveScenarioPaths(data));
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return scenario;
}
