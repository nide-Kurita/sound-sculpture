/**
 * 開発サーフェス / 公開サーフェスの切替。
 *
 * - `npm run dev`（Vite DEV）: 既定は "dev"。`?surface=public` で公開プレビュー
 * - `npm run build` / `preview`: 常に "public"
 */

export type AppSurface = "dev" | "public";

export const getAppSurface = (): AppSurface => {
  if (!import.meta.env.DEV) {
    return "public";
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("surface") === "public") {
    return "public";
  }
  return "dev";
};

export const isDevSurface = (): boolean => getAppSurface() === "dev";

/** 本番ビルドではバッジを出さない。DEV / 公開プレビュー時のみラベルを返す */
export const getSurfaceBadgeLabel = (): string | null => {
  if (!import.meta.env.DEV) {
    return null;
  }
  return getAppSurface() === "public" ? "PUBLIC PREVIEW" : "DEV";
};
