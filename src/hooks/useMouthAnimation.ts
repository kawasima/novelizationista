import { useRef } from "react";
import type { FrameMeta } from "../types/sprite";

/** 口パクのフレーム切り替え間隔（速度1倍のとき） */
export const FRAME_MS = 150;

/**
 * 口パクアニメーション。
 * 話し中は talkFrames からランダムに切り替え、非発話時は idleFrame を返す。
 */
export function useMouthAnimation(
  talkFrames: FrameMeta[],
  idleFrame: FrameMeta,
  frameMs: number = FRAME_MS,
) {
  const state = useRef({
    lastFrameTime: 0,
    currentFrame: idleFrame,
  });

  const tick = (timestamp: number, isTalking: boolean): FrameMeta => {
    const s = state.current;

    if (!isTalking) {
      s.lastFrameTime = 0;
      s.currentFrame = idleFrame;
      return idleFrame;
    }

    if (talkFrames.length === 0) {
      return idleFrame;
    }

    if (s.lastFrameTime === 0) {
      s.lastFrameTime = timestamp;
      s.currentFrame = talkFrames[0];
      return s.currentFrame;
    }

    if (timestamp - s.lastFrameTime >= frameMs) {
      const next = talkFrames[Math.floor(Math.random() * talkFrames.length)];
      s.currentFrame = next;
      s.lastFrameTime = timestamp;
    }

    return s.currentFrame;
  };

  return tick;
}
