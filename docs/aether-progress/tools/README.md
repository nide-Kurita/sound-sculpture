# aether の見た目を数値で判定するための道具

前セッションで scratchpad に置いて失われたので、ここに残す。
リポジトリのビルドには一切関与しない（実行するときだけ使う手動スクリプト）。

前提: `puppeteer-core`（node_modules にある）と
`~/.cache/puppeteer/chrome/...` の Chrome for Testing。Playwright は入っていない。

## **音源は全曲 WAV**（2026-08-11 に置き換え済み）

Chrome for Testing には proprietary codec が無いので **m4a / mp3 は再生できない**。
WAV は再生できる。そのため 2026-08-11 に `src/music/` を全曲 WAV へ置き換えた。

- 再生用: `src/music/*.wav`（合計 435MB。**`.gitignore` 済み**）
- 原曲のアーカイブ: `music-original/`（git 管理下）

**もう変換作業は要らない。** 再生成が必要になったときだけ:

```sh
for f in music-original/*; do b=$(basename "$f"); \
  afconvert -f WAVE -d LEI16@44100 "$f" "src/music/${b%.*}.wav"; done
```

`src/music/*.{mp3,m4a,wav,ogg,flac}` は `import.meta.glob` で自動的に Dev Audio の
カタログに載る（dev サーバー再起動は不要）。曲の終わりで**自動的に完成する**ので、
`song_run.js` が全自動で「再生 → 完成 → 3方向キャプチャ」まで回す。

**注意3つ:**

- **形態シードはファイルのバイト列から作られる**（`hashBytesToMorphologySeed`）。
  WAV 版と元の m4a / mp3 版は**同じ曲でも別の個体**になる。
  置き換え前にユーザーが m4a から撮った完成形とは、もう1対1で並ばない。
  いまは実機も headless も同じ WAV を読むので、今後撮るものどうしは揃う。
- **日本語の曲名は NFC 正規化してから照合すること。** macOS のファイル名は NFD なので、
  `"ロビンソン"` をそのまま `includes` すると一致しない（2026-08-12 に踏んだ）。
- **大きい WAV（Fury 71MB / 6:00 58MB）は fetch + decodeAudioData に数秒かかる。**
  曲を選んだ直後に録音開始を押すと何も再生されず、**全部 0 の行**になる。6 秒待つ。
- **`src/s04.wav` は見た目の判断に使わないこと。** 極端な信号で変形が振り切れ、
  実曲とはまったく別の形（割れたガラス片のような塊）になる。
  2026-08-11 にこれで一度誤った見立てをしている。実曲を使う。
- 曲の実時間ぶんかかる。4曲で約18分。スタイル違いは並列に回してよい
  （シミュレーションは音声クロック基準の固定 hop で、フレームレートに依存しない）。

パスは各スクリプトの先頭に絶対パスで書いてあるので、リポジトリを移動したら直す。

ここのスクリプトは CommonJS（`require`）で書いてある。ルートの `package.json` が
`"type": "module"` なので、そのままだと `require is not defined` で落ちる。
このディレクトリに `"type": "commonjs"` の `package.json` を置いて解決してある
（2026-08-10。それまで全スクリプトが実行できない状態だった）。**この package.json は消さない。**

## 使い方

```sh
cd docs/aether-progress/tools

# UI を隠して canvas だけ撮る（参考動画と同じ画角で比べるため）
node shot_clean.js out.png "http://localhost:5173/?style=aether" 7000

# 本体を「暗部 / 彩度のある中間帯 / 淡部」に分けた面積比。第2引数は背景色 R,G,B
# 参考動画3フレームの実測は 20.7 / 62.4 / 16.8%。これが目標値
node area.js out.png 212,232,225

# tau の CDF。先に aether-sculpture.ts のシェーダへ診断出力を仕込む（下記）
node tau_cdf.js diag.png 1.0

# fps（aether と vita）
node fps.js

# vita の dev パネルのブルームスライダーが uniform まで届いているかを確認する
# （強度が適切かは測れない。それは曲を鳴らして目で決める）
node bloom_panel_check.js "http://localhost:5173/?style=vita" 8000

# vita の映り込み（vita-environment.ts の環境マップ）の効き方を測る。
# 第3引数 1 で完成状態、第4引数を渡すと <接頭辞>-on.png / -off.png を保存する
node env_panel_check.js "http://localhost:5173/?style=vita" 9000 0 /tmp/envw

# vita の粘土の肌理（clay-grain.ts の法線摂動）の効き方を測る。
# 第3引数 1 で完成状態。strength スイープの表（肌理の量 / 大域の陰影 / 白飛び）を出す
node grain_panel_check.js "http://localhost:5173/?style=vita&surface=dev" 9000 0

# 肌理の強さを同一ロード内で振って、彫刻を等倍で切り出す（縮小すると肌理が消えるため）
# 値は "strength" か "strength@scale"
node grain_sweep_shot.js /tmp/w "http://localhost:5173/?style=vita&surface=dev" 9000 0 0 0.55 1.4

# 曲を1曲まるごと headless で通し、完成形を3方向キャプチャする（下の「WAV なら鳴る」を読む）
node song_run.js "http://localhost:5173/?style=vita&surface=dev" "曲名の一部" /tmp/out 900

# headless で本当に音が鳴っているかの確認（LOW/MID/HIGH と本体面積が動くか）
node play_probe.js "http://localhost:5173/?style=vita&surface=dev" "s04" 20

# 完成処理が形をどれだけ削っているかを短時間で測る（60秒だけ形成して Complete を押す）
# **同一 run 内で完成前後を比べる**ので、run ごとのばらつきに埋もれない。1回2分
node complete_ab.js "http://localhost:5173/?style=volume&surface=dev" "曲名の一部" /tmp/ab 60

# 曲の途中で段階的にキャプチャする（「後半に何が起きているか」を見る）
node song_stages.js "http://localhost:5173/?style=volume&surface=dev" "曲名の一部" /tmp/st 60,180,300

# 天気・時刻で本体の色が動いているかを測る（背景ドームは除外して本体画素だけ見る）
node weather_color_check.js "http://localhost:5173/?style=volume&surface=dev" 11000

# 天気・時刻の色変化を「画像で」並べる（強すぎ / 弱すぎは数では決まらないので）
# **待機で撮らない。** 待機の粒は画面の6%しか無く、並べても色が読めない。
# 60秒聴かせて Complete まで進め、形が凍った完成後に環境だけ振る。1水準あたり約2分
node env_color_grid.js /tmp/envgrid A "曲名の一部" "http://localhost:5173/?style=volume" 60

# 造形の「種類」を数える。穴の数・破片の数・輪郭の複雑度
# シルエット差の *量* ではなく *種類* の指標（xor が大きくても種類が同じなら足りない）
node topology.js out1.png out2.png ...

# 曲による色の振れ幅（本体画素の色相の円周平均と、曲間の広がり）
node hue_spread.js out1.png out2.png ...

# 既に撮ってある画像の本体画素の色相・彩度・明度を出す（水準どうしを後から数で比べる）
node png_hue.js /tmp/envgrid

# 撮った画像を見出し付きで並べた比較画像にする（見た目の報告は必ず画像で）
node compose.js out.png 2 "映り込み OFF=/tmp/envw-off.png" "映り込み ON=/tmp/envw-on.png"

# 膜の折り重なりをほどく平滑化の A/B（**同一 run 内**。完成後に値だけ動かすので形が同じ）
# 別 run どうしで比べると形が変わって比較にならない（2026-08-11 に一度失敗している）
node membrane_relax_ab.js /tmp/relaxab Fury "http://localhost:5173/?style=vita" 60

# 輪郭の一部を切り出して拡大する（シルエットの粗さは全体像では判断できない）
# 引数は <出力> <倍率> "<見出し>=<画像>#<x>,<y>,<切り出す一辺>"
node crop_zoom.js out.png 4 "左の輪郭=/tmp/a.png#150,420,180"

# 彫り込みの閃光が出ているか（一瞬なので1枚では写らない。連射して探す）
node flash_check.js /tmp/flash s04 "http://localhost:5173/?style=volume" 70 24

# 検証用キャプチャ（dev パネルの「3方向を保存」）が比較に使える画像を出すか確かめる
node capture_check.js "http://localhost:5173/?style=vita&surface=dev" 9000

# vita の音色軸（mineral）を**自動軸のまま**全曲で測る。絵は撮らない（速い）
# 軸は「結晶になる面の枚数」を決めるので、宝石の強度を触る前に必ずこれで軸を確認する
# **逐次でしか測れない**（並列にすると背景タブの rAF が止まってシミュレーションが進まない）
node mineral_axis_probe.js 110                  # 全曲を 110 秒ずつ（約 20 分）
node mineral_axis_probe.js 90 Fury "I'm Yours"  # 曲を絞る

# **再生中**の見た目を撮る（待機・無音で宝石を判断しない）。AXIS=1 で軸を固定できる
node gem_playback_shot.js /tmp/gem 110 Fury ロビンソン "I'm Yours"

# **同一個体**で LIVE（複数時刻）と完成後を撮り、軸の時系列も出す。
# 「宝石が完成時にしか出ない」を調べるとき。**別 run だと別個体になって比較にならない**
node gem_live_vs_done.js /tmp/gemlive 120 Fury

# LIVE で宝石の光学が本当に描かれているかを**平均**で測る（稜・鏡面の面積比）。
# 形が毎フレーム動くので 1 枚ずつの A/B では判定できない。宝石強度 0 → 2 → 0 で撮る
node gem_live_strength_stats.js /tmp/gemstats 55 Fury 6

# 「LIVE 最終フレーム → 完成後」の**飛び幅**を平均で測る（稜・鏡面 / 薄膜 / 輝度 / 彩度 /
# 局所コントラスト / 面積）。熟成度 maturity の作業（worklist [P1]）の before/after 判定に使う
node completion_gap_stats.js /tmp/gap 60 Fury 5

# 完成形シルエットの差（色は見ない）。同じ曲2回の差が床、別曲の差がそれを超えるか
# **vita は `auto` を渡すこと**（下の注意を読む）
node silhouette.js a.png b.png auto
node silhouette.js --matrix auto vita-air.png vita-fury.png vita-ballad.png
```

`?style=aether` の計測用 URL（`src/aether-sculpture.ts`。本番で曲を聴くときは付けない）:

- `aetherSeed=<数>` — 出発形を固定（音声ハッシュの種を上書きする）
- `aetherAccum=0..1` — 蓄積を固定して曲終盤相当を見る（黒潰れの再発確認用）
- `aetherHueLock=0` — 天気・時刻の hueShift を切る（参考フレームとの面積比を揃えるとき）
- `aetherMelt=0..1` / `aetherFlow=0..1` — LIVE の溶け・渦ドライブを固定（headless に codec が無く曲を鳴らせないときの代替）
- `aetherChroma=0..1` — 多色混ざりを固定（曲終盤相当の色素。計測・比較用）

`env_panel_check.js` は「ノイズ床（何も変えずに2枚）」を先に出す。
vita は無音でも形が動くので、**この値を超えない差は効果と言えない**。
完成後は呼吸で動きが大きく（ノイズ床が平均輝度差 1.2/255 前後）、1組の A/B では
既定値の効果が埋もれる。そのため ON/OFF を5回交互に切り替えた平均も出している
（対で測るので動きぶんが打ち消える）。

**vita のシルエットを測るときは背景に `auto` を渡す。** 2026-08-10 に実画像で初めて走らせて
分かったことだが、`8,40,56`（`VITA.env.background` の設定値）を渡すと**画面全体が本体判定になり
cover 100%＝何も測っていない状態**になる。vita の背景は単色ではなく上下グラデーションのドームで、
実測は上端 88,124,168 / 下端 48,74,104 と設定値とはまるで違う。
`auto` は画像の左右端 8px から行ごとの背景を推定するのでグラデーションでも通る
（星が本体マスクに混ざるので 3x3 の despeckle も併せて掛けている）。

**シルエットを比べる画像は、必ず dev パネルの「検証用キャプチャ」で撮る。**
再生中はカメラが `pickCameraDriftTarget()` でランダムな方角へ漂い、彫刻はドラッグで自由に回る。
普通に撮った画像を silhouette.js に渡すと、形ではなくカメラ角度の差を測ることになる。
このボタンは向きを 0°/120°/240° に固定し、カメラの漂いを打ち消し、900x900 で3枚保存する。
実測の床（同じ完成形を、間にドラッグを挟んで2回撮った差）は
**aligned xor/union 0.022〜0.027**。別の曲どうしの差がこれを十分に超えていなければ
「曲ごとに別の形」にはなっていない。

`grain_panel_check.js` は肌理用に指標が2つある。**平均輝度では測れない**（肌理は
明るさを足す機能ではない）ので、中央50%の**勾配エネルギー**（隣接画素の輝度差＝肌理の量）と
**大域の陰影**（16x16 で潰した後の輝度の標準偏差＝立体の陰影が平坦化していないか）を見る。
前者だけ上がって後者が下がるなら強すぎ。

**測定中はリポジトリ内のファイルを書き換えないこと。** Vite の watcher がページを
リロードして、隠した UI が再表示され、数字が壊れる（実際に壊れた）。
`grain_panel_check.js` は末尾に「測定中のリロード回数」を出すので、1 でなければ測り直す。

**別々の run で撮った数値を直接比べないこと。**（2026-08-11 に判明）
同じコード・同じ WAV（＝同じ形態シード）で曲を最後まで通しても、
volume の完成時の複雑度が **10.56 と 7.92** の2つの値を取った（差 26%）。
形成中の値も 11.28 と 12.13 でばらつく。
比べるなら **同一 run 内の対**（`complete_ab.js` の形成中 → 完成の比など）にするか、
同じ条件を複数回測って平均を取る。この注意を立てる前に書いた
「別 run どうしの数値比較」は、方向は合っていても細かい差の根拠にはならない。

**フレーム時間は swiftshader では測れない。** ON/OFF を3組取っても符号が run ごとに
逆転する。肌理は毎画素 fbm を回すので実機では確実にコストがあるが、
その大きさはユーザーの GPU でしか分からない。

## tau の CDF を測るときの診断コード

`src/aether-sculpture.ts` の `main()` 内、`if (tau < 0.0025) discard;` の直後に:

```glsl
  // === 一時診断（必ず消す）===
  gl_FragColor = vec4(clamp(tau / 1.5, 0.0, 1.0), 0.0, 1.0, 1.0);
  return;
```

aether のキャンバスはトーンマップを通っていないので、R チャンネルから
tau をそのまま読める（診断色 0.5 が 128 で出ることで確認済み）。

**幾何を変えたら必ず測り直してから densityRamp の停止点を置くこと。**

## 測るときの注意

- 形状は常にモーフし、シードはロードごとにランダム。**1枚では測れない。**
  複数シード × 複数フレームの平均で見る。
- 効き方は非線形。露出定数 0.100 → 0.117 の間で暗部が 11% → 33% まで動く。
- 参考フレームは `docs/画面収録 2026-08-07 0.53.09.mov` から抽出する。

## 熟成度（LIVE→完成の軌跡・worklist VITA [P1]）

```sh
# 9 曲を最後まで流して蓄積量の候補と熟成度の時系列を測る（絵は撮らない。約 45 分）
node maturity_probe.js /tmp/mat
node maturity_probe.js /tmp/mat Fury "Donna Lee"

# 上の記録から正規化（K / p）を総当たりで決める。
# **目的関数は「進行度との差」**。終端値だけを条件にすると曲の 2% で 0.75 に跳ねる解が最良になる
node maturity_fit.js /tmp/mat scalarMean

# 熟成度を dev パネルで固定して 0 / 0.3 / 0.6 / 0.9 と完成後を撮る（軌跡の途中を見る）。
# **第2引数 0 で「曲を最後まで聴いてから」**。途中で Complete を押すと熟成度が低いままで判定にならない
node maturity_sweep.js /tmp/matsweep 0 Fury 4
```
