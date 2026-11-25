import { useState, useEffect } from "react";
import type { Credits, NovelConfig, Scenario, ScenarioTranslation } from "../types/sprite";
import { assetPath } from "../utils/assetPath";

export interface NovelData {
  scenario: Scenario;
  credits: Credits | null;
  /** 言語コード → 翻訳。読めなかった言語は入らない */
  translations: Record<string, { scenario: ScenarioTranslation; credits: Credits | null }>;
}

export function resolveScenarioPaths(data: Scenario): Scenario {
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

export function resolveCreditsPaths(data: Credits): Credits {
  return { ...data, bgm: data.bgm ? assetPath(data.bgm) : data.bgm };
}

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(assetPath(path));
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function fetchOptional<T>(path: string | undefined): Promise<T | null> {
  if (!path) return null;
  try {
    return await fetchJson<T>(path);
  } catch (e) {
    console.error(`読み込めません: ${path}`, e);
    return null;
  }
}

/**
 * シナリオとクレジットを、翻訳も含めて最初にまとめて読む。
 * 途中で言語を切り替えても読み込み待ちにならないようにするため。
 */
export function useNovelData(config: NovelConfig): NovelData | null {
  const [data, setData] = useState<NovelData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [scenario, credits, translated] = await Promise.all([
        fetchJson<Scenario>(config.scenario),
        fetchOptional<Credits>(config.credits),
        Promise.all(
          Object.entries(config.translations ?? {}).map(async ([language, files]) => {
            const [tr, trCredits] = await Promise.all([
              fetchOptional<ScenarioTranslation>(files.scenario),
              fetchOptional<Credits>(files.credits),
            ]);
            return [language, tr, trCredits] as const;
          }),
        ),
      ]);
      if (cancelled) return;
      const translations: NovelData["translations"] = {};
      for (const [language, tr, trCredits] of translated) {
        if (tr) translations[language] = { scenario: tr, credits: trCredits };
      }
      setData({ scenario, credits, translations });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return data;
}
