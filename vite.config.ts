import { readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * 開発用音源（`src/music`）を **dev サーバーのときだけ** 配る。
 *
 * なぜ要るか（2026-09-08）:
 * `dev-audio.ts` が `import.meta.glob("./music/*.wav", { eager: true, query: "?url" })`
 * で音源を取り込んでいたため、**本番ビルドで WAV 10 曲（434MB）が `dist/assets` へ
 * 出力されていた**。Dev Audio は DEV 限定の機能なのに、市販曲が URL 直打ちで
 * ダウンロードできる状態で公開されてしまう。
 * `import.meta.env.DEV` で分岐しても glob は展開されるので、
 * **モジュールグラフから外す**しかない。
 *
 * この仕組み: dev のときだけ `/__dev-music/manifest.json` にファイル名一覧を返す。
 * 音源そのものは Vite が `/src/music/<name>` としてそのまま配る。
 * 本番ではこのプラグインが動かず、manifest の取得に失敗して Dev Audio は空になる
 * （公開 UI には元から出ないので影響なし）。
 */
const devMusicManifest = (): Plugin => ({
  name: "dev-music-manifest",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__dev-music/manifest.json", (_req, res) => {
      let files: string[] = [];
      try {
        files = readdirSync(path.resolve(process.cwd(), "src/music")).filter((f) =>
          /\.(mp3|m4a|wav|ogg|flac)$/i.test(f),
        );
      } catch {
        files = [];
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(files));
    });
  },
});

export default {
  plugins: [devMusicManifest()],
  build: {
    // three + 彫刻本体が1本（~1.1MB / gzip 320KB）。初回表示で両方要るので
    // 分割しても初回転送は減らない。500KB の既定警告だけ黙らせる。
    chunkSizeWarningLimit: 1500,
  },
};
