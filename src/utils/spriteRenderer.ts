import type { FrameMeta } from "../types/sprite";

export function renderCharacter(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement,
  frame: FrameMeta,
  canvasWidth: number,
  canvasHeight: number,
  bodyOffsetY: number,
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const offsetX = frame.offsetX ?? 0;
  const scale = canvasWidth / frame.width;
  const dx = offsetX * scale;

  ctx.drawImage(
    source,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    dx,
    bodyOffsetY,
    canvasWidth,
    canvasHeight,
  );
}
