# 引き継ぎメモ: vita（深海の生命体・出荷中の本命スタイル）

最終更新: 2026-08-17

> このファイルは 2026-08-09 に新設した。それ以前の vita の作業は
> [../worklist/VITA.md](../worklist/VITA.md) の各項目の `notes` に時系列で残っている。
> ここには**再開に必要な状態と地雷だけ**を集約してある。
> 「3. 直近の変更」は新設以降ぶんしか無い。

## 1. 目的・ゴール

`?style=vita` は**出荷中の本命スタイル**。ユーザーが本命として確定済み
（`volume` は比較用に Parked、`aether` は別方向の探索）。

目指すのは原則の3本柱（リアルタイム / 蓄積 / 完成形）が同時に成立している状態。
vita 固有の課題は「見た目の質感」寄りで、
「プレステ2くらいのレベル」「少し尖った粘土に膜が光ってるだけ」という指摘が出発点。

**vita を参考動画・参考画像の見た目へ寄せる作業は打ち切り済み。**
その目標は `aether` で追求している。

### 2026-08-10 追記: スタイルは1つに絞らない

ユーザーインタビューで「**複数スタイルが共存するのが正**」と確認された。
vita は「本命」だが、aether に置き換えられる前提のものではない。
同じ曲を違うスタイルで見られること自体が作品の価値。

あわせて、曲ごとの個性は**シルエット**に出すと定義された
（表面の質感・色・動きには曲ごとの差を担わせない）。
vita の質感まわりの項目は「作品としての美しさ」の課題であって、
「曲ごとの個性」の担い手ではない、という位置づけになる。詳細は
[COMMON.md](COMMON.md)。

## 2. いまの状態

- 出荷可能な状態で動いている。TypeScript 通過、コンソールエラー0件
  （2026-08-09 に確認）。
- **【2026-08-17 時点で vita の中心的な仕組み】熟成度 `maturity`（0→1）が入っている。**
  「LIVE と完成の見た目がまったく違う」というユーザー指摘への対応で、
  **完成の瞬間に切り替わっていた値を 1 本のスカラーで連続に寄せる**もの（worklist [P1]）。
  **vita 専用**（`getMaturity()` は非 vita で 0 を返すので他スタイルは従来どおり）。
  - 式: `maturity = (蓄積量ぶん*0.5 + 進行度*0.5) * 0.9`、単調増加・追従 1 秒。
    蓄積量ぶん = `clamp01((scalarMean / (0.65*(1+1.5*平均音量)))^1.7)`。
    完成後は `0.9 + 0.1*ease` で 1 へ。**進行度は duration が分かるときだけ**
    （マイクは `getPlaybackProgress()` が -1 → 蓄積量のみ）。
  - **定数 4 つ（`MATURITY_LIVE_CEILING` 0.9 / `MATURITY_K0` 0.65 / `MATURITY_LOUD_GAIN` 1.5 /
    `MATURITY_POWER` 1.7）は 9 曲を最後まで流した実測から決めた。1 曲や無音で動かさないこと。**
  - 寄せているもの: core の磨き（clearcoat / sheen / iridescence / roughness ＋ 宝石ぶん ＋
    種プロファイル倍率）／**結晶になる面の枚数**（`軸 × 熟成度`）／膜の不透明度
    （0.46 → 0.20）／膜の**地**（＝完成後の呼吸ドライブへ lerp）／膜の凍結（半分まで）／
    待機のゆらぎ／粒子の湧き／環境（背景・ライト、`envMix`）。
  - **寄せていないもの＝完成の特権**: 幾何の焼き込み `applySculptureMemoryBake`、
    曲が終わってヒットが止まること、完成の確定値一式。
  - **打点の反応（低→パルス / 中→膜のライン・glint / 高→粒子のチラつき）は熟成度で
    一切弱めていない。** ここを弱めると原則違反（リアルタイム性は完成形と同格）。
  - dev パネル `#maturity-panel`（vita + dev）に現在値の表示と**0〜1 の固定スライダー**。
    `window.__maturity` も生えている（`maturity_probe.js` が読む）。**どちらも消さないこと。**
  - **実機確認だけ未了。** 残差は「稜・鏡面が完成でだけ強く光る」1 点（3章の最上段）。
- **曲による色の振れ幅を畳んである**（`audio-palette.ts` の `DEFAULT_SONG_HUE_SPAN` = 0.4 /
  `DEFAULT_SONG_SAT_SPAN` = 0.55。2026-08-10 追加）。ユーザーが「色が前に出過ぎている。
  色は脇役」と明言したことへの対応。実測で曲間の色相の広がりは 0.436 → 0.249。
  **2026-08-11 にユーザー OK（値はそのまま確定）。** 全スタイル共通。
  無音の見た目を根拠に動かさないこと。
- **2026-08-10、実機セッションで4項目すべての値がユーザー確定した**
  （ブルーム 0.80 / 2.08、映り込み 0.74、肌理 1.11 / 55、膜のフレネル 物理度 0）。
  **vita に確認待ちの項目はもう無い。**
- `src/bloom-pass.ts` の `SimpleBloomPass` を実装済み（`main.ts` から使用）。
  EffectComposer は使わず、オフスクリーンへ再描画 → 明部抽出 → 加算合成の3段構成。
  **2026-08-10 にバグ2件を修正**（下記3章）。修正前は出力が常にゼロで、
  「実機確認待ち」と書いていたが**確認しようがない状態だった**。
  **強度は 2026-08-10 に確定した: threshold 0.80 / strength 2.08**
  （同日の実機セッションで 0.7 / 2.4 から微調整された最終値）。
  ユーザーが dev パネルで曲を鳴らしながら決めた値で、`bloom-pass.ts` の
  `DEFAULT_BLOOM_THRESHOLD` / `DEFAULT_BLOOM_STRENGTH` に入っている。
  **無音の見た目を根拠に動かさないこと**（仮値 0.6 が弱すぎた原因がそれ）。
  dev パネルに threshold / strength スライダーと ON/OFF があるので、
  再調整が要るときも同一ロード内で追い込める。
- `src/vita-environment.ts` の暗い自作環境を、彫刻のマテリアルにだけ `envMap` として
  差している（2026-08-10 追加。`scene.environment` は使っていない）。
  **強度は 2026-08-10 にユーザーが確定: intensity 0.74。**
  `VITA.env.envMapIntensity` へ焼き込み済み（dev パネルの既定と同値）。
  dev パネルに intensity スライダーと ON/OFF がある。
- `src/clay-grain.ts` の肌理（シェーダ側の法線摂動）を core にだけ入れている
  （2026-08-10 追加）。**強度は同日ユーザーが実機で確定: strength 1.11 / scale 55。**
  無音で置いた仮値（0.55 / 26）のちょうど2倍で、ブルームのときと同じく
  **無音で置いた仮値は弱すぎた**。dev パネルに strength / scale スライダーと ON/OFF がある。
  **幾何は割っていない。シルエットは変わらない。**
- 完成フェーズ専用の質感 `completion.finish` を `visual-style.ts` に追加済み
  （vita のみ値を設定）。完成時に clearcoat 0.42 / sheen 0.55 / iridescence 0.34、
  roughness 0.92→0.78。**2026-08-10 にユーザー OK**（白飛び・青寄り・カクつきの3点とも問題なし）。
- 膜のフレネルは **旧近似 `pow(1.0 - NdotV, 1.45)` の1行**（`main.ts` の膜シェーダ）。
  物理ベース（Schlick）へ寄せる実装を入れて実機で比べたが、ユーザーが旧近似を選び、
  **2026-08-11 にコード・uniform・dev パネル・検証スクリプトごと撤去した。** 5章参照。
- **描画は表示専用メッシュを通す**（2026-08-11 追加。`src/display-mesh.ts`）。
  変形計算は `SCULPTURE_SPHERE_DETAIL` = 10 のメッシュのまま、
  描画だけ `SCULPTURE_DISPLAY_DETAIL` = 20（三角形 2,420 → 8,820）。
  **per-vertex の変形計算は増えていない。**
  `core` / `innerCore` / `surface` はすべて表示ジオメトリを持つ。
  `geometry` / `surfaceGeometry` は**計算用で、もう描画されていない**——
  ここを取り違えると「直したのに画面が変わらない」になる。
- **膜の折り重なりをほどく処理が入っている**（2026-08-11 追加。`relaxMembraneFolds()`）。
  **既定 Iterations 1 / Strength 0.5（2026-08-11 ユーザー確定・焼き込み済み）。**
  仮値は 2 だったが、曲を鳴らして 1 に下げた。dev パネル `#membrane-panel` あり。
  無音の見た目を根拠に動かさないこと。
- **面内混色**（`pearlColorMix`）: **spread 0.28 / balance -0.1（2026-08-11 ユーザー確定）。**
  仮値 0.18 / 0 から変更。`DEFAULT_PEARL_MIX_*` へ焼き込み済み。
  無音の見た目を根拠に動かさないこと。
  **混色の *語彙* は 2026-08-11 に「無機ベース＋有機の染み」（案C）へ再定義してユーザー承認済み**
  （旧＝紫×緑。詳細は3章）。暖極は珊瑚 floor で赤を割らせず紫 wrap を停止、寒極はシアン真珠 0.52
  ＋低彩度。**spread/balance の値は据え置きだが視覚的な意味が変わった**ので、実機で見た目を
  詰めたくなったら `#colormix-panel` で再確認して `DEFAULT_PEARL_MIX_*` へ焼き直す。
- 音源は **2026-08-11 に全曲 WAV へ置き換えた**。原曲は `music-original/` にアーカイブ。
  `src/music/*.wav` は 435MB あるので `.gitignore` 済み（原曲から再生成できる）。
  headless の Chrome for Testing は m4a / mp3 を再生できないので、これで全曲検証できる。
- 性能: **実機 60.0fps**（2026-08-11 ユーザー確認。表示メッシュ detail 20 込み。
  GPU raster on / GPU memory 7.2MB / max 536.9MB）。
  ヘッドレス（ソフトウェアレンダ）は 5.5fps だが、これは実機 GPU の数字ではない。

### 現在の主要な設定値（`src/visual-style.ts` の `VITA`）

| 項目 | 値 | 備考 |
|---|---|---|
| `env.background` | `0x082838` | 深海 |
| `env.stars` | `true` | **消さない** |
| `env.environmentMap` | `false` | **true にしない**（理由は7章） |
| `env.abyssEnvironment` | `true` | 上とは別物。暗い自作環境を彫刻にだけ差す |
| `env.envMapIntensity` | `0.74` | 2026-08-10 ユーザー確定 |
| `membrane.opacityScale` | `1.45` | **下げない** |

本体メッシュ: `IcosahedronGeometry` + `mergeVertices`、`SCULPTURE_SPHERE_DETAIL`。
実測 1,245 頂点 / 2,420 三角形。

## 3. 直近の変更（新しいものを上に）

### 2026-08-17 熟成度の実機確認で未達確定。10秒 Complete の段差をコード上で特定（コード未変更）

ユーザーが Fury を約10秒再生して Complete:
**LIVE は鉱物感ゼロに見え、Complete で予測不能な鉱物変化が一気に出た。**
熟成度を下げる案は LIVE をさらに隠すため不採用。

原因は係数ではなく2つの配線:

1. `updateMaturity()` の completed 分岐が現在の maturity を始点にせず、
   `0.9 + 0.1*ease` を target にする。短時間で Complete すると、最初の更新で
   **低い現在値 → 最低0.9へ即時ジャンプ**する。
2. LIVE の結晶面は `syncGemFacets()` で **`mineralAxis × maturity`**。
   序盤は鉱物軸が上がっても低い maturity が二重ゲートになり、面が見えない。
   Complete の 0.9 ジャンプが面選択と `applyCompletionFinish()` の磨きへ同時に入り、
   実機で見えた急変になる。

次の修正方針（未実装）:
- 結晶面の早期出現は鉱物軸主体にし、maturity は磨き・透明感など熟成量へ役割を絞る。
- Complete は「押した時点の maturity → 1」を completion ease で補間する。
- 先に Fury 10秒時点の `window.__mineralAxis` / `window.__maturity` / 結晶面数を測り、
  同じ10秒 Completeで before/after を比較する。
- 「完成時の鉱物感が強過ぎる」は、予測不能な段差を除いた後に再評価する。

### 2026-08-17 [P1] 完成の飛びを詰めた（**回帰1件の修正を含む**）。プラン承認済み

ユーザー:「まだ完成で飛ぶ曲があるのが違和感」。Fury（大音量）の残差を詰める。

**先に直した回帰（8/13 の自分の変更の副作用）**: 膜の
`matureGround = 1 - uMaturity*0.55` は**完成後も効いていた**（完成時 maturity=1 → 0.45 倍）＝
**完成側の膜グローを 55% 弱めていた。** 「完成の見た目は動かさない」に反する。
`matureGround` と `uMaturity` uniform ごと**撤去**し、下の「地の収束」に置き換えた。

**設計の要（ここが今回の肝）**: 完成後の膜は**消えるのではなく一定の呼吸グローに変わる**
（`getMembraneLiveTarget` / `getMembraneGlowTarget` の breathe 分岐＝
`0.45 + breathWave*0.6` / `0.4 + breathWave*0.45`）。だから LIVE 側は
「地を減らす」のではなく**その値へ寄せる**のが正しい。

- 両関数を**地（常時）と出来事（打点）に分割**し、**地だけ**を熟成度で完成時の式へ lerp。
  出来事（`ev.ting` / `ev.chatter` / `ev.thump` / `ev.sparkle`）は**そのまま上に加算**。
  ＝完成の瞬間に消えるのは「音が鳴らなくなったぶん」だけになる。
- そのために形成中も呼吸を回す（`updateLiveBreath`。BPM は完成時と同じ `latestRhythm.bpm`）。
  **`complete()` で `breathTime` / `breathWave` をリセットしないよう変更した**
  （リセットすると完成の瞬間に呼吸の位相が飛ぶ）。

**そのほか（プランどおり）:**

- 完成専用だった種プロファイル倍率（`deriveAfterlifeMaterial` の `clearcoatMul` /
  `roughnessMul`）を LIVE の磨きにも掛ける（`liveAfterlife` を毎フレーム更新。純関数）。
  Fury は aggressive が高く clearcoat 約 1.4 倍。
- 膜の凍結 `freezeTarget` を形成中も `× 熟成度 × 0.5` まで先取り（vita のみ。最大 0.12）。
- 待機のゆらぎ `idleWobbleAmp` の常時成分を `1 - 熟成度*0.5` で減衰（**poke は触らない**）。
- 粒子は**発生量だけ** `1 - 熟成度*0.3`（チラつきの強さ・吸着済みの粒・スパークル・
  グローダストは不変。2026-08-12 に OK 済みの5値も不変）。
- 熟成度の駆動を `max(蓄積, 進行度)` → **平均**（Fury が曲の 45% で天井に張り付く問題）。
- `customProgramCacheKey`: `v19-maturity` → `v20-live-settle`。

**触っていない（完成の特権）**: 幾何の焼き込み `applySculptureMemoryBake`（既に 6 秒アニメ）、
曲が終わってヒットが止まること自体、完成の確定値一式。

**実測（Fury を最後まで。`maturity_sweep.js <out> 0 Fury 4`。4 枚平均）:**

| 状態 | 稜・鏡面 | 白い薄膜 | 輝度 | 彩度 | 面積 | 白飛び |
|---|---|---|---|---|---|---|
| 熟成度 0（変更前の LIVE 相当） | 0.62% | 30.6% | 0.599 | 0.236 | 21.4% | 0.00% |
| 0.3 | 0.58% | 27.6% | 0.590 | 0.242 | 23.4% | 0.00% |
| 0.6 | 1.54% | 35.9% | 0.600 | 0.210 | 27.6% | 0.00% |
| 自動 0.81（進行度 0.73 時点） | 0.87% | **24.7%** | 0.568 | 0.248 | 25.7% | 0.00% |
| 完成後 | 5.57% | 34.7% | 0.547 | 0.205 | 23.9% | 1.75% |

**LIVE 終盤 → 完成の差の縮み（前回 → 今回）:**

| 指標 | 前回の差 | 今回の差 |
|---|---|---|
| 白い薄膜 | 18.7pt | **10.0pt** |
| 彩度 | 0.088 | **0.043** |
| 面積 | 6.4pt | **1.8pt** |
| **稜・鏡面** | 4.58pt | **4.70pt（縮まっていない）** |

**駆動の平均化は効いた**: Fury の熟成度は以前は進行度 0.48 で天井 0.9 に張り付いていたが、
いまは 0.73 時点で 0.78 と伸び続ける（＝後半にも軌跡が残る）。

**静かな曲は無傷**（Donna Lee を最後まで。LIVE 最終 → 完成: 稜 0.03→0.05% /
彩度 0.239→0.216 / 面積 23.0→20.8%）。他スタイルも無影響（aether / volume で console error 0・
熟成度パネル非表示・`window.__maturity` 未定義）。`tsc` / `build` 通過、console error 0 件。

**残っている差は「稜・鏡面（＝完成でだけ強く光る）」の 1 点だけ**になった。
比較画像 `../vita-progress/maturity-trajectory-fury-v2.png`。
担い手はプランで**意図的に触らなかった2つ**と考えられる:

1. **幾何の焼き込み**（`applySculptureMemoryBake`）。完成でファセットが揃って大きな平面になり、
   キーライトを面でまとめて反射する。LIVE 中は表面が波打っているのでハイライトが散る。
2. **凍結**。ハイライトが静止して面を占める。LIVE は形が揺れるので瞬間の面積が小さい。

ここを寄せるには**焼き込みの一部を LIVE で先取りする**必要があり、`vectorField` を
直接書き換える現実装では蓄積を壊すので、**読み出し時にコントラストを掛ける改修**が要る
（`applySculptureMemoryBake` は `bake*Original` から `vectorField` を作り直す設計）。
着手はユーザー判断。

### 2026-08-13 [P1] step 2〜4 実装。磨き・宝石・膜・環境を熟成度で連続に寄せた（**実機確認だけ残**）

**実測（Fury を最後まで＝軸 1.00 の曲。同一個体・再生中に熟成度を固定して掃引。4 枚平均）:**

| 状態 | 稜・鏡面 | 白い薄膜 | 輝度 | 彩度 | 面積 | 白飛び |
|---|---|---|---|---|---|---|
| 熟成度 0（**変更前の LIVE 相当**） | 0.65% | 30.3% | 0.596 | 0.231 | 21.8% | 0.00% |
| 0.3 | 0.50% | 22.5% | 0.582 | 0.257 | 23.0% | 0.00% |
| 0.6 | 0.98% | 26.8% | 0.576 | 0.239 | 25.6% | 0.00% |
| 0.9（曲末の自動値） | 0.24% | **16.0%** | 0.539 | 0.269 | 25.9% | 0.00% |
| 完成後 | 4.82% | 34.7% | 0.552 | 0.181 | 19.5% | 0.81% |

画像 `../vita-progress/maturity-trajectory-fury.png`。
**膜の乳白が 30% → 16% へ連続に澄んでいく**（＝軌跡が見える）。
**Fury は曲の 45〜48% で熟成度が上限 0.9 に達する**（step 0 の予測どおり。蓄積が先行する曲の性質）。

**残る飛び（Fury のような大音量の曲）**: 完成後だけ稜・鏡面が 4.82%、彩度 0.181。
差の担い手は**プランで「完成の特権」として触らないと決めた3つ**——動きの凍結（膜の
ライブグローが止まる）／粒子の消滅／幾何の焼き込み（`applySculptureMemoryBake`）。
**静かな曲（Donna Lee）ではこの飛びはほぼ無い**（下の表）。
これ以上寄せるなら特権の一部（凍結・粒子）を熟成度に乗せる判断が要る＝**ユーザー判断**。

他スタイルへの巻き込み無し（`?style=aether` / `volume` で console error 0 件・
熟成度パネル非表示・`window.__maturity` 未定義＝**vita 専用のまま**）。

#### 変更の中身

**触った場所（すべて「完成の瞬間に切り替わっていた値」を熟成度で lerp するだけ。
完成側の確定値は 1 つも動かしていない）:**

- `updateCoreMaterial`: 形成中に `FINISH_EPSILON` へ固定していた
  clearcoat / sheen / iridescence を **`完成値 × 熟成度`** に。roughness も
  `LIVE値 → finish.roughness` を熟成度で補間。宝石ぶん（結晶面の割合 × 宝石強度）も
  同じ熟成度で加算（完成時の `gemFinish` と同じ量に向かうので段差にならない）。
- `applyCompletionFinish`: 立ち上がりを `ease` → **`max(ease, 熟成度)`**。
  **`Math.max(m.clearcoat, …)` で下限を作る形にしてはいけない**——宝石ぶんが毎フレーム
  加算されて clearcoat が 1 へ、roughness が 0 へ暴走する（実装中に踏みかけた）。
  非 vita は熟成度 0 なので `ease` のまま＝従来と同じ。
- `syncGemFacets`: 結晶になる面の枚数を **`軸 × 熟成度`** に。
  軸は 10〜40 秒で飽和するので、これが無いと枚数だけ序盤で止まる。
- 膜シェーダ: 結晶面の alpha 天井を `0.55 + gGemMask*0.06`（**上げていた**）→
  `mix(0.55, 0.30, gGemMask)`（**下げる**）。板を白く盛らず透かす。
- `membraneOpacity`: vita の LIVE 上限 0.46 を **`lerp(0.46, 0.20, 熟成度)`** に。
  `opacityScale: 1.45` / `completedOpacity: 0.2` は不変。`uCompleted`（凍結）は熟成度で動かさない。
- `updateEnvironmentCrossfade`: `target = isComplete ? 1 : 熟成度`。背景色・key/fill/ambient/rim が
  まとめて寄る（**非 vita は熟成度 0 なので従来どおり**）。
- 膜シェーダに `uMaturity` を追加し、**地（常時出ている乳白・グロー）だけ**を
  `matureGround = 1 - 熟成度*0.55` で下げる。**ヒット（glint / melodyLines / microSignals）には
  掛けていない**——原則「リアルタイム性は完成形と同格」。掛けたのは pearlLive / hotVeins /
  ember / vita の真珠オーバーレイと、それぞれの alpha 寄与だけ。
  → **【2026-08-17 に撤去】この係数は完成後も効いて完成側を 55% 弱める回帰だった。
  いまは膜の地を「完成後の呼吸ドライブへ lerp」する形（最上段の項目）。`uMaturity` uniform も無い。**
- `customProgramCacheKey`: `v18-gemfaces` → `v19-maturity`（**現在は `v20-live-settle`**）。

`npx tsc --noEmit` / `npm run build` 通過、console error 0 件。

**測り方の落とし穴（1 度踏んだ）**: `completion_gap_stats.js` を**形成 60 秒**で回すと
「飛びが縮んでいない」という結果が出る。**その時点の熟成度がまだ 0.44 だから**で、
実装の問題ではない。**曲を最後まで聴かせてから測ること**（`formSec` に 0 を渡すと
進行度 0.93 まで待つモードにした）。

**実測（Donna Lee を最後まで／軸 0＝宝石なしの曲。5 枚平均）:**

| フェーズ | 稜・鏡面 | 白い薄膜 | 輝度 | 彩度 | 局所コントラスト | 面積 |
|---|---|---|---|---|---|---|
| LIVE 最終（熟成度 0.82） | 0.05% | 0.0% | 0.363 | 0.251 | 0.0261 | 22.9% |
| 完成 +2 秒 | 0.06% | 0.0% | 0.406 | 0.210 | 0.0217 | 21.8% |
| 完成 +11 秒 | 0.06% | 0.0% | 0.334 | 0.257 | 0.0231 | 21.5% |

**軸 0 の曲では飛びがほぼ消えた**（before は Fury でしか測っていないので、
Donna Lee の before 値は無い。Fury の通し計測は下の「次にやること」）。

### 2026-08-13 [P1] step 1 完了。熟成度 `maturity` を配線した（**見た目はまだ変えていない**）

step 0 の実測（下の項目）を受けて、ユーザーが**「進行度を最低保証として混ぜる」**を選択。

**式（`SoundSculpture.updateMaturity`）:**

```
蓄積量ぶん = clamp01((scalarMean / (0.65 * (1 + 1.5 * 平均音量)))^1.7)
maturity   = max(蓄積量ぶん, 進行度) * 0.9      // 単調増加・追従は約1秒
完成後     = 0.9 + 0.1 * smoothstep(completionProgress)
```

- `scalarMean` = 永久メモリ（`sculptureMemory` + `erosionField`）の平均。
  平均音量 = `soundExposure / activeFormingTime`。
- **定数 4 つ（`MATURITY_K0` 0.65 / `MATURITY_LOUD_GAIN` 1.5 / `MATURITY_POWER` 1.7 /
  `MATURITY_LIVE_CEILING` 0.9）は 9 曲の実測から決めた。無音や 1 曲だけを見て動かさないこと。**
- **進行度は duration が分かるときだけ**（`AudioInput.getPlaybackProgress()`。
  マイク入力は -1 を返し、蓄積量だけになる）。

**触った場所（すべて計測・配線。見た目に効く箇所は 1 つも触っていない）:**

- `src/main.ts`: `maturity` フィールド / `updateMaturity()` / `getMaturity()`（**vita 以外は 0**）/
  `getMaturityInputs()` / `maturityMix`（override・enabled）/ `maturityDebug` /
  `AudioInput.getPlaybackProgress()`。`update()` の先頭で毎フレーム進める
  （**形の凍結中・完成後も含めてどの状態でも進める**）。
- `index.html` + `initMaturityPanel()`: dev パネル `#maturity-panel`（現在値の表示と
  **0〜1 の固定スライダー**）。**固定できないと曲を最後まで聴かないと途中の見た目を確認できない。**
  vita + dev 以外では出さない。
- `docs/aether-progress/tools/maturity_probe.js` / `maturity_fit.js`（新規）。

`npx tsc --noEmit` / `npm run build` 通過。

### 2026-08-13 [P1] step 0 完了。**「蓄積量だけ」では 9 曲で両立しないと実測で確定**（ユーザー判断待ち）

熟成度（maturity）の駆動を**蓄積量だけ**にすると決めたので、9 曲を**最後まで**流して候補指標を実測した
（`maturity_probe.js` 新規。1 曲＝曲の実時間。全 9 曲で約 45 分。console error 0 件）。

**触ったコード（計測用の読み出しだけ。見た目は 1 画素も変えていない）:**

- `src/main.ts`: `soundExposure`（`Σ overall*dt`）の積算 / `getMaturityInputs()` /
  `maturityDebug` ＋ `window.__maturity`（dev のみ）。`npx tsc --noEmit` 通過。
- **完成フラグは `render()` で拾っている。** 完成すると `advanceSculptureSimulation` を
  通らなくなるので、そこで更新すると**完成を検出できない**（プローブが 12 分の上限まで
  回り続けた。最初これで踏んだ）。

**実測1: `formDevelopment` は熟成度に使えない。** 終端値の 90% に達する時点が
**曲の 3〜16%**（Fury 3% / 修羅場 4% / Fly Away 6% / AIR 6% / 6:00 8% / ロビンソン 8% /
Peaches 10% / I'm Yours 16% / Donna Lee 38%）。序盤の球を守るゲートなので当然だが、
数字で確認した。**そのまま使わないこと。**

**実測2: どの候補も「徐々に上がって終端で 0.9」を 9 曲同時には満たせない。**
`maturity = clamp01((x/K)^p) * 0.9` を、**進行度との差の平均**を目的関数にして総当たり
（`maturity_fit.js` 新規）。終端値だけを条件にすると**曲の 2% で 0.75 に跳ね上がる解が
「最良」になる**ので、目的関数は必ず進行度との差にすること。

| 指標 | 最良の式 | 進行度との差(平均) | 終端の最小 |
|---|---|---|---|
| `scalarMean`（sculptureMemory+erosion の平均） | `(x/1.25)^1.5` | **0.125** | 0.464 |
| `vecMean`（vectorField の平均長さ） | `(x/0.45)^0.8` | 0.159 | 0.249 |
| `exposure`（Σ overall*dt） | — | 0.414（全曲が即天井） | 0.900 |

**実測3: 正規化を「それまでの平均音量」で可変にすると改善するが、まだ届かない。**
`maturity = clamp01((scalarMean / (0.65*(1+1.5*平均音量)))^1.7) * 0.9`
（平均音量 = `exposure / activeSeconds`。全部その場で計算できる量だけ）。
進行度との差 0.125 → **0.101**、終端の最小 0.464 → **0.676**。

| 曲 | 平均音量 | 25% | 50% | 75% | 終端 |
|---|---|---|---|---|---|
| Peaches En Regalia | 0.469 | 0.177 | 0.318 | 0.510 | **0.676** |
| Donna Lee | 0.262 | 0.235 | 0.353 | 0.540 | 0.735 |
| AIR | 0.756 | 0.201 | 0.325 | 0.527 | 0.766 |
| Fly Away | 0.553 | 0.237 | 0.452 | 0.652 | 0.819 |
| 6:00 | 0.613 | 0.305 | 0.631 | 0.900 | 0.900 |
| Fury Of The Storm | 0.744 | 0.465 | **0.900** | 0.900 | 0.900 |
| I'm Yours | 0.310 | 0.286 | 0.505 | 0.803 | 0.900 |
| 修羅場 | 0.823 | 0.198 | 0.429 | 0.717 | 0.900 |
| ロビンソン | 0.588 | 0.240 | 0.388 | 0.675 | 0.900 |
| （理想） | — | 0.225 | 0.450 | 0.675 | 0.900 |

**残る2つの外れ方（これが「蓄積量だけ」の限界そのもの）:**

1. **静かな曲は終端で 0.68〜0.77**。完成の瞬間に飛びが 3 割残る（目標は 1 割）。
2. **激しい曲（Fury）は曲の 50% で天井**。後半は「もう完成した見た目」のまま。

原因: **蓄積量の終端値が曲によって 2.6 倍ちがう**（scalarMean 0.80〜2.08）ので、
固定の正規化では「静かな曲が届かない」か「激しい曲が早く張り付く」のどちらかになる。
**係数をこれ以上こねても解けない**（総当たりの最良がこの値）。ユーザー判断を仰ぐ段階。

### 2026-08-13 LIVE→完成の飛び幅を実測。「熟成度 maturity」でプラン合意（コードは未変更）

ユーザー要望:「complete の時と Live の時の見た目が全く違うので、Live の時から complete に
向かう軌跡を見れるようにしたい。」＝ 前日の宝石の話より広い（**軸 0 の曲でも完成時に
clearcoat 0.42 / sheen 0.55 が立つので、飛びは全曲で起きている**）。

**飛び幅の before 値**（`completion_gap_stats.js` 新規。Fury・各フェーズ5枚平均。
本体画素の面積比。**この表が今後の判定基準**）:

| フェーズ | 稜・鏡面(L>0.8) | 白い薄膜 | 輝度 | 彩度 | 局所コントラスト | 面積 |
|---|---|---|---|---|---|---|
| LIVE 60 秒（軸 1.00） | 3.08% | 35.4% | 0.599 | **0.235** | 0.0536 | 22.4% |
| 完成 +2 秒 | 8.46% | 38.1% | 0.575 | 0.155 | 0.0380 | 29.3% |
| 完成 +11 秒 | **7.32%** | 40.5% | 0.583 | **0.130** | 0.0423 | 25.9% |

稜・鏡面が 2.4 倍、彩度が 44% 落ち、面積が +15%。**変化のほぼ全部が完成 +2 秒までに
終わっている**ので、6 秒の完成アニメーション（`completion.seconds`）は飛びを均していない。

**合意した設計（AskUserQuestion で確定。手順は [../worklist/VITA.md](../worklist/VITA.md) [P1]）:**

- `maturity`（熟成度 0→1）を **1 本**持ち、完成の瞬間に切り替わっている値を
  `lerp(LIVE 値, 完成値, maturity)` に置き換える。**新しい LIVE ルックは作らない**
  （完成の見た目は承認済み。その途中を出すだけ）。
- **駆動 = 蓄積量だけ**（曲の進行度・経過時間は使わない）。**ユーザー判断。**
- **LIVE 終端で完成の 90%**（`MATURITY_LIVE_CEILING = 0.9`）。完成はほぼ凍結だけになる。
- **範囲 = 磨き ＋ 宝石 ＋ 膜 ＋ 彩度 ＋ 環境（背景・ライト）**。
- **地は寄せる / 出来事は据え置き / 完成の特権は触らない**が切り分けの原則。
  据え置き = 低→パルス・中→膜の線・高→粒子。特権 = 動きの凍結・粒子の消滅・
  幾何の焼き込み・最終パレット確定・`finalizeProfile`。

**着手前に読む地雷（「蓄積量だけ」を選んだ帰結）:**

- `formDevelopment` は序盤の球を守るゲートなので**すぐ 1.0 に張り付く。そのまま熟成度に使えない。**
- 静かな曲（Donna Lee / I'm Yours）は蓄積が小さく、終端で 0.9 に届かない可能性がある。
- したがって **step 0 は「9 曲で蓄積量の候補を実測して正規化を決める」**。
  実測なしに係数を決めないこと。両立不能と分かったらユーザーへ再相談する（代案の難点も併記済み）。

### 2026-08-12 「宝石が完成時にしか出ない」の原因を実測で特定（コードは未変更。指示書は worklist [P1]）

ユーザー指摘:「鉱石のような見た目が完成時にのみ反映されている。LIVE 時から徐々に反映させたい。」

**製品コードは 1 行も変えていない。** 分かったことと、新規の検証ツール2本だけ。
実装の指示書は [../worklist/VITA.md](../worklist/VITA.md) の **[P1]**（step 1〜4）にある。

**実測1: 音色軸は LIVE で上がっている。軸は原因ではない。**
`gem_live_vs_done.js`（新規）で Fury を 120 秒・自動軸で計測:
0.034（0〜8 秒＝ウォームアップ）→ **0.66（15 秒）→ 0.90（20 秒）→ 1.00（40 秒）**、以降 120 秒まで 1.00。
40 秒で 18 面すべてが結晶になっている。**ただし 10〜40 秒で飽和してその後は平ら**なので、
「曲が進むにつれて徐々に」にはなっていない（軸は曲全体の grit×brightness の**走平均**だから）。

**実測2: 軸 1.00 の LIVE で宝石強度を 2（既定の2倍）にしても、完成時の 1/3 しか見えない。**
`gem_live_strength_stats.js`（新規）で稜・鏡面の面積（L>0.80 の画素比）を 6 枚平均:

| 状態 | 宝石強度 | ハイライト面積 |
|---|---|---|
| LIVE 55 秒（軸 1.00） | 0 | 2.56% ／ 1.78%（前後2回） |
| LIVE 55 秒（軸 1.00） | **2** | **3.44%** |
| 完成後（軸 1.00） | 1 | **10.7%** |

**＝強度の問題ではない。** 第1版・第2版と同じ轍（強度を上げて解決しようとする）を踏まないこと。

**原因（コードで確定した「完成でしか立ち上がらない」3点）:**

1. **磨きが完成専用。** `VITA.core` の `clearcoat` / `sheen` / `iridescence` は **0** なので、
   形成中は `main.ts` L5477〜5500 が毎フレーム `FINISH_EPSILON`（1e-4＝見えない）に固定する。
   立ち上げるのは `applyCompletionFinish`（L4746〜）だけで、宝石ぶんの加算
   `gemFinish = getCrystalFaceRatio() * uGem * ease` も**完成アニメーションの ease に乗っている**。
   clearcoat 0→0.8 / iridescence 0→0.62 / roughness ×0.6 が**完成の瞬間に初めて起きる。**
   ソースのコメント自身が「ここが演奏中と作品になった後を分ける境目」と書いてある。
2. **膜が LIVE では倍以上濃い。** `uOpacity` の上限が LIVE **0.46** / 完成 **0.20**（L8046〜）。
   さらに LIVE のときだけ glint / hotVeins / ライン / pearl が alpha に加算され、
   `min(alpha, 0.55 + gGemMask*0.06)` の天井に張り付く。**結晶面の上では天井を上げている**
   （板を光らせる意図）ので、乳白の veil が濃くなって下の宝石が見えない。
3. **粒子・ダストが LIVE だけ本体に散っている**（完成すると 0.5 秒で消える）。
   **粒子は 2026-08-12 に OK 済みなので触らない。** 1・2 を直してから相対的な埋もれを見る。

幾何（`applyCrystalFacets` / `applyMembraneFacets`）は **LIVE でも効いている**。
ただし完成時に `applySculptureMemoryBake` が ease 0→1 でコントラストを立てるので、
角ばったシルエットも完成でもう一段強くなる。

比較画像 `../vita-progress/gem-live-vs-done.png`（同一個体・LIVE 20s/45s/120s と完成後）。
LIVE は乳白の膜と白い粒に覆われた塊、完成後は平らなカット面と白い稜。

**新規ツール**（`docs/aether-progress/tools/`）:

- `gem_live_vs_done.js` — 同一 run で LIVE を数回撮ってから Complete。軸の時系列も出す。
  **別 run で比べると別個体になって比較にならない**（過去に踏んでいる）。
- `gem_live_strength_stats.js` — ハイライト面積の**平均**で宝石の効きを測る。
  **1 枚ずつの A/B は形が動くので判定できない**（今回まず失敗した。2 秒で形が変わる）。

console error 0 件。製品コードは未変更なので tsc / build は無関係。

### 2026-08-12 宝石を作り直した（第3版）。**軸＝結晶になる面の枚数**。原因は強度ではなく配線

ユーザー:「再生中に宝石感が全く感じられなかった。材質は鉱物であり宝石であったり水晶のように
透き通った面に光が当たると光るイメージ。鉱物の部分と生物の部分を曲によって出し分けたい。
メタル系はほとんど鉱石、アコースティック系は生物、間のバンドサウンドは両立。」

**第1版・第2版が効かなかった本当の原因（4つ。どれも強度ではない）:**

1. **Dev Audio の曲は歪み検出を通っていなかった。** `readSpectralFlatness()`（1.5–7kHz の
   スペクトル平坦度＝グリット）は**ライブ analyser（マイク）専用**で、WAV は
   `buildDeterministicTimeline` → `drainSimulationSteps` → `bandsFromDeterministicFrame` を通る。
   そこでの grit は `brightness*0.55 + contrast*0.3` という**代用値**だった。
   旧コメントの「実曲は実アナライザ経路」は**誤り**。実機も headless も音色を測っていなかった。
2. **`computeMineral` が事実上 2 値だった。** 実測すると Fury 0.55 / 他はほぼ 0。
   とくに **6:00 と AIR は `organic` が 1.0 に飽和**していて、`- organic*0.4` だけで軸が潰れていた。
3. **宝石は全部その軸の掛け算でゲートされていた**（旧 `gemAmount = uMineral * uGem`）。
   軸 0 の曲では**パネルの「宝石強度」を 2 にしても 0**。
   「パネルを色々試したが宝石に見えるところが無かった」の直接の説明。
4. **軸を見る手段が無かった。** `mineral_songs3.js` が参照していた `window.__mineralAxisDebug` は
   **実在しなかった**。headless の検証は全部 `axisOverride=1` 固定だったので、
   **自動軸では一度も確認していなかった。**

**新しい設計（AskUserQuestion で合意）:**
軸は**強度ではなく「結晶になる面の枚数」**を決める。18 枚の結晶平面それぞれに曲固有のランクを
配り、軸がランクを越えた面から順に結晶になる（`smoothstep` でポップしない＝曲が進むと
面が1枚ずつ結晶化する）。**幾何と材質が同じ面選択を共有する**ので、平らな結晶面と丸い生物面が
同じ個体に同居する＝ユーザーの言う「鉱物の部分と生物の部分」。
軸 0 では 1 枚も結晶にならず、18 面ループごと skip する**完全な恒等**。
結晶面の地は**暗く落として艶と稜で見せる**（ユーザー選択。生物面の粘土パレット確定値は不変）。

**音色軸の calibration（9 曲を実測 → `grit × brightness` で組み直し）**

`organic` は合成軸で飽和するので**外した**。実測（110 秒・自動軸）の `grit×brightness`:

| 曲 | grit | bright | 積 | 新 axis | 目標 |
|---|---|---|---|---|---|
| Fury Of The Storm | 0.905 | 0.190 | 0.171 | **1.000** | 0.85–1.0 ✓ |
| Fly Away | 0.789 | 0.206 | 0.162 | **1.000** | 0.85–1.0 ✓ |
| 修羅場 | 0.782 | 0.186 | 0.140 | **0.987** | 0.35–0.6 ✗ |
| 6:00 | 0.668 | 0.208 | 0.135 | **0.967** | 0.85–1.0 ✓ |
| Peaches En Regalia | 0.452 | 0.207 | 0.093 | **0.566** | 0.35–0.6 ✓ |
| AIR | 0.600 | 0.143 | 0.088 | **0.505** | 0.35–0.6 ✓ |
| ロビンソン | 0.472 | 0.177 | 0.082 | **0.461** | 0.35–0.6 ✓ |
| I'm Yours | 0.146 | 0.166 | 0.023 | **0.001** | 0–0.12 ✓ |
| Donna Lee | 0.000 | 0.036 | 0.000 | **0.000** | 0–0.12 ✓ |

**8/9 が目標帯。修羅場だけが鉱石側に振り切れる**（実測 grit 0.78 / 持続音圧 0.835 で
Fury 0.90 / 0.877 とほぼ同じ帯。測った 4 指標のどれでも Fly Away・6:00 と分離できない）。
**修羅場だけを狙い撃つ項は入れていない**（実測に合わせた調整ではなくなるため）。
ユーザー判断待ち。定数は `species-profile.ts` の `MINERAL_GRIT_REF/LO/HI` の 3 つだけ。

**触った場所:**

- `src/deterministic-audio.ts`: `DeterministicSpectralFrame.flatness` を追加。
  `buildDeterministicTimeline` で 1500–7000Hz の幾何平均/算術平均（プレゼンスゲート付き。
  `readSpectralFlatness` と同じ式）を計算する。**Dev Audio の全曲がここを通る。**
- `src/main.ts` `bandsFromDeterministicFrame`: 代用値 → `frame.flatness`。
- `src/species-profile.ts`: `computeMineral(grit, brightness)` に書き直し。
  `getAverageGrit()` / `getMineralInputs()`（飽和しない生の曲平均）を追加。
- `src/main.ts`: `mineralDebug` + `window.__mineralAxis` + `#mineral-panel` 上部の現在値表示。
  **軸が見えないと強度は決められない。消さないこと。**
- `src/main.ts` `SoundSculpture`: `facetRank` / `facetCrystal` / `anyCrystalFace` /
  `syncGemFacets()` / `getCrystalFaceRatio()`。`initCrystalFacets` が面ごとのランクを配る。
- `src/main.ts` `applyCrystalFacets` / `applyMembraneFacets`: 「軸に比例して全頂点を弱くスナップ」
  → **「結晶になっている面だけフル強度でスナップ」**。軸 0 なら 18 面ループごと skip。
- `src/gem-material.ts`: 全面書き直し。最寄り面＋次点（＝稜）の解決／面法線への平ら化／
  地の暗さ／稜の明線／縁のフレネル／面の閃き／透過の回り込み。
  `uGemPlanes`（オブジェクト空間 xyz＋結晶フラグ w）と `uGemPlanesWorld`（ワールド法線）を
  毎フレーム送る。**`normalMatrix` はフラグメントシェーダに来ない**ので CPU で回して渡し、
  シェーダは `viewMatrix` でビュー空間へ落とす。
- `src/main.ts` 膜（`surfaceFragmentShader` の `uVita` 分岐）: 結晶面の上だけ
  **透かして**稜と鏡面を出す板にする。**白く盛らない**（乳白の膜が被さると下の宝石が見えない。
  最初そうして実際に見えなくなった）。生物面の上は真珠シアンの確定値のまま。
- `src/main.ts` `applyCompletionFinish`: `DEFAULT_GEM_STRENGTH` 直参照を
  `gemUniforms.uGem.value` へ修正（**パネルの強度が完成後に効かないバグ**）。量は結晶面の割合。
- `src/sculpture-tuning.ts`: コピー用ダンプに宝石の現在値と**そのときの軸**を含める。
- dev パネル `#mineral`: 宝石強度 / 結晶面の地の暗さ / 稜 / 面の閃き / 透過 / 分散(fire)。
- `customProgramCacheKey`: `v17-gem` → `v18-gemfaces`。

**現在の仮値**（`gem-material.ts`。**すべて仮値。実機で曲を鳴らして確定する**):
`STRENGTH` 1 / `FLATTEN` 0.9 / `BODY_DARK` 0.45 / `RIDGE` 1.1 / `FIRE` 0.35 /
`SPARKLE` 1 / `THROUGH` 0.5 / `ROUGHNESS_MUL` 0.12 / `SUBFACET` 0.07 / `FACET_SCALE` 90。

**検証（すべて再生中・自動軸）:**
- `npx tsc --noEmit` / `npm run build` 通過、**console error 0 件**。
- 3 曲を再生中に撮って並べた: `docs/vita-progress/gem-faces-auto-axis.png`
  （Fury 軸1.00 / ロビンソン 軸0.42 / I'm Yours 軸0.00）と拡大 `gem-faces-zoom.png`。
  **軸 1 は平らなカット面と鋭い稜、軸 0.42 は平らな面と丸い面が同居、軸 0 は丸いローブだけ。**
- 軸 0（I'm Yours / Donna Lee）で生物感がそのまま残ることを確認。
- **`SUBFACET` を 0.22 / `FACET_SCALE` 16 にすると旧版と同じ市松模様のブロックが出て
  宝石に見えなくなる**（実際に出した）。副次ディテールは細かく薄くだけ。

**残・確認事項:**
- **実機で強度を確定する。** `?style=vita&surface=dev` の `#mineral-panel` で曲を鳴らしながら
  6 つのスライダーを追い込み、`DEFAULT_GEM_*` へ焼き込む。パネル上部に軸が出るので、
  **まず「いま軸がいくつの曲を見ているか」を確認してから強度を触ること。**
  headless はソフトレンダで艶・鋭い映り込みが鈍る。無音仮値は例外なく弱い側に外れる。
- **修羅場が鉱石側に振り切れている**件（上の表）。聴感と違うならユーザー判断。
- calibration は 110 秒の部分平均。**完成時は `finalizeProfile()` が曲全体の平均で確定する**ので、
  長い曲（6:00 は 6 分超）は最終値がこの表とずれうる。

### 2026-08-12 宝石マテリアルを大幅強化（第1版は「宝石に見えない」と却下）→ **第3版で作り直し済み**

ユーザー:「パネルを色々試したが宝石に見えるところが無かった。もっと強めたい。」

**第1版が効かなかった原因**（重要・繰り返さない）:
- 主役を「roughness を下げて env 反射を鋭くする」に置いていたが、**vita の環境は暗い深海で
  映り込む明るいものが無い**。マット粘土（roughness 0.92）の反射を鈍く映すだけで宝石にならない。
- スパークルが `pow(noise,9)` で疎・暗。微ファセット法線の傾きも弱く、**通常のライティングでも
  面ごとの明暗の段が出ず**、カット面に見えなかった。
- これらは GPU 依存の効果なので **headless（swiftshader）では出ず、検証もできていなかった**。

**第2版の設計転換**:
- **宝石が宝石に見える主因＝面ごとの明暗の段**。微ファセット法線の傾きを大幅に強め
  （tilt 0.9→2.6・facetScale 9→16・facetAmount 既定 1.1・mix 係数を [0,1] にクランプして
  強度 2 での over-extrapolation を防止）、**通常の拡散ライティングだけで面が段になって割れる**。
- 環境に依存しない**自己発光のグリント**を主役に: ビュー空間の固定キーライト2灯 ×
  ファセット法線のハーフベクトルで鋭いスペキュラを焚く（回転で面が閃く twinkle）。
  **加算発光なので headless でも同じ見え方＝ここで強度を実測できるようになった。**
- 常に見える基調として**結晶エッジ（フレネル）の光**と**面ごとの分散色（fire）**を追加。
- roughness 鋭化は残す（`DEFAULT_GEM_ROUGHNESS_MUL` 0.42→0.12）。
- 完成後も override に追従するよう `updateAfterlife` 冒頭で `uMineral` を更新（第1版は
  forming の更新でしか設定せず、完成後に override を変えても効かなかった＝isolate 検証も無効だった）。
- cache key `v14-gem`→`v17-gem`。

**現在の仮値**（`gem-material.ts`。**全て仮値・実機で確定**）: `DEFAULT_GEM_STRENGTH` 1 /
`DEFAULT_GEM_FACET_SCALE` 16 / `DEFAULT_GEM_FACET_AMOUNT` 1.1 / `DEFAULT_GEM_ROUGHNESS_MUL` 0.12 /
`DEFAULT_GEM_SPARKLE` 1.3。

**検証（headless で今度は見える）**: `gem_material_ab.js`（軸=1 固定・幾何凍結・宝石強度 0→2）で
gem ON がカット結晶＋分散色＋鋭い閃きにはっきり変わる（`docs/vita-progress/gem-material-ab.png`）。
`mineral_facet_sweep.js`（既定強度・軸 0→1）で **axis0=生物感のまま（no-op）/ axis1=ファセット結晶**
（`docs/vita-progress/gem-axis-sweep.png`）。console error 0件・`tsc`/`build` 通過。

**残・実機確認**:
- **既定強度 1 でもかなり強い**（面全体がハーレクイン状のカット面になる）。生物感を残したいなら
  実機で「宝石強度」を下げる余地が要るかもしれない。逆に強めたいなら 2 まで。
- **分散色（pink/purple/yellow）が鮮やか**。原則「色は脇役」との兼ね合いで、強すぎると言われたら
  `GEM_FRAGMENT_EMISSIVE` の `gemDisp`・`gemRim` 係数を下げる（fire は宝石材質の一部という整理だが要合意）。
- ファセットが**やや規則的（市松）**に見える。有機的にしたいなら次はセル境界を崩す。
- **実機で「宝石強度」「微ファセット量」を確定 → `DEFAULT_GEM_*` へ焼き込み。**

### 2026-08-12 生物感＋鉱物感（宝石）の材質層を実装。音質連動。**実機で強度確定だけ残**

ワークリスト [P2]。プラン合意（AskUserQuestion）で決めたスコープ:
**出力=コア＋完成＋膜 / 切り分け=材質＋vita 独自の微ファセット追加 / 駆動=既存 `SpeciesProfile.mineral` 軸**。

**設計の要**: 「角ばった形（シルエット）」は COMMON [P1] の `applyCrystalFacets` /
`applyMembraneFacets` が既に持っている。本項目はその面を**宝石の材質に見せる光学だけ**を足す。
**幾何は割らない**（per-vertex 変形予算＝5章の制約を消費しない）。同じ mineral 軸で駆動するので、
音質→材質は「シルエットと同じ軸の補強」であって新しい曲差の主役ではない（原則
「表面の質感に曲差の主役を担わせない」と整合。ユーザーは vita 独自の微ファセット追加も承認）。

**触った場所:**
- `src/gem-material.ts`（新規）: mineral 駆動の GLSL 3片＋共有 uniform（`gemUniforms`）。
  `gemAmount() = clamp(uMineral,0,1) * uGem`。**これが 0 なら全 GLSL ブロックが `if` で飛ぶ＝恒等。**
  (1) 微ファセット法線: `vClayDir` をセルに割り、セルごと一定のランダム傾きを `normal` に足す
      → 隣接セルで env の映り込みが変わり結晶面に見える。(2) roughness 鋭化: ファセット面の
      `roughnessFactor` を下げ、暗い自作 env（abyssEnvironment）のハイライトを鋭い映り込みにする。
      (3) スパークル: 高周波ノイズの輝点を `totalEmissiveRadiance` へ加算（分散＝fire 擬似）。
- `main.ts` `installCorePierceShader`: gem uniform を差し、`#include <roughnessmap_fragment>` /
  `<normal_fragment_maps>`（clay-grain の後）/ emissive 注入の末尾へ gem GLSL を差す。
  `customProgramCacheKey` を `v13-grain` → **`v14-gem`**。
- `main.ts` 膜 vita 分岐（`uVita>0.5`）: `uMineral>0` の曲だけ結晶ガラスの鋭い輝点を散らす。
  **上限クランプは確定値 0.55/0.92 を下限に保ち、gemMem ぶんだけ天井を上げる**（`0.55+gemMem*0.05`）。
  `uMineral==0` で真珠シアン確定値と完全一致。膜 uniforms に `uMineral`（core と共有オブジェクト）を追加。
- `main.ts` `applyCompletionFinish`: 既存 finish 代入の**後に** mineral スケールの磨きを**加算**
  （clearcoat +・clearcoatRoughness −・iridescence +・roughness ×）。確定値が下限として残るので
  `mineral==0`（アコギ）は現状のまま。歪みロックほど完成時に宝石へ寄る＝「生きもの→作品」＋音質連動。
- `main.ts` 毎フレーム（膜更新）で `gemUniforms.uMineral.value = this.getMineralAxis()`。
  `getMineralAxis()` は dev override があればそれ、無ければ曲の mineral。非 vita/無効時は 0。
- dev パネル `#mineral`: 「宝石強度（材質）」「微ファセット量（材質）」スライダー追加（specs 配列に
  足しただけ。HTML 変更なし）。リセットで `DEFAULT_GEM_*` へ戻す。

**現在の仮値**（`gem-material.ts`。**すべて仮値・実機で確定**）: `DEFAULT_GEM_STRENGTH` 1 /
`DEFAULT_GEM_FACET_SCALE` 9 / `DEFAULT_GEM_FACET_AMOUNT` 0.6 / `DEFAULT_GEM_ROUGHNESS_MUL` 0.42 /
`DEFAULT_GEM_SPARKLE` 0.5。完成磨きの係数は `applyCompletionFinish` 内の定数（0.4/0.28/0.28/0.4）。

**検証**（headless・Fury 40 秒形成→完成後に固定して撮影）:
- `mineral_facet_sweep.js` で軸 0/0.5/1 を掃引: **console error 0件**。axis0 は生物感のまま、
  axis1 で結晶面の割れが増える（`docs/vita-progress/gem-axis-sweep.png`）。
- **材質の isolate**: `gem_material_ab.js`（新規）で軸=1 に固定して幾何ファセットを凍結し、
  宝石強度スライダーだけ 0→2 に振った。**幾何は同一**で、gem ON 側に微ファセットの結晶ディテールと
  中間調のスパークルが増える（`docs/vita-progress/gem-material-ab.png`）。＝差は gem-material の寄与。
- `npx tsc --noEmit` / `npm run build` 通過。
- **`uMineral==0` の no-op は構造的に保証**（全 gem GLSL が `if(...>0.001)` ゲート、完成磨き・膜は `*gemMem`/`*gemFinish`＝0）。

**残・確認事項（ユーザー実機）:**
- **headless はソフトレンダで艶・鋭い映り込み・スパークルが鈍る**（handoff 6章の既知事項）。
  宝石の本領（env の鋭い反射・分散のきらめき）は GPU でしか出ない。**強度は実機で曲を鳴らして確定。**
  `#mineral` パネルの「宝石強度」「微ファセット量」で追い込み → `DEFAULT_GEM_*` へ焼き込む。
- ブルーム・肌理・env・混色と同じく、**無音仮値は例外なく弱い側に外れている**。仮値 1/0.6 も疑う。
- 膜のスパークルが真珠シアンを壊していないか（`uMineral==0` は不変。高 mineral 曲だけ確認）。
- 完成時の磨きが白飛びしないか（歪みロックで完成させて確認）。

### 2026-08-12 粒子に厚みを持たせた（[P3] 球インポスター）。**ユーザー OK 済み**

ワークリスト [P3]（**OK が出たので削除済み**）。丸ビルボードで「チカチカ光っているだけ」に見える粒
（`particleMaterial`＝吸着する粒）を、陰影付きの小球に見せる。

**触った場所:** `src/main.ts` のみ。
- 新規 module 定数 `PARTICLE_BEAD_COLOR_FRAGMENT`（GLSL）を追加。
- `particleMaterial` から `map`（丸テクスチャ）を外し、`onBeforeCompile` で
  points フラグメントの `#include <color_fragment>` をこの定数へ差し替える。
  `customProgramCacheKey = "particle-bead-v1"`（他の PointsMaterial と points プログラムを
  共有して注入前シェーダが再利用されるのを防ぐ）。**これが無いと sparkle 等と混線しうる。**
- `gl_PointCoord` から `beadUv`→擬似法線 `beadN=(uv.x,-uv.y,sqrt(1-r²))` を作り、
  拡散 `0.30 + 0.86*max(dot(N,L),0)`＋白い鏡面 `pow(dot(N,H),28)*0.55`＋
  縁 `smoothstep(1.0,0.72,r²)` を乗せる。光源 `L=normalize(-0.42,0.66,0.62)`。
- size 0.028 → 0.032（厚みが読める大きさへ微増）。**加算ブレンド・depthWrite:false は据え置き。**
- **頂点数・ドローコールは不変**（Points 1個・per-vertex 計算増なし）。
- **スパークル / グローダスト / detachment dust は無変更**（高域チラつきの担い手は従来のまま）。

**three r184 固有の罠**: points の `vColor` は USE_COLOR でも **`vec4`**
（`color_pars_fragment` が `varying vec4 vColor`）。最初 `diffuseColor.rgb *= vColor`（vec3）で
コンパイルエラーになった。正しくは `#if defined(USE_COLOR)||defined(USE_COLOR_ALPHA) diffuseColor *= vColor;`。

**完成すると粒は消える**（`completeFadeOut` 1.8/s ≒0.5秒で park）。ワークリストの
「完成形に吸着して残る」は現状の挙動と合っておらず、粒が見えるのは**主に演奏中**。
見た目判断は演奏中で行うこと（今回もそうした）。

**検証**:
- 実機経路（`particle_shot.js` 新規／Fury を 40 秒形成）で **console error 0件**。
  本体表面に細かい粒が studding して見える（`../vita-progress/particle-bead-inapp-{before,after}.png`。
  ただし seed が別個体なのでシルエットは違う。粒の粒状感の差だけ見る）。
- シェーダ効果の切り分けは合成ハーネス（同一点群・同条件で従来 vs 球インポスター）で:
  従来＝均一なにじんだ光の玉／本変更＝左上に明部＋小さな鏡面ハイライト・右下が陰る小球。
  比較画像 `../vita-progress/particle-bead-compare.png`。
- `npx tsc --noEmit` / `npm run build` 通過。
- **ハーネス（一時 `bead_test.html`）は削除済み**（vite が root で拾う診断用ページ。残さない）。
  再現するなら particle 断面を isolate せず `particle_shot.js` で実アプリを撮るのが正道。

**2026-08-12 にユーザー OK。** 現在値（陰影下限 0.30・拡散 0.86・鏡面 0.55/指数 28・size 0.032）で確定。
後から強弱の要望が出たらこの5値で調整できる。**headless はソフトレンダで艶が鈍る**ので再調整は実機で。

## 3. 直近の変更（新しいものを上に）

### 2026-08-12 ワークリストに「生物感＋鉱物感（宝石）・音質連動」を追加（コード変更なし）

ユーザー要望を [../worklist/VITA.md](../worklist/VITA.md) [P2] に追加。
生物感は維持、宝石的な鉱物感を足す、音質で出方を変える。**着手前にプラン必須。**
COMMON の音色→シルエット項目とは別（材質感側）。壊れていた粒子項目の残骸も削除
（粒子は 2026-08-12 に OK 済み）。

### 2026-08-12 再生中の膜の輝きをさらに抑えた（2段目）

ユーザー:「もう少し抑えて」。前回（2026-08-11）から vita 寄与を一段下げる。
idleDim の live 係数 0.22→0.14、glowScale 0.52→0.32、glint/ライン/alpha も同程度。
ヒットの有無は残す。

### 2026-08-11 再生中の膜の輝きを少し抑えた（vita シェーダのみ）

ユーザー:「vita の再生中の膜の輝きを少し抑えて」。
`surfaceFragmentShader` の `uVita` 分岐のみ。幾何・フレネル式・確定済みパネル値は無変更。
- live による idleDim の上がりを弱める（0.38→0.22）
- 高域・glint・glow（hotVeins/ember）・ライン／alpha の寄与を vita だけ約半減寄り
- ヒット自体は残す（中音の読み取りは維持。量だけ下げる）

### 2026-08-11 粘土の混色を「紫×緑」から「無機ベース＋有機の染み」へ再定義（案C）。ユーザー承認済み

ワークリスト [P2] 粘土の色（**承認されたので Open から削除済み**）。
ユーザーが方向を選択・承認（無機ベース＋有機の染み）。spread 0.28 / balance -0.1 は据え置き。

**step1 で出どころを確定**（`colormix_ab.js` の凍結スイープ、`docs/vita-progress/` 記録）:
混色 OFF（spread 0）はオリーブ単色で**紫は出ない**。spread を上げると紫×緑が出る。
原因は旧 `resolvePearlColorPoles` の `warmHue = base - spread`：base が琥珀（大半の曲は
song fold で anchor 0.126 付近）だと `0.13 - 0.28 = -0.15` が**赤(0)を越えて 0.85 の紫へ wrap**し、
`coolHue = base + spread ≈ 0.41` が緑。**紫は暖極の wrap、緑は寒極。base の色ではない。**

**対処**（`main.ts` の `resolvePearlColorPoles` / `bakeCorePearlColors` のみ。シルエット不変）:
- 暖・有機極: `Math.max(0.035, base - spread*0.5 + time*0.5)`。**赤を割らない floor で紫 wrap を停止**（珊瑚/琥珀）。
- 寒・無機極: `lerpHueShortest(base + spread + wx*0.5, 0.52, 0.45)`。シアン真珠 0.52 へ寄せる。
- **per-pole 彩度**を追加: 無機（寒）`×0.45`（淡い真珠/氷）/ 有機（暖）`×0.92`。mix で補間。
- mix の midpoint を **0.64（寒寄り）** に。無機を主体・有機を少数の染みにする。
- **SPREAD = 0 は従来と完全一致**（warm===cool===base・sat 倍率1）。曲/環境の平均色は殺していない。

**検証**（`colormix_form_vs_done.js`、I'm Yours）: **紫は完全に消えた。**
再生中は真珠白〜淡シアンの無機ベース＋緑・淡暖色の染み（膜の 案A シアン真珠と揃う）。
完成後は base が最終曲パレット（琥珀）なのでオリーブ〜黄緑が主で、再生中より暖かい。
比較画像 `docs/vita-progress/clay-inorganic-organic-compare.png`（左 旧紫×緑 / 中 案C再生中 / 右 案C完成後）。
`npx tsc --noEmit` / `npm run build` 通過、console error 0件。

**残・確認事項**:
- **spread（確定値 0.28）/ balance（-0.1）の *視覚的な意味* が変わった。** 旧は対称±、案Cは
  無機↔有機アンカーへの寄せ幅。**曲を鳴らしながらパネルで再確認が要る**（値自体は据え置き）。
- **完成後をもっと真珠シアン寄りにするか**はユーザー判断。したいなら寒極の 0.52 寄せ率を上げる／
  midpoint をさらに寒へ／balance を +側へ。無音で決めないこと。
- 膜（案A）と粘土（案C）は焼き直し API を奪い合わないよう別関数のまま。

### 2026-08-11 膜の色・模様を真珠シアンへ寄せる（案A）。ユーザー確認待ち

ワークリスト [P2]。参考 `docs/vita-progress/ref-membrane-2026-07-16.png`。

**触った場所:** `main.ts` の `surfaceFragmentShader` の `uVita` 分岐だけ。
幾何（relax / display-mesh）、フレネル、`applyMembraneClayPalette`、完成 gloss /
afterlife は**触っていない**（別セッションの完成寄り作業と競合しないため）。

変更の要点:
- 膜ベース = mix(真珠白, palette, 0.20) / accent = mix(シアン, paletteAccent, 0.26)
- ヒット色を金色→寒色。茶ノイズを青寄り。真珠 irid からパレット乗算を外す
- 白芯を潰していた `color * 0.58` を緩和。無音 idleDim を少し上げる
- 天気/曲の色は pearlTint に 0.12 だけ残す

比較画像: `docs/vita-progress/membrane-pearl-compare.png`（左 参考 / 右 案A）。
`npx tsc --noEmit` 通過、console error 0件（再撮時）。
**形は別個体。色と膜のトーンだけ見る。** 曲再生中の確認が残る。

### 2026-08-11 混色・膜relaxの既定をユーザー確定して焼き込んだ

開発チューニングダンプで確定。他項目（ノブ／ブルーム／映り込み／肌理／曲の色の幅）は
既定と同値で差分なし。

| 項目 | 仮値 | 確定値 |
|---|---|---|
| `DEFAULT_PEARL_MIX_SPREAD` | 0.18 | **0.28** |
| `DEFAULT_PEARL_MIX_BALANCE` | 0 | **-0.1** |
| `DEFAULT_MEMBRANE_RELAX_ITERATIONS` | 2 | **1** |
| `DEFAULT_MEMBRANE_RELAX_STRENGTH` | 0.5 | 0.5（変更なし） |

ワークリストから [P1] 混色を削除。膜幾何の既定確認も完了。
次の色まわりは「膜の色合い・模様」「粘土の無機×有機」（どちらもプラン待ち）。
**無音を根拠にこれらの確定値を動かさないこと。**

### 2026-08-11 開発チューニングのコピーに膜relax・混色を追加

`formatSculptureTuningForAgent` と `#copy-tuning` が、ブルーム等に加えて
**膜の折り重なり**（`DEFAULT_MEMBRANE_RELAX_*`）と**混色の広がり**（`DEFAULT_PEARL_MIX_*`）も
JSON で出すようにした。vita 以外では null（セクションごと省略）。
見た目の係数は変えていない。混色パネル変更時にも `refreshTuningExport` するよう接続。

### 2026-08-11 曲の色の幅をユーザー確定（COMMON。コード変更なし）

ユーザー OK: `DEFAULT_SONG_HUE_SPAN` = 0.4 / `DEFAULT_SONG_SAT_SPAN` = 0.55。
ソースは既に同値。詳細は [COMMON.md](COMMON.md) 3章。

### 2026-08-11 ワークリストに膜の色・粘土パレット項目を追加（コード変更なし）

ユーザー要望（チャット）:
- 膜の色合い・模様が気に入らない。昔（2026-07-16）の方が良い。
  参考を `docs/vita-progress/ref-membrane-2026-07-16.png` に置いた。
- 粘土が紫と緑がデフォルトに見える。無機と有機の融合を検討したい。

**コードは触っていない。** 別セッションの aether 調整、および直上の完成後 emissive 修正・
混色／膜 geometric の既定確認と競合しないよう、ワークリストだけ更新した。

- [P1] 混色: notes に「既定確認だけ終える。パレット刷新は別項目」と接続を追記。
- 新規 [P2] 膜の色合い・模様（7/16 真珠シアンへ）。幾何（relax / display-mesh）とは分離。
- 新規 [P2] 粘土の色 — 無機×有機。[P1] 確認後に着手。混色コードは同時にいじらない。
詳細プランは [../worklist/VITA.md](../worklist/VITA.md)。

### 2026-08-11 完成後だけ混色が洗われていた。完成の単色 emissive を弱めて再生中に合わせた

ユーザー指摘:「完成後の色合いが単色すぎる。再生中とは違う値になっている？同様にして」。

**原因**（実測で確定）: vita は**再生中は core の emissive を 0**にして頂点カラー
（真珠＋暖⇔寒の混色）をそのまま見せている（`updateAudioColors` の `membrane.vita` 分岐、
`main.ts` L5192〜)。ところが完成の breathe afterlife（`updateAfterlife` の
`case "breathe"` / pearl 分岐）は **`palette.hue` の単色 emissive を全体に強く足していた**
（intensity 0.16 + breathWave*0.32 + …、sat 上限 0.82）。これが面全体を1色へ引き寄せ、
混色を洗っていた。**同一個体で forming と done を撮って測ると、本体の色相の散らばり
circStd が forming 0.149 → done 0.075（約半分）**に落ちていた（＝ユーザーの体感どおり）。

**対処**（`main.ts` の breathe/pearl 分岐のみ）: 完成 emissive を弱く・淡くして、
呼吸のゆらぎだけ残し色は頂点カラー主導に戻した。
`intensity 0.16→0.05 / breathWave係数 0.32→0.12 / emissiveStrength係数 0.28→0.1`、
`sat 上限 0.82→0.3・係数 0.72→0.4`、`light 基準 0.2→0.18` 等。**混色の bake 自体は無変更。**

実測（`colormix_form_vs_done.js` を新規追加。同一個体で forming と done を撮る）:
done/forming の circStd 比が **0.51 → 0.62** に改善。done の circStd は 0.075 → 0.092。
比較画像 `docs/vita-progress/colormix-form-vs-done.png`（左 再生中 / 右 完成後・修正後。
完成後も緑・橙・黄が同居して見える）。**残差**: forming は膜・ハイライトで淡い高キーの
パステルになり（light 0.72）、done は最終曲パレット（I'm Yours は琥珀）を base にした
やや濃いめの混色（light 0.44）。base の色みが違うのは正しい（完成色＝曲の最終色）。
混色の“量”を forming に完全一致させたいなら、次は完成の gloss（`completion.finish` の
clearcoat/sheen）か膜の単色化（`memBase/memAccent.lerp(palette.*)`）を疑う。
**この修正は無音で決めていない**（曲を鳴らして完成させた実測）。`npx tsc --noEmit` 通過、console error 0件。

### 2026-08-11 単色化を解消。時刻・天気・曲の色を面内で暖⇔寒に混ぜる（[P1]）。dev パネル付き

ユーザー要望:「色味が単色に落ち着く傾向。時刻と天気と曲の構成で変化する色を、単調ではなく
混ぜ合わせる処理を追加」。

**原因**: 時刻・天気・曲を1つの色相スカラー `clayHueBase` へ合算し、`bakeCorePearlColors`
でそれに小さなノイズを足すだけだったので、面全体が1色に落ち着いていた。
コメントには「暖⇔寒の補色2極」を目指すとあったが、実際は単一色相＋ノイズで2極になっていなかった。

**対処**（`src/main.ts` のみ）:
- `resolvePearlColorPoles()` を追加。`clayHueBase` を中心に **±spread の暖極・寒極**を作り、
  暖極に時刻シフト（`hourClayShiftFromHour`）・寒極に天気シフト（`weatherClayShiftFromSnapshot`）を
  0.5 倍で乗せる。配分の偏り（寒側の面積）は曲の明るさ・天気（雲/雨）で動かす。
  **平均色は base 付近に保つ**設計なので、曲による“平均色”の差（脇役へ畳んだ量）は増えない。
  増えるのは面内のばらつきだけ。
- `bakeCorePearlColors()` を、専用の低周波ノイズ `pMix`（`morphologySeed + 61.7`）で
  暖⇔寒を空間補間する式に置き換え。細かいムラ（p1..p4）は従来係数のまま上に重ねる。
  **`spread = 0` では warm===cool===base に潰れ、hue は従来式に一致する**（OFF = 完全な no-op）。
- 色相のみ。**サチュレーション・明度・シルエットは一切変えていない**（頂点カラー属性だけ）。
- `pearlColorMix`（module 変数）と `DEFAULT_PEARL_MIX_SPREAD` = 0.18 / `..._BALANCE` = 0 を追加。
- 公開メソッド `rebakeCoreColors()` を追加。通常は形成中の update が周期的に焼き直すが、
  完成後は焼き直しが止まるので、dev パネルで即時に見せるために公開した。
- dev パネル `#colormix-panel`（`initColorMixPanel`。広がり 0〜0.4 / 配分の偏り -0.4〜0.4 /
  混色ON・OFF / 既定に戻す）。スライダー操作で `rebakeCoreColors()` を呼ぶので即時反映。
  **vita 以外ではパネルごと出さない**（`visualStyle.membrane.vita && devSurface` で gate）。

**検証**（`docs/aether-progress/tools/colormix_ab.js` を新規追加）:
形はロードごとに変わるので、**Complete で凍結した同一個体で spread だけを振る**
（パネルのスライダーを動かすと即座に焼き直される）。I'm Yours の完成形で:

| spread | 面内の色相の散らばり circStd | OFF比 |
|---|---|---|
| 0（OFF・従来） | 0.064 | 1.00x |
| **0.18（既定）** | **0.095** | **1.48x** |
| 0.30 | 0.116 | 1.80x |

**シルエットは3枚とも完全に同一**（同一シード・凍結後・色だけ変えている）。
`npx tsc --noEmit` 通過、console error 0件。比較画像 `docs/vita-progress/colormix-compare.png`
（OFF 単色 / 0.18 / 0.30。0.18 で緑・桃の領域が薄く同居、0.30 で桃×緑の補色対比が強く出る）。

**既定 0.18 はユーザー確認待ち。** ブルーム・肌理とも無音で置いた仮値が実機で倍以上に
変わっているので、この値も信用せず**曲を鳴らしながらパネルで決めてもらう**こと。
`resolvePearlColorPoles` の時刻/天気の傾き（暖極↔寒極の振り分け）は wired だが、
**その傾きの大きさ単体は測っていない**（±spread が主で、時刻/天気は小さなtilt）。
天気・時刻での色の出方を詰めるなら、`daytime-preview` / `weather-preview` で環境を固定して
`colormix_ab.js` を回す（環境ごとにどちらの極が優勢になるかを見る）。

### 2026-08-11 膜の折り重なりをほどいた（[P2] の (1)）。dev パネル付き

**原因**: 膜は core と同じ `vectorField` / `flowField` を使う（`vectorScale` 1.04）。
これは接線方向の変位で、1頂点あたり最大 0.92 まで貯まる。膜の半径 1.46 に対して
6割を超えるので、隣り合う頂点が別方向へ大きく引かれると**面が交差する。**
拡大したときに見えていた「半透明の板が重なって縁が直線になる」の正体はこれ。

**対処**: `relaxMembraneFolds()` を追加。**位置ではなく変位**を 1-ring 近傍で平均する
（ラプラシアン平滑）。折り重なりは変位場の高周波成分なので、そこだけ落ちて全体の形は残る。
**位置を平滑化すると球へ戻ってしまうので、必ず変位側でやること。**
近傍は接触圧の拡散用に既にある `membraneNeighbors` を使い回している。

dev パネル `#membrane-panel`（Iterations 0〜6 / Strength 0〜1 / ON・OFF / 既定に戻す）。
既定は Iterations 2 / Strength 0.5。**vita 以外ではパネルごと出さない**
（aether / volume で `hidden`・スライダー0本・console error 0件を確認済み）。

実測（`membrane_relax_ab.js`。**同一 run 内**で完成後に値だけ動かすので形は完全に同じ）:
0回では膜の縁が直線と鋭い折れになり、奥でもう1枚のシートが交差している。
2回でその縁が曲線になり、交差も消える。4回まで上げると膜が core に張り付いて
外殻としての存在が薄くなる。
画像 `docs/vita-progress/membrane-relax.png` / `membrane-relax-zoom.png`。

**別 run どうしで比べようとして一度失敗した。** 実時間60秒で切っても run ごとに
到達する形が違い、3水準を並べても比較にならなかった。**完成後に値だけ動かすこと。**

`npx tsc --noEmit` / `npm run build` 通過。**既定値はユーザー確認待ち**——
無音で決めないこと（ブルーム・肌理はどちらも無音の仮値が弱すぎて実機で倍以上変わっている）。

**core 側の板は残っている。** 緑の本体に出ている平らな面と暗い切れ込みは core のもので、
今回は膜だけを直した。core も同じ `vectorField` を使うので原因は同じはずだが、
core の形は作品そのものなので、平滑化すると造形が変わる。手を付けるなら合意が要る。

### 2026-08-11 表示専用メッシュを入れた（[P2] の (2) 解像度側）。**変形計算は増やしていない**

ユーザーの指示は「(2)、(1) の順」。**(2)（解像度不足で輪郭が直線分になる）を実装した。**

**効く理屈**: 最終位置は `base + 法線方向スカラー + ベクトル変位` を `applyGlobalForm` に
通したもので、**球面方向ごとの滑らかな3次元変位場**になっている。
ならば低解像度メッシュで変位場を計算し、高解像度メッシュへ重心座標で補間すればよい。

- `src/display-mesh.ts`（新規）: 表示頂点を低解像度メッシュの三角形へ束ねる
  （初期化時に1回）。毎フレームは変位の補間だけで、1頂点あたり乗算9回・加算6回。
- **補間するのは「変位」であって位置ではない。** 位置を補間すると高解像度の頂点が
  低解像度の三角形の平面へ吸い寄せられ、直したかった多角形がそのまま残る。
- `SCULPTURE_DISPLAY_DETAIL` = 20（変形用は `SCULPTURE_SPHERE_DETAIL` = 10 のまま）。
  三角形は 2,420 → 8,820。core と膜の**両方**に入れた。
- 描画するメッシュ（`core` / `innerCore` / `surface`）を表示ジオメトリへ差し替え、
  `color` / `aPierce` も同じ重みで補間する。肌理の `aClayDir` は
  **表示メッシュ側へ付ける**（シェーダが読むのは描画に使うメッシュの attribute）。
- 同期は `syncDisplayGeometry()` を3箇所から呼ぶ（通常の更新 / 形を凍結中の更新 / リセット直後）。
  **リセット直後を忘れると前の形が残る。**

**分割を足す・法線を混ぜる系の再試行ではない。** 変形用メッシュは detail 10 のままで、
per-vertex の変形計算は1頂点も増えていない。ユーザーが却下したのはそちらの方針。

実測: `npx tsc --noEmit` / `npm run build` 通過、console error 0件。
Fury / I'm Yours の完成形で、**膜のシートの縁が直線分から曲線になった**。
比較画像 `docs/vita-progress/display-mesh-zoom.png`。

**待機状態では差が出ない。** 変形が浅く元々ファセットが見えないため。
A/B を撮るなら**変形の深い状態**（曲を聴かせた後）で見ること。ここで一度無駄撃ちした。

**実機のフレームレートはユーザーが確認済み: 60.0fps（GPU raster on / GPU memory 7.2MB）。**
「見た目に大きな問題は見受けられない」。detail 20 のコストは問題にならなかった。
重くなったときは `SCULPTURE_DISPLAY_DETAIL` を 16 や 14 へ下げるだけで調整できる。

### 2026-08-11 シルエットの多角形っぽさを拡大して見た。**主因は core ではなく膜**

2026-08-11、ユーザーが volume を中断して「vita を満足するものに」と方針転換した。
不満点の指定は**「質感・輪郭の粗さ」**（造形の種類ではない）。
そこでワークリスト [P2] に着手する前に、輪郭の実物を確かめた。

コードは触っていない。分かったことだけ。

**測り方**: `complete_ab.js` で I'm Yours を60秒聴かせて Complete、
`crop_zoom.js`（今回追加）で輪郭を4倍に拡大。
画像 `docs/vita-progress/silhouette-zoom.png`。

- **外側の輪郭を作っているのは膜（`surfaceGeometry`、半径 1.46）** であって core ではない。
  多角形っぽく見えているのは膜の縁。
- **膜は自己交差した平面シートの集まりになっている。** 半透明の板が何枚も重なり、
  長い直線と鋭い角がそのまま輪郭に出ている。
  **これは三角形が足りないから出ている角ではないので、
  「表示専用メッシュを高解像度にする」だけでは消えない。**
  ワークリスト [P2] の前提（＝解像度不足）は、少なくとも膜については当たっていない。
- core（内側の塊）にも平らな面は出ているが、輪郭への寄与は膜より小さい。

**したがって [P2] は2つの別問題に分かれる**:

1. 膜が自己交差して板の縁が立つ（解像度と無関係）
2. メッシュの解像度が足りず、輪郭が直線分になる（表示専用メッシュの案が効くのはこちら）

どちらから直すかはユーザー判断待ち。

### 2026-08-11 **`src/s04.wav` は見た目の判断に使ってはいけない**

同じ手順で `s04.wav` と実曲（I'm Yours）を並べたところ、**まったく別の形になった。**

- `s04.wav`: 割れたガラス片のような、大きな平面が突き刺さった塊。
- I'm Yours: 丸みのある塊に膜がかぶさった、記録どおりの見た目。

`s04.wav` は極端な信号で、変形が振り切れる。**見た目の判断には実曲を使うこと。**

**2026-08-11 に音源を全曲 WAV へ置き換えた**ので、もう変換は要らない。
原曲は `music-original/` にアーカイブしてあり、`src/music/*.wav` が Dev Audio に並ぶ。
WAV は合計 435MB あるので `.gitignore` に入れてある（原曲から再生成できるため）。
再生成が要るときは:

```sh
for f in music-original/*; do b=$(basename "$f"); \
  afconvert -f WAVE -d LEI16@44100 "$f" "src/music/${b%.*}.wav"; done
```

### 2026-08-10 膜のフレネルを物理ベースへ寄せた → **2026-08-11 に撤去（ユーザーが旧近似を選択）**

**いまコードには残っていない。** 実装 → 実機比較 → 却下 → 撤去、まで終わっている。
以下は「やり直すときに同じ手順を踏めるように」残した記録。
撤去したのはシェーダの `fresnelSchlick` / uniform `uFresnelPhysical` /
定数 `DEFAULT_MEMBRANE_FRESNEL_PHYSICAL` / dev パネル `#fresnel-panel` /
`sculpture-tuning.ts` の第7引数 / `fresnel_panel_check.js`。

ユーザーが物理ベース化を承認したので実装した。旧値 `pow(1.0 - NdotV, 1.45)` は
物理式ではなく「リムと正面の差を小さくして、回転で色味が飛びにくくする」ために
選ばれていた値で、承認の意味は**その狙いを捨てて物理側を取る**ということ。

- `src/main.ts` の膜フラグメントシェーダに `fresnelSchlick`（F0 0.028・指数5）を追加し、
  旧近似との mix を uniform `uFresnelPhysical` で制御する。
  既定 `DEFAULT_MEMBRANE_FRESNEL_PHYSICAL` = **1**（＝完全に物理ベース）。
- **他スタイルの膜は 0 のまま。** 膜シェーダーは classic 系スタイルで共有されているので、
  ここを全体に効かせると metamorphosis などの見た目まで変わる。
  uniform の初期値をスタイルで出し分けている。
- dev パネル `#fresnel-panel`（物理度 0〜1 / 旧近似⇔物理ベースのトグル / 既定に戻す）。
- `src/sculpture-tuning.ts`: コピー用テキストに現在値を含める（第7引数）。

実測（当時の `fresnel_panel_check.js`。撤去済みなので再測するなら書き直しが要る。
無音・同一ロード内・canvas のみ）:

| 物理度 | 半径方向の平均輝度（中心→リム） | リム/中心 | 本体平均 |
|---|---|---|---|
| 0（旧近似） | 80.7 / 75.7 / 96.4 / 96.4 / 96.4 | 1.195 | 91.56 |
| 0.5 | 81.1 / 76.3 / 96.0 / 96.3 / 96.0 | 1.183 | 91.57 |
| 1（Schlick） | 81.5 / 76.8 / 95.5 / 96.2 / 95.6 | 1.173 | 91.55 |

**リムが明るくなるのではなく、中間角が暗くなる**方向で差が付く。
本体平均はほぼ不変（膜だけが変わり、画面全体は明るくも暗くもならない）。

配線が生きていることの確認: 物理度 0 → 1 で**暗くなった画素 20.58%**
（ノイズ床 3.66%）・明るくなった画素 1.57%（ノイズ床 4.00%）。片側だけが大きく動くので、
「膜が薄すぎて出ていないだけ」ではなく実際に効いている。

回転の影響（ドラッグで12回まわして本体平均輝度のばらつきを測定）:
標準偏差 0.42 → 0.54、最大-最小 1.49 → 1.86。
**旧値が防いでいた「回転で色味が飛ぶ」は確かに悪化する。** ただし無音では 2/255 程度。

比較画像: `docs/vita-progress/fresnel-compare.png`。

**結果: ユーザーが実機で比べて旧近似（物理度 0）を選んだ。** 無音では膜の不透明度が
0.1 までしか上がらないので差が小さく、再生中は不透明度が 0.46 まで、真珠の艶の係数
（`0.75 + uHigh * 0.95` と `idleDim`）も約5倍まで上がるため、
同じ変更が**無音の 20 倍程度**の大きさで出る——という前提で見てもらった上での判断。

### 2026-08-10 粘土の肌理（シェーダ側の法線摂動）を追加。幾何は一切割っていない

ワークリスト [P2]「粘土のポリゴン感を根源から見直す」に残っていた2案のうち、
**「シェーダ側で法線を摂動させる（幾何を割らずに表面ディテールを出す）」**を実装した。
頂点分割・法線平滑はユーザーが却下済みなので触っていない（5章・7章）。

変更したファイル:

- `src/clay-grain.ts`（新規）: 手続きノイズ（value noise・3オクターブ）の高さ場を
  フラグメントで評価し、Mikkelsen の "Bump Mapping Unparametrized Surfaces" と同じ式で
  法線を摂動させる GLSL 片と uniform。three.js の `bumpmap_pars_fragment` は
  `bumpMap` テクスチャが無いとコンパイルされないので自前で持っている。
  **1画素あたりノイズ評価は1回**（勾配は `dFdx` / `dFdy`）。
- `src/main.ts`: `installCorePierceShader`（vita の core だけが通る）へ注入。
  `customProgramCacheKey` を v10 → v13 に更新。肌理のドメインは
  **変形前の球面方向を静的 attribute `aClayDir`** として持たせる
  （変形後の `position` を使うと、成長・呼吸のたびに肌理が表面を泳ぐ）。
- `index.html` / `src/styles.scss` / `src/main.ts`: dev パネル `#grain-panel`
  （strength 0〜2 / scale 4〜80 / ON・OFF / 既定に戻す）。ブルーム・映り込みと同じ枠。
  ON/OFF は uniform を 0 にするだけなので**シェーダーの再コンパイルが起きない**。
- `src/sculpture-tuning.ts`: コピー用テキストに肌理の現在値を含める（第6引数）。

実測（`docs/aether-progress/tools/grain_panel_check.js`、無音・同一ロード内・UI を隠して canvas のみ）。
**平均輝度では測れない**（肌理は明るさを足す機能ではない）ので、中央50%の
**勾配エネルギー**（隣接画素の輝度差＝肌理の量）と**大域の陰影**（16x16 で潰した後の
輝度の標準偏差＝立体感が平坦化していないか）の2つで見ている。

| strength | 肌理（勾配E） | 大域の陰影 | 白飛び |
|---|---|---|---|
| 0 | 基準 | 基準 | 0.000% |
| 0.35 | +11% | −0% | 0.000% |
| **0.55（既定）** | **+21%** | −0% | 0.000% |
| 0.9 | +39% | −1% | 0.000% |
| 1.4 | +68% | −1% | 0.000% |
| 2 | +100% | −2% | 0.000% |

ノイズ床（何も変えずに2枚）の勾配エネルギー差は 0.0286〜0.053 で、既定の効果
（+0.32 前後）はその 6〜10 倍。中央50%の平均輝度は 77.6 → 77.3/255 で、
**明るさは足していない**。`?style=aether` はパネル `hidden`・スライダー0本・
勾配エネルギー −0.1%（＝何も起きない）・console error 0件。
`npx tsc --noEmit` 通過、`npm run build` 通過。

**完成状態では既定強度の肌理がほぼ消える（測定値: ±0%、strength 1.4 で +12%）。**
待機・形成中は +21% なので、消えるのは完成状態だけ。完成すると中央50%の平均輝度が
78 → 145/255 と倍近く明るくなり、明るい面ほど法線の揺れが画素値を動かさなくなるため。
`completion.finish` の clearcoat が原因かと考えて clearcoat 側も同じ勾配で荒らす
実装を試したが**まったく効かなかった**（5章に記録）。

比較画像: `docs/vita-progress/grain-compare.png`（待機・完成 × strength 0 / 0.55 / 1.4 の6枚）。

**2026-08-10 にユーザーが OK。既定値（strength 0.55 / scale 26）のまま確定。**
実機のフレームレートの問題も、完成状態で肌理がほぼ消える点も、この時点では
指摘されていない。もし後から重い／消えるのが気になると言われたら、
「完成時だけ強度を上げる」は `completion` の ease に乗せるだけで足せる。

**シルエットは変わらない。** 輪郭の多角形っぽさはこの手法では直らない
（直すには頂点を増やすしかなく、それは却下されている）。効くのは陰影だけ。

### 2026-08-10 暗い自作の環境マップ（映り込み）を追加。RoomEnvironment ではない

**`scene.environment` は使っていない。`VITA.env.environmentMap` は false のまま。**
ここを取り違えると 5 章・7 章の禁止事項を踏む。今回入れたのは別物で、
彫刻の `MeshPhysicalMaterial`（core / innerCore）にだけ `envMap` を差している。

変更したファイル:

- `src/vita-environment.ts`（新規）: 手続きで等距円筒テクスチャを作り PMREM に通す。
  全天のベースは背景 0x082838 とほぼ同じ暗さ（＝環境光として明るさを足さない）。
  そのうえで**小さく高輝度なハイライトを2つだけ**置く。
  ハイライトの輝度が 1 を大きく超えている（2.6〜5.8）のは意図的。
  vita の粘土は roughness 0.78〜0.92 とほぼマットなので、輝度 1 前後の環境では
  スペキュラのローブが広すぎて「映り込み」にならず、ただの環境光になる。
  **最初その値（0.4 前後）で作って、実際に「全体が少し明るくなるだけ」になった。**
- `src/visual-style.ts`: `VisualStyleEnv` に `abyssEnvironment` / `envMapIntensity` を追加。
  値を入れたのは VITA のみ（`abyssEnvironment: true`）。
- `src/main.ts`: 彫刻生成後に `applyAbyssEnvironment()`。`sculpture.group` を traverse して
  `envMapIntensity` を持つマテリアルにだけ `envMap` / `envMapIntensity` を設定する
  （膜の ShaderMaterial・粒子の PointsMaterial は対象外）。dev パネル `initEnvPanel()` も追加。
- `index.html` / `src/styles.scss`: `#env-panel`（既定 `hidden`）。ブルームのパネルに相乗り。
- `src/sculpture-tuning.ts`: コピー用テキストに映り込みの現在値を含める（第5引数）。

実測（`docs/aether-progress/tools/env_panel_check.js`、無音・同一ロード内・UI を隠して canvas のみ）:

| 状態 | ON/OFF の差 | 変化画素 | 白飛び ON / OFF |
|---|---|---|---|
| 待機 | 最大 +146/255・平均 +1.70/255（ノイズ床 +0.25） | +6/255 超が 15.79%、暗くなった側は 0.40% | 0.000% / 0.000% |
| 完成 | 平均 +1.50/255（5回交互測定で5回とも同符号） | — | 0.000% / 0.000% |

intensity を上限 1.5 にしても白飛びは 0.000%。`?style=aether` はパネル `hidden`・
スライダー0本・console error 0件。`npx tsc --noEmit` 通過、`npm run build` 通過。

**2026-08-10 にユーザーが OK。intensity 0.55 で確定**し、
`VITA.env.envMapIntensity` へ焼き込み済み。比較画像 `docs/vita-progress/env-compare.png`。

### 2026-08-10 ブルームの既定値を実機で確定（0.9 / 0.6 → 0.7 / 2.4）

**ユーザーが dev パネルで曲を鳴らしながら決めた値**を `src/bloom-pass.ts` の
`DEFAULT_BLOOM_THRESHOLD` = **0.7** / `DEFAULT_BLOOM_STRENGTH` = **2.4** へ焼き込んだ。
`bloom-pass.ts` 以外は無変更。

**strength が仮値の4倍になった**のが要点。仮値 0.6 は無音のスクリーンショットだけを
根拠に置いたもので、滲みの本来の対象（再生中のヒット時の粒子・膜のきらめき）が
出ていない状態で見ていたため弱すぎた。threshold も 0.9 → 0.7 へ下げ、拾う範囲を広げている。

**この2つを無音の見た目を根拠に動かさないこと。** 無音で見ると強く見えるが、
それは判断材料として無効だと今回の経緯が示している。

新既定値での実測（canvas のみ・UI を隠して測定。`bloom_panel_check.js`）:

| 状態 | ON/OFF の最大増分 | 明るくなった画素 | 白飛び ON / OFF |
|---|---|---|---|
| 待機 | +163/255 | 0.51% | 0.000% / 0.000% |
| 完成（`#complete-sculpture`） | +149/255 | 0.48% | 0.000% / 0.000% |

白飛びは ON / OFF とも 0.000% で、strength を4倍にしても**無音では**飽和画素は増えていない。
`npx tsc --noEmit` 通過、console error 0件。

### 2026-08-10 dev チューニングパネルにブルームの threshold / strength スライダーを追加

無音では強度を判断できない（対象が再生中のヒット時の粒子・きらめき）ため、
**曲を鳴らしながら同一ロード内で追い込める口**を作った。8章の1番の前提条件。

変更したファイル:

- `src/bloom-pass.ts`: `DEFAULT_BLOOM_THRESHOLD` (0.9) / `DEFAULT_BLOOM_STRENGTH` (0.6) を
  export し、`threshold` / `strength` の getter/setter を追加（uniform を直接書く）。
  **パネルで決めた値はこの2定数へ焼き込む。**
- `index.html`: `#bloom-panel`（既定 `hidden`）。光源パネルと同じ `daytime-preview` の枠。
- `src/main.ts`: `initBloomPanel()`。`devSurface && bloomPass` のときだけ `hidden` を外す
  （bloomPass は vita でしか生成されないので、他スタイルではパネルごと出ない）。
  ON/OFF ボタンと「既定に戻す」も付けた。ON/OFF は**同一ロード内で A/B を取るため**
  （シードがロードごとに変わる問題を避ける。6章参照）。
- `src/sculpture-tuning.ts`: `formatSculptureTuningForAgent` に第4引数 `bloom` を追加。
  コピー用テキストにブルームの現在値が入るので、追い込んだ結果をそのまま渡せる。
- `src/styles.scss`: `.bloom-panel` / `.bloom-sliders` を既存の光源パネルの規則へ相乗り。

スライダーの範囲（実測に基づく）: threshold `0.2〜1.2` step 0.01 ／ strength `0〜3` step 0.02。
threshold は 1.0 を超えるとほぼ何も拾わない（1.15 で 0.042%）ので上限 1.2 で足りる。

**配線が生きていることの検証**（`docs/aether-progress/tools/bloom_panel_check.js`、無音・同一ロード内）:

| 操作 | 最大増分 | 明るくなった画素（+6/255 超） |
|---|---|---|
| strength 0 → 3（threshold 0.9） | +165/255 | 0.53% |
| threshold 0.9 → 0.2（strength 3） | +188/255 | 82.10% |

0.53% / 82.10% は 3章の実測分布（0.9 超が 1.49%、0.6 超が 50.3%）と整合する。
`?style=aether` ではパネルが `hidden` のまま・スライダー0本・console error 0件。
`npx tsc --noEmit` 通過。

**ここで測ったのは配線が効いているかだけで、強度が適切かではない。**
それは曲を鳴らさないと決められない（無音では滲みの本来の対象が出ない）。

### 2026-08-10 ブルームが一切効いていなかったバグを2件修正

`src/bloom-pass.ts` のみ変更。`main.ts` は無変更。

**バグ1: threshold がシーンの輝度レンジを超えていた**
- 既定 1.15 は「線形HDR の輝度」に対する閾値だが、vita のシーンで
  これを超える画素は **0.042%** しか無かった（実測）。事実上ブルームは常にゼロ。
- 実測分布: 0.90 超が 1.49%、0.60 超が 50.3%。
- → 既定を **0.9** に変更（「明るく振り切った部分だけ」を拾う位置）。

**バグ2: 加算合成で glow が二乗されていた**
- three.js の `AdditiveBlending` は `blendSrc = SrcAlphaFactor` なので、
  出力 rgb は alpha を掛けられてから加算される。
- 旧コードは `alpha = clamp(bloomLuma(glow) * 1.5, 0, 1)` と、alpha に glow 自身の
  輝度を入れていた。つまり寄与が glow の二乗になり、glow≈0.05 なら 0.0025 で
  1/255 未満に潰れていた。
- → `alpha` を **1.0 固定**にし、加算量は `uStrength` だけで制御する。

修正後の実測: glow を 8 倍して見ると空間分布が出る（最大増分 444/765、
3.6% の画素が変化）ので、パスは正しく出力している。
等倍・無音では滲みは控えめ。白飛びは 0.004%（待機）/ 0.002%（完成）で問題なし。

**この2件は無音のスクリーンショットを眺めるだけでは絶対に見つからない。**
「効いていないのか、弱いだけなのか」を切り分けるには、閾値を極端に下げて
差が出るかを見る／glow を増幅して空間分布を見る、という診断が要る。

### 2026-08-09 aether 側の作業に伴う無回帰確認のみ
- vita のコードは変更していない。
- aether の作業中に `visual-style.ts` を触ったため、VITA 設定の無回帰を確認した
  （stars: true / opacityScale 1.45 / environmentMap: false / background 0x082838）。
- 実際に描画して深海背景・星・膜の煌めきが健在、コンソールエラー0件を確認。

## 4. 未解決の問題・エラー

エラーは無い。**2026-08-10 にユーザーが3件（映り込み・肌理・完成フェーズ質感）へ OK を出し、
値はすべて焼き込み済み。2026-08-11 に曲の色の幅も OK。** 残っているのは以下。

- 粘土のポリゴン感のうち、**シルエット（輪郭の多角形っぽさ）は未解決のまま**。
  肌理は陰影にしか効かない。頂点数を増やせない制約は変わっておらず、
  CPU の per-vertex 変形が頂点予算を縛っているのが原因で、分割数の問題ではない。
  **2026-08-11 に拡大して見たところ、輪郭を作っているのは core ではなく膜で、
  膜は自己交差した平面シートの集まりだった**（3章）。
  「表示専用メッシュを高解像度にする」案が効くのは解像度側だけで、
  膜の板の縁は別問題。**どちらから直すかユーザー判断待ち。**
- **完成状態では肌理がほぼ消える**（完成すると面が明るくなりすぎるため。詳細は3章）。
  ユーザーは既定値に OK を出しているので、いま直す必要は無い。
- 粒子の立体感: **2026-08-12 に球インポスターを実装しユーザー OK 済み**
  （丸ビルボード → 陰影付き小球。3章）。
- **実機のフレームレートは 2026-08-11 に初めて測れた: 60.0fps**
  （表示専用メッシュ detail 20 を入れた状態。GPU raster on / GPU memory 7.2MB / max 536.9MB）。
  肌理も含めた現状の構成で 60fps 出ている。
  headless（swiftshader）では相変わらず測れないので、実機で聞くこと。

## 5. すでに試して失敗したこと（繰り返さないこと）

### 2026-08-13〜17 熟成度（[P1]）で踏んだ罠。**全部もう一度踏みやすい**

- **`formDevelopment` を熟成度に使う** → 使えない。序盤の球を守るゲートなので
  **曲の 3〜16% で 1.0 に張り付く**（9 曲実測。Donna Lee だけ 38%）。
- **正規化の目的関数を「終端値」にする** → **曲の 2% で 0.75 に跳ね上がる解が「最良」になる。**
  「徐々に」を測りたいなら目的関数は**進行度との差**（`maturity_fit.js` はそうしてある）。
- **`completion_gap_stats.js` を形成 60 秒で回して「効いていない」と判断する** → 誤り。
  その時点の熟成度がまだ 0.44 だから。**曲を最後まで聴かせてから測る**（第2引数 0）。
- **`maturity_sweep.js` で固定掃引を先にやる** → 掃引中に曲が終わって自動完成し、
  auto が done と同じ状態になる。**auto を先に撮る**／待つのは進行度 0.80 まで。
- **`applyCompletionFinish` で `Math.max(m.clearcoat, …)` の形にして下限を作る** → 暴走。
  同関数の宝石ぶんが**毎フレーム加算**されて clearcoat が 1・roughness が 0 へ寄る。
  正しくは `blend = max(ease, 熟成度)` を係数として使い、代入は 1 回にする。
- **膜の「地」を係数で減らす（`matureGround = 1 - 熟成度*0.55`）** → **完成後も効いて
  完成側のグローを 55% 弱める回帰になった**（8/13 に入れ 8/17 に撤去）。
  完成後の膜は消えるのではなく `0.45 + 呼吸*0.6` の**呼吸グローに変わる**ので、
  減らすのではなく**その値へ寄せる**（`getMembraneLiveTarget` / `GlowTarget` を
  地と出来事に分割して地だけ lerp）。
- **`complete()` で `breathTime` / `breathWave` をリセットする** → 形成中から同位相の
  呼吸を回している以上、完成の瞬間に位相が飛ぶ。**リセットしない。**
- **完成フラグを `advanceSculptureSimulation` の中で拾う** → 完成後はそこを通らないので
  検出できない（プローブが 12 分の上限まで回った）。**`render()` 側で拾う。**
- **「蓄積量だけ」で 9 曲すべてに軌跡を出す** → 実測で不可能。蓄積量の終端値が曲間で
  2.6 倍ちがうので、固定の正規化では「静かな曲が届かない（終端 0.68）」か
  「激しい曲が序盤で天井」のどちらかになる。**進行度を混ぜるしかない**（ユーザー判断済み）。
- **`max(蓄積, 進行度)` で駆動する** → Fury が曲の 45% で天井に張り付いて後半が平ら。
  **平均にする**（8/17 変更済み）。

- **膜のフレネルを物理ベース（Schlick・指数5 / F0 0.028）へ寄せる**
  → 実装してユーザーが実機で比べた結果、**旧近似が選ばれた**（2026-08-10）。
  実装前の合意は「やる」だったが、実際に見たら旧近似のほうが良いという判断。
  **2026-08-11 に撤去済み**（シェーダ・uniform・dev パネル・`fresnel_panel_check.js`）。
  無音の実測ではリム/中心 1.195 → 1.173、暗くなった画素 20.58%（ノイズ床 3.66%）で、
  配線は効いていた。差が小さく見えたのは無音では膜の不透明度が 0.1 までしか
  上がらないためで、再生中は約20倍の大きさで出る。
  **やり直すなら同じ実装を書き直すことになる。効果の測り方は上の数値を再現すればよい。**
- **無音のスクリーンショットを根拠に強度の既定値を置く** → 3回とも弱すぎた。
  ブルーム strength 0.6 → 実機 2.08（3.5倍）、肌理 strength 0.55 → 実機 1.11（2倍）、
  肌理 scale 26 → 実機 55（2倍）、映り込み 0.55 → 実機 0.74。
  **例外なく、無音で置いた仮値は弱い側に外れる。** 仮値は必ず「実機で決める前提」と
  書いて出し、無音の見た目で確定させない。

- **完成状態で肌理を出すために clearcoat の法線も荒らす** → `clearcoatNormal` を
  同じ勾配で（下地の 0.45 倍で）摂動させたが、完成状態の勾配エネルギーは strength 2 で
  **+29%** と、入れる前と**まったく同じ**だった。実装ごと外した。
  完成時に肌理が消えるのは clearcoat のせいではなく、
  **完成すると面が明るくなりすぎる**（中央50%の平均輝度 78 → 145/255）ため。
  明るい面ほど法線の揺れが画素値を動かさない。次に手を入れるならここを狙う
  （完成時だけ強度を上げる／完成時の明るさ自体を見直す）。
- **肌理のドメインに変形後の `position` を使う** → 成長・呼吸で頂点が動くたびに
  肌理が表面を泳ぐ。変形前の球面方向（`aClayDir`）を静的 attribute で持つこと。

- **`VITA.env.environmentMap` を `true` にする** → RoomEnvironment は明るいニュートラルな
  「部屋」で、vita の clearcoat/sheen がこれを強く反射し、暗く沈んだ配色が白く洗われる。
  「ブルームのせいで霞む」と誤診した原因でもある。**絶対に戻さない。**
- **輝度が 1 前後の環境マップで「映り込み」を出そうとする** → vita の粘土は
  roughness 0.78〜0.92 とほぼマットで、スペキュラのローブが非常に広い。
  そのため輝度 1 前後の環境は映り込みにならず、**全体がわずかに明るくなるだけ**になる
  （2026-08-10 に実際にそう作って作り直した）。ハイライトは立体角を小さく・
  輝度を 1 より大きく（現在 2.6〜5.8）取ること。全天の平均を上げてはいけない。
- **EffectComposer + UnrealBloomPass** → `renderer.toneMapping`（ACES）/ `outputColorSpace`
  まわりで二重適用が起き、画面全体が白っぽく霞む。撤回済み。
  自前の `bloom-pass.ts` はこのリスクを構造的に避けている。
- **geodesic / 分割密度を上げる / 法線平滑を混ぜる** → カクカクになり重くなった。
  ユーザーが明確に却下。**再試行しない。**
- **vita の見た目を参考画像へ寄せる**（スペキュラ除去・暖寒2極・glitter 全廃など）
  → ユーザーから「改善前の方が良かった」「星は消さないで」「膜の煌めきは残したい」
  「天気・時間・音楽性による色変化が無くなった」と却下。すべて revert 済みで、
  **その revert 後の状態が正**。

## 6. 有効だった検証方法

- 撮影スクリプト: `docs/aether-progress/tools/vita_shot.js`
  （第4引数に 1 を渡すと `#complete-sculpture` を押してから撮る＝完成状態が出せる）。
  `node vita_shot.js out.png "http://localhost:5173/?style=vita" 8000 1`
- **演奏中**の撮影: `docs/aether-progress/tools/particle_shot.js`（2026-08-12 追加）。
  `#start-dev-audio`→曲選択→`#begin-recording` で N 秒だけ形成して撮る（完成しない）。
  `node particle_shot.js out.png "http://localhost:5173/?style=vita" Fury 40`。
  粒（particles）は演奏中しか見えない（完成で約0.5秒フェード）ので、粒まわりはこれで撮る。
- **シードはロードごとにランダム**なので、別々に起動した2枚は形自体が違う。
  A/B を取るときは**同一ロード内で切り替える**こと
  （例: ブルームなら `bloomPass.enabled` や uniform を一時的に window へ露出させる）。
  それでも星の瞬きで 120ms 程度の差は出るため、**面積の狭い効果を
  「画像全体の平均差」で測ってはいけない**（今回これで判断を誤りかけた）。
  最大増分・変化画素の割合で見るか、効果成分だけを増幅して見る。
- fps: `docs/aether-progress/tools/fps.js`（aether と vita を続けて測る）
- 映り込みの確認: `docs/aether-progress/tools/env_panel_check.js`
  （ノイズ床 → ON/OFF → スライダー配線 → ON/OFF を5回交互に測った平均、の順に出す）。
  **完成後は呼吸で動くためノイズ床が平均輝度差 1.2/255 前後あり、1組の A/B では
  既定値の効果（1.5/255）が埋もれる。** 交互測定の対の差で見ること。
- 比較画像を作る: `docs/aether-progress/tools/compose.js`
  （見出し付きで並べた1枚を出力する。ImageMagick は入れていない）。
- 宝石マテリアルの確認: `docs/aether-progress/tools/mineral_facet_sweep.js`（軸掃引・形も動く）／
  **`gem_material_ab.js`（2026-08-12 追加。軸=1 固定で幾何を凍結し宝石強度だけ 0/2 に振る＝材質だけの差）。**
  どちらも headless は艶が鈍る。強度確定は実機で。
- 肌理の確認: `docs/aether-progress/tools/grain_panel_check.js` ／
  等倍の切り出し: `grain_sweep_shot.js`。
  **肌理は平均輝度では測れない。** 中央50%の勾配エネルギー（隣接画素の輝度差＝肌理の量）と
  大域の陰影（16x16 で潰した後の標準偏差＝立体感が平坦化していないか）の2本立てで見る。
  比較画像を作るときは**必ず等倍で切り出す**こと。900x900 を 520px セルへ縮小すると
  肌理は消えて「差が無い」と誤読する。
- **測定中はリポジトリ内のファイルを書き換えない。** Vite の watcher がページを
  リロードし、隠した UI が再表示されて数字が壊れる（実際に壊れた）。
  `grain_panel_check.js` は末尾に「測定中のリロード回数」を出す。1 でなければ測り直す。
- **フレーム時間は headless（swiftshader）では測れない。** ON/OFF を3組取っても
  符号が run ごとに逆転する。GPU コストの判断は実機でユーザーに見てもらうしかない。
- ブルームの配線確認: `docs/aether-progress/tools/bloom_panel_check.js`
  （dev パネルのスライダーを同一ロード内で振って、最大増分と明るくなった画素の割合を出す。
  「スライダーは付いたが uniform に届いていない」を無音でも検出できる。
  **強度が適切かは測れない**——それは曲を鳴らして目で決める）。
- **`docs/aether-progress/tools/` のスクリプトは 2026-08-10 まで実行できなくなっていた。**
  ルートの `package.json` が `"type": "module"` なのに中身が CommonJS（`require`）のため。
  同ディレクトリに `package.json`（`"type": "commonjs"`）を置いて直した。
  新しいツールを足すときはこのディレクトリに置けば `require` のままでよい。
- **再生中に検証すること。** 待機状態だけ見て「直った」と報告して過去に3回外している。
  headless では Chrome for Testing に proprietary codec が無く m4a / mp3 を再生できないので、
  実機確認が要る場合はユーザーに依頼する。
- **熟成度（[P1]）の道具4本**（2026-08-13〜17 追加。使い方は tools の README にも書いた）:
  - `maturity_probe.js <out> [曲...]` — 9 曲を**最後まで**流して熟成度・蓄積量の時系列。
    絵は撮らない。全曲で約 45 分。**逐次でしか測れない。**
  - `maturity_fit.js <out> [指標]` — その記録から正規化を総当たり。
    **目的関数は「進行度との差」**（終端値だけにすると序盤で跳ねる解が最良になる）。
  - `maturity_sweep.js <out> 0 <曲> 4` — 曲末で自動値 → 固定掃引 0/0.3/0.6/0.9 → 完成。
    **第2引数 0 が「最後まで聴いてから」。auto を先に撮る順序になっている。**
  - `completion_gap_stats.js <out> 0 <曲> 5` — LIVE 最終 / 完成+2秒 / 完成+11秒 の
    稜・鏡面 / 白い薄膜 / 輝度 / 彩度 / 局所コントラスト / 面積。**飛び幅の判定はこれ。**
- **「稜・鏡面（L>0.80 の面積）」は LIVE では乳白の膜も拾う。** 膜が薄くなると
  この指標は下がる。宝石の量そのものの指標ではないので、必ず画像も並べて見ること。

## 7. 絶対にやってはいけないこと

- `VITA.env.environmentMap` を `true` に戻す（画面が白飛びする真因）。
  `abyssEnvironment`（暗い自作環境）は別物で、こちらは `scene.environment` に入れず
  彫刻のマテリアルにだけ差している。**この2つを混同して、自作環境を
  `scene.environment` へ移さない。** 背景ドーム・床まで明るくなる。
- 星・膜の煌めき・`opacityScale 1.45` を消す。
- 天気 / 時間 / 音楽性による色変化を殺す。過去にこれで怒られている。
- vita メッシュを参考画像の見た目へ寄せる作業を再開する（打ち切り済み）。
- 頂点分割・法線平滑を増やす方向の再試行。
- ユーザーの確認待ち項目を、承認前に上書きする変更。
- **ユーザーが OK を出した値を、無音の見た目を根拠に動かすこと。**
  確定済み（焼き込み値は 2章・ソースを正とする）:
  ブルーム / 映り込み / 肌理 / 完成フェーズ質感 / 曲の色の幅 0.4・0.55 /
  **混色 spread 0.28・balance -0.1 / 膜relax iterations 1・strength 0.5**。
- **`DEFAULT_BLOOM_THRESHOLD` / `DEFAULT_BLOOM_STRENGTH` を、無音の見た目を根拠に変えること。**
  この2つはユーザーが曲を鳴らして決めた値。無音では滲みの対象が出ないので
  「強すぎる」と見えても、それは判断材料にならない（仮値 0.6 が弱すぎた原因がまさにこれ）。
- **熟成度（[P1]）で「完成側の見た目」を弱めること。** 完成は到達点で、寄せるのは LIVE 側だけ。
  8/13 に膜の地で一度これをやって回帰になっている（5章）。
- **熟成度で打点の反応を弱めること**（キック→パルス / 中音→膜のライン・glint /
  高域→粒子のチラつき）。原則「リアルタイム性は完成形と同格」。
  熟成度で動かすのは**地**（常時出ている質感・不透明度・グロー・彩度・環境）だけ。
- **熟成度の 4 定数を 1 曲や無音で動かすこと。** 9 曲を最後まで流した実測で決めた値
  （`MATURITY_LIVE_CEILING` 0.9 / `MATURITY_K0` 0.65 / `MATURITY_LOUD_GAIN` 1.5 /
  `MATURITY_POWER` 1.7）。動かすなら `maturity_probe.js` → `maturity_fit.js` を回し直す。
- **`window.__maturity` / `#maturity-panel` / `window.__mineralAxis` / `#mineral-panel` を消すこと。**
  熟成度も音色軸も**見えないと強度を決められない**（過去にそれで何度も外している）。

## 8. 次にやること

**2026-08-17 時点。上から順に。1〜3 はどれもユーザーが実機で見る作業なので、
コードを触る前にまず見てもらうこと。**
**dev サーバーはセッション終了で落ちている。ユーザーに `! npm run dev` を打ってもらう。**

**2026-08-17 追記（ユーザー指摘・worklist Open 最上段）:**
鉱物感の課題を優先度順に記録した。
(1) 完了瞬間に急に鉱物化 (2) LIVE で鉱物感が出ない (3) 完了時が強過ぎ
(4) 鉄・アルミっぽい／クリスタル透明感・六角柱は後回し可。
**(1)(2) は熟成度 [P1] と同一。二重実装しない。**
**(3) は「完成を弱めるな」合意と衝突 → 方針合意が必要。**
**(4) は第3版の「地を暗くする」と反対方向になり得る → 別チャンネル検討。**

1. **【最優先】Fury 10秒 Complete の鉱物段差を直す。**
   実機で未達確認済み。熟成度の値を下げない。
   先に10秒時点の `window.__mineralAxis` / `window.__maturity` / 結晶面数を記録。
   `axis × maturity` の二重ゲートを分離し、Complete を
   **「押した時点の maturity → 1」**の補間へ直す。修正後も同じ10秒条件で比較。
2. **熟成度の残差＝「稜・鏡面が完成でだけ強く光る」1 点を寄せるか決めてもらう。**
   担い手は幾何の焼き込みと凍結（3章の表）。寄せるなら
   **焼き込みを「読み出し時のコントラスト」へ作り替える改修**が必要
   （現実装は `vectorField` を直接書き換えるので、そのまま LIVE で先取りすると蓄積が壊れる）。
3. **完了時の鉱物が強過ぎる件（指摘 #3）の方針を決めてもらう。**
   完成到達点を下げる／LIVE 寄せだけで再評価／宝石だけ別上限、のどれか。
   合意前に完成側を係数で弱めない。
4. **宝石マテリアルの強度を実機で確定**（worklist [P2]）。`#mineral-panel` の
   「宝石強度 / 結晶面の地の暗さ / 稜 / 面の閃き / 透過 / 分散」を曲を鳴らして追い込み →
   `gem-material.ts` の `DEFAULT_GEM_*` へ焼き込む。**パネル上部の軸を先に確認する。**
   Fury（軸 1.0）/ ロビンソン（0.46）/ I'm Yours（0.0）で並べ比較。
   **注意: 熟成度が入ったので、結晶になる面の枚数は `軸 × 熟成度`。**
   曲の序盤では枚数が少ないのが正常。**曲を進めてから強度を決めること。**
   金属寄りが強過ぎないかも一緒に見る（指摘 #3・#4）。
5. **クリスタル透明感（指摘 #4 の材質側）を別項目にするか決めてもらう。**
   六角柱・六角錐の生成は後回しでよい（ユーザー明示）。
6. **膜の色合い・模様（案A）を実機で確認してもらう。**
   比較 `docs/vita-progress/membrane-pearl-compare.png`。
7. **core 側の板に手を入れるか決めてもらう**（worklist [P2]）。着手はユーザー合意待ち。

（[P3] 粒子の厚みは 2026-08-12 に球インポスターで実装・ユーザー OK 済み。3章参照。）

**vita の造形（トゲトゲ問題）には手を入れない方針は維持されている。**
2026-08-10 に「volume を別スタイルとして仕上げる」で決着した話で、
今回の方針転換は**質感・輪郭**の話であって造形の話ではない。
volume 側の状況は [VOLUME.md](VOLUME.md) 8章（中断中・実機確認待ちが2件）。

## 9. 新セッションで最初に読むファイル

1. [.cursor/rules/project-principles.mdc](../../.cursor/rules/project-principles.mdc) — 作品の目的と設計原則
2. このファイル
3. [../worklist/VITA.md](../worklist/VITA.md)
4. `src/visual-style.ts` の `VITA` / `src/bloom-pass.ts` / `src/vita-environment.ts` /
   `src/clay-grain.ts`
5. シルエットまわりを触るなら `src/display-mesh.ts` と、`main.ts` の
   `syncDisplayGeometry()` / `relaxMembraneFolds()` / `updateSurfaceGeometry()`
6. 熟成度（[P1]）を触るなら `main.ts` の `updateMaturity()` / `getMaturity()` /
   `updateLiveBreath()` / `updateCoreMaterial()` / `getMembraneLiveTarget()` /
   `getMembraneGlowTarget()` / `syncGemFacets()` と、`initMaturityPanel()`
7. 検証スクリプトは `docs/aether-progress/tools/`（README あり）。
   vita で使うのは `complete_ab.js` / `membrane_relax_ab.js` / `crop_zoom.js` / `compose.js`、
   熟成度は `maturity_probe.js` / `maturity_fit.js` / `maturity_sweep.js` /
   `completion_gap_stats.js`、宝石は `gem_live_vs_done.js` / `gem_live_strength_stats.js`
