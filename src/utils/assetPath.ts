const base = import.meta.env.BASE_URL;

/** ルート相対パス("/images/foo.webp")をBASE_URL基準の相対パスに変換 */
export function assetPath(path: string): string {
  if (!path.startsWith("/")) return path;
  return base + path.slice(1);
}
