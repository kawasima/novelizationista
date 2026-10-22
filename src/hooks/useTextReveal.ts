import { useState, useEffect, useCallback, useRef } from "react";

/** 1文字あたりの表示間隔（速度1倍のとき） */
export const CHAR_SPEED_MS = 50;

export function useTextReveal(fullText: string, msPerChar: number = CHAR_SPEED_MS) {
  const [charCount, setCharCount] = useState(0);
  const intervalRef = useRef<number>(0);
  const prevTextRef = useRef(fullText);

  // fullText が変わったら同期的にリセット（useEffect だと1フレーム遅れてちらつく）
  if (prevTextRef.current !== fullText) {
    prevTextRef.current = fullText;
    setCharCount(0);
    window.clearInterval(intervalRef.current);
  }

  useEffect(() => {
    if (!fullText) return;

    intervalRef.current = window.setInterval(() => {
      setCharCount((prev) => {
        if (prev >= fullText.length) {
          window.clearInterval(intervalRef.current);
          return prev;
        }
        return prev + 1;
      });
    }, msPerChar);

    return () => window.clearInterval(intervalRef.current);
  }, [fullText, msPerChar]);

  const skip = useCallback(() => {
    window.clearInterval(intervalRef.current);
    setCharCount(fullText.length);
  }, [fullText]);

  const displayedText = fullText.slice(0, charCount);
  const isTalking = charCount < fullText.length && fullText.length > 0;

  return { displayedText, isTalking, isComplete: !isTalking, skip };
}
