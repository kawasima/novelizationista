import { useState, useEffect } from "react";
import type {
  CharacterDef,
  SpriteMeta,
  LoadedSprite,
  RoleFrameIndex,
  FrameMeta,
} from "../types/sprite";

function buildRoleIndex(frames: FrameMeta[]): RoleFrameIndex {
  const index: RoleFrameIndex = { idle: [], blink: [], talk: [] };
  for (const frame of frames) {
    index[frame.role].push(frame);
  }
  return index;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像を読み込めません: ${src}`));
    img.src = src;
  });
}

async function loadOne(charDef: CharacterDef): Promise<LoadedSprite> {
  const [meta, image] = await Promise.all([
    fetch(charDef.spriteMeta).then((r) => r.json() as Promise<SpriteMeta>),
    loadImage(charDef.spriteImage),
  ]);

  const roles = buildRoleIndex(meta.frames);
  const defaultIdleFrame = roles.idle[0];
  const blinkFrame = roles.blink[0];

  if (!defaultIdleFrame)
    throw new Error(`No idle frames in ${charDef.spriteMeta}`);
  if (!blinkFrame)
    throw new Error(`No blink frames in ${charDef.spriteMeta}`);

  return { image, meta, roles, defaultIdleFrame, blinkFrame };
}

/**
 * 全キャラクターのスプライトを一括プリロードし、
 * activeId に対応する LoadedSprite を即座に返す。
 */
export function useCharacterSprite(
  characters: CharacterDef[],
  activeId: string | null,
): LoadedSprite | null {
  const [cache, setCache] = useState<Map<string, LoadedSprite>>(new Map());

  useEffect(() => {
    let cancelled = false;

    // 1キャラの読み込み失敗で全員が表示されなくならないよう、キャラごとに結果を扱う
    async function loadAll() {
      const results = await Promise.allSettled(characters.map(loadOne));
      if (cancelled) return;
      const entries: [string, LoadedSprite][] = [];
      results.forEach((r, i) => {
        const c = characters[i];
        if (r.status === "fulfilled") {
          entries.push([c.id, r.value]);
        } else {
          console.error(
            `スプライトを読み込めません: ${c.id} (${c.spriteImage}, ${c.spriteMeta})`,
            r.reason,
          );
        }
      });
      setCache(new Map(entries));
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [characters]);

  if (!activeId) return null;
  return cache.get(activeId) ?? null;
}
