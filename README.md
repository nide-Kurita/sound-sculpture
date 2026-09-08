# Sound Sculpture

音で彫刻する Web 作品です。

PC に入力された音を Web Audio API で解析し、Three.js 上の 3D オブジェクトをリアルタイムに変形させます。音による変化は一時的なビジュアライザーではなく、形状へ不可逆に蓄積されます。演奏が止まる、または手動で完了すると、その時点の形状を完成作品として固定します。

## Concept

この作品では、演奏を彫刻行為、音を物質への圧力、時間を形成プロセスとして扱います。

一般的な音楽ビジュアライザーのように音が止まると元に戻るのではなく、音の影響が物質へ定着していくことを軸にしています。

## 作品スタイル

公開では次の 3 つから選べます（操作パネルの「作品スタイル」、または URL `?style=`）。

| ID | ラベル | 概要 |
| --- | --- | --- |
| `vita`（既定） | 生命 | 膜が真珠光沢に輝き、完成後も呼吸を続ける |
| `monolith` | 彫刻 | 膜なし・素材感重視、完成でギャラリー照明 |
| `dither` | 網点 | 黒背景に Ordered Dither の有機ブロブ |

例: `/?style=monolith` / `/?style=dither`

成長の形は操作パネルの「成長アルゴリズム」（または URL `?algo=`）でも切り替えられます。

## Features

- マイクまたは PC の音声入力を使用したリアルタイム音解析
- FFT 解析による低音・中音・高音の分離
- 低音によるコア形状の累積変形
- GLSL Shader による半透明のデジタル外膜（スタイルによる）
- 中高音に反応するノイズ、フレネル発光、データライン表現
- 高音で生成され、表面へ吸着して固定されるパーティクル
- 一定時間の無音による自動完成
- `完了` ボタンによる手動完成
- 完成後の展示モード
- GLTF 出力

## Tech Stack

- Vite
- TypeScript
- SCSS
- Three.js
- GLSL Shader
- Web Audio API
- GLTFExporter

## Getting Started

依存関係をインストールします。

```sh
npm install
```

開発サーバーを起動します。

```sh
npm run dev
```

ブラウザで表示されたローカル URL を開き、操作パネルの `Use Input Device`（マイク）または
`Use System Audio`（PC・タブ音声）を選んでから `Start Recording` を押してください。
マイクを選ぶと、ブラウザから入力の許可を求められます。

### 推奨環境

**Google Chrome（最新版）。**

PC・タブ音声の取り込みは `getDisplayMedia({ audio })` を使うため、対応しているのは Chromium 系のみです。
Safari / Firefox は音声トラックを返さないので、この経路は使えません（2026-09-07 に Safari で確認）。
**マイク入力は Safari でも動作します**（同日確認）。

コードにブラウザ判定は無く、Chromium 限定 API も使っていないので、差が出るのはこの 1 経路だけです。
タブ音声が取れなかったときは、非対応とチェック入れ忘れの両方に届く案内を status に出します
（`AudioInputNotice`）。

### DEV / 公開モード

| 起動 | サーフェス | 確認方法 |
| --- | --- | --- |
| `npm run dev` | DEV（既定） | 左上に `DEV` バッジ。開発チューニング・開発用音源などが使える |
| `npm run dev` + `?surface=public` | 公開プレビュー | 左上に `PUBLIC PREVIEW`。公開と同じ UI |
| `npm run build` / `npm run preview` | 常に公開 | バッジなし |

DEV 中のみ、実験用スタイル `?style=metamorphosis` / `?style=lumen` / `?style=volume` / `?style=aether` も開けます（公開ビルドでは公開 3 種以外は `vita` にフォールバック）。

公開（本番）でも Settings から **時刻の指定** と **天気の条件**（晴れ・雨など）を使えます。
雨量・風速の細かいノブ、Band Test、開発チューニングは DEV のみです。

## Usage

1. `マイク入力を開始`（または PC/タブ音声）を押す
2. 音を入力する
3. 低音でコアが変形し、中高音で外膜とパーティクルが反応する
4. 無音が一定時間続くと自動で完成する
5. 任意のタイミングで `完了` を押して手動完成できる
6. 完成後に `GLTF 出力` で形状を書き出す

## Build

本番ビルドを作成します。

```sh
npm run build
```

ビルド結果を確認します。

```sh
npm run preview
```

## Notes

音入力はリアルタイム解析のため、同じ曲でも入力環境や音量によって結果が変わる可能性があります。

開発の前提ルールは [`.cursor/rules/project-principles.mdc`](.cursor/rules/project-principles.mdc)。
作業リストは [`docs/worklist/`](docs/worklist/README.md)、再開に必要な状態と地雷は
[`docs/handoff/`](docs/handoff/README.md)（どちらもスタイル別）を参照。
（`docs/WORKLIST.md` は 2026-08-09 に分割済み。移設先を指すだけの残骸です。）
