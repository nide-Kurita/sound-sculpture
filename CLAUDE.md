# Sound Sculpture

音楽を聴かせると、その曲だけの唯一の立体作品が生成される Web 作品。

このプロジェクトは **Cursor と Claude Code の両方で作業する。**
ルールの正本は `.cursor/rules/` に置き、**両方から同じファイルを読む。**
ここに内容を複製しない（複製すると必ず食い違う）。

## 作業前に必ず読むもの

1. **`.cursor/rules/project-principles.mdc`** — 作品の目的・設計原則・音→形の対応方針。
   すべての判断はこれを優先する。
2. **`.cursor/rules/worklist-workflow.mdc`** — ワークリストの進め方と、
   調整後に引き継ぎメモを残すルール。
3. **`.cursor/rules/dev-tuning-copy.mdc`** — 開発チューニングを足したら
   「調整結果（コピー用）」にも必ず載せる。

Claude Code はこの3ファイルを自動では読み込まないので、**セッションの最初に読むこと。**

## ワークリストと引き継ぎメモ（スタイル別）

作業対象のスタイルを先に決め、そのスタイルの2ファイルだけを読む。

| スタイル | ワークリスト | 引き継ぎメモ |
|---|---|---|
| `?style=aether` | `docs/worklist/AETHER.md` | `docs/handoff/AETHER.md` |
| `?style=vita` | `docs/worklist/VITA.md` | `docs/handoff/VITA.md` |
| `?style=volume` | `docs/worklist/VOLUME.md` | `docs/handoff/VOLUME.md` |
| 共通（音 → 形のエンジン） | `docs/worklist/COMMON.md` | `docs/handoff/COMMON.md` |

索引: `docs/worklist/README.md` ／ 書き方: `docs/handoff/README.md`

## 守ること

- **コードを調整したら、そのスタイルの引き継ぎメモを必ず更新してから終わる。**
  会話履歴に知識を残さない。セッションが変わってもモデルが変わっても再開できる状態にする。
- **見た目の判断は主観で報告しない。** 参考と現状を並べた画像を作ってユーザーに見せる
  （ユーザーとの合意事項）。数値で測れるものは測る。
- **再生中に検証する。** 待機状態だけ見て「直った」と報告して過去に何度も外している。
- 診断用に入れたコードは必ず消す。

## 開発

```sh
npm run dev          # Vite（5173）
npx tsc --noEmit     # 型チェック
```

見た目の検証スクリプトは `docs/aether-progress/tools/`（README あり）。
`puppeteer-core` + `~/.cache/puppeteer` の Chrome for Testing を使う。
Playwright は入っていない。

**音源は全曲 WAV**（2026-08-11 に置き換え済み）。Chrome for Testing には
proprietary codec が無く m4a / mp3 を再生できないため。
原曲は `music-original/` にアーカイブしてあり、`src/music/*.wav` は `.gitignore` 済み
（435MB。原曲から再生成できる）。**headless で全曲を検証できる。**
ただし **`src/s04.wav` は極端な信号なので見た目の判断に使わない**（実曲とは別の形になる）。
