import { useRef, useEffect } from "react";
import { renderCharacter } from "../utils/spriteRenderer";
import type { LoadedSprite, FrameMeta } from "../types/sprite";

/** 体の揺れ（bodyOffsetY）を定義している基準の高さ（px） */
const SWAY_BASE_HEIGHT = 384;

interface Props {
  sprite: LoadedSprite;
  currentFrame: FrameMeta;
  bodyOffsetY: number;
}

export function CharacterCanvas({ sprite, currentFrame, bodyOffsetY }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // スプライトの元解像度で描き、表示サイズは CSS（.character-stage）に任せる
  const canvasHeight = sprite.meta.frameHeight;
  const canvasWidth = sprite.meta.frameWidth;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    renderCharacter(
      ctx,
      sprite.image,
      currentFrame,
      canvasWidth,
      canvasHeight,
      bodyOffsetY * (canvasHeight / SWAY_BASE_HEIGHT),
    );
  }, [sprite, currentFrame, bodyOffsetY, canvasWidth, canvasHeight]);

  return <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} />;
}
