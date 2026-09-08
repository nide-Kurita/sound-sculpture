// サムネイル用の1枚を撮る。曲を最後まで通し、完成形を指定の天気・時刻で撮影する。
//
// 使い方:
//   node thumbnail.js <URL> <トラック名の一部|standby> <出力パス.png> [天気] [時刻] [style] [タイムアウト秒] [幅] [高さ]
//
// 幅・高さは CSS ピクセル（既定 1600x1000）。deviceScaleFactor 2 で描くので、
// 出力はその 2 倍の画素数になる（1920x1080 が要るなら sips -z 1080 1920 で縮める）。
// 例:
//   node thumbnail.js http://localhost:5173/ ロビンソン /tmp/thumb.png cloudy 4 vita
//   node thumbnail.js http://localhost:5173/ standby   /tmp/intro.png cloudy 4 vita
//
// トラック名に `standby` を渡すと、**音を聴かせる前の待機画面**を撮る。
// タイトル・説明文・HUD を出したまま、操作パネルと DEV バッジだけ隠す。
//
// 天気は index.html の #weather-preview-preset の value（clear / cloudy / overcast /
// fog / rain / rain-heavy / snow / windy / storm / thunder / thunderstorm）。
// 時刻は 0〜24 の小数（4 = AM4:00）。
//
// **サムネイル用の一時パッチ（2026-09-08）**
// 「曇り AM4:00」では雲がほとんど描かれず星も薄いので、撮影のときだけ
// src/scene-background.ts を一時的に強めて撮り、撮影後にバックアップから戻した。
// **作品側の値は変えていない。** 同じ絵を撮り直すときは以下を当てて、撮ったら必ず戻すこと。
//
//   1. 雲層へ渡す量:  this.weatherClouds.setWeather(state.cloudCover ...)
//                     → Math.min(1, state.cloudCover * 2.2)
//   2. ドームの霞:    const cloud = ... this.weather.cloudCover
//                     → Math.min(1, this.weather.cloudCover * 2.2)（fogHaze も同じ値で）
//   3. 雲の枚数:      super("sky", 16) → 44
//   4. 雲の色:        0x8f9aa8 / 0xb8c2cd → 0xc8d2de / 0xd4dce6
//   5. 雲の不透明度:  sky の 0.16 + intensity * 0.38 → 0.3 + intensity * 0.45
//   6. 星（近）:      count 820→1400 / size 0.052→0.078 / baseOpacity 0.95→1
//   7. 星（遠）:      count 3400→6200 / size 0.02→0.032 / baseOpacity 0.8→0.98
//
// 手順: cp src/scene-background.ts /tmp/scene-background.BACKUP.ts
//       → パッチ → 撮影 → cp /tmp/scene-background.BACKUP.ts src/scene-background.ts
//       （git checkout は未コミットの変更を消すので使わない）
//
// 注意（tools/README.md より）:
// - Dev Audio は DEV サーフェスにしか無いので、公開プレビューでは動かない。
//   撮影時だけ #surface-badge と操作パネルを隠す。
// - 大きい WAV は decode に数秒かかる。曲を選んでから録音開始まで待つ。
// - src/music/s04.wav は極端な信号なので見た目の判断に使わない。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const url = process.argv[2];
  const trackHint = process.argv[3];
  const outPath = process.argv[4];
  const weather = process.argv[5] || 'cloudy';
  const hour = Number(process.argv[6] ?? 4);
  const style = process.argv[7] || 'vita';
  const timeoutSec = Number(process.argv[8] || 900);
  const vw = Number(process.argv[9] || 1600);
  const vh = Number(process.argv[10] || 1000);
  if (!url || !trackHint || !outPath) {
    console.error('usage: node thumbnail.js <url> <trackHint> <out.png> [weather] [hour] [style] [timeoutSec]');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const p = await b.newPage();
  await p.setViewport({ width: vw, height: vh, deviceScaleFactor: 2 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));

  const target = url.includes('?') ? `${url}&style=${style}` : `${url}?style=${style}`;
  await p.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  // 天気と時刻を指定する（どちらもチェックを入れてからプリセット／スライダーを動かす）
  const env = await p.evaluate(({ weather, hour }) => {
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const wx = document.querySelector('#live-weather');
    if (wx && !wx.checked) { wx.checked = true; fire(wx, 'change'); }
    const dt = document.querySelector('#daytime-background');
    if (dt && !dt.checked) { dt.checked = true; fire(dt, 'change'); }
    return { weatherToggled: !!wx, timeToggled: !!dt, weather, hour };
  }, { weather, hour });
  await new Promise(r => setTimeout(r, 1500));

  const applied = await p.evaluate(({ weather, hour }) => {
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const preset = document.querySelector('#weather-preview-preset');
    if (preset) { preset.value = weather; fire(preset, 'change'); }
    const slider = document.querySelector('#daytime-preview-hour');
    if (slider) { slider.value = String(hour); fire(slider, 'input'); fire(slider, 'change'); }
    return {
      weather: preset ? preset.value : null,
      weatherLabel: document.querySelector('#weather-preview-value')?.textContent ?? null,
      hour: slider ? slider.value : null,
      hourLabel: document.querySelector('#daytime-preview-value')?.textContent ?? null,
    };
  }, { weather, hour });
  console.log('環境:', JSON.stringify(applied));
  await new Promise(r => setTimeout(r, 2000));

  const standby = trackHint === 'standby' || trackHint === '-';
  if (standby) {
    // 待機画面をそのまま撮る。テキストと HUD は残し、操作パネルと DEV バッジだけ外す。
    await new Promise(r => setTimeout(r, 4000));
    await p.evaluate(() => {
      document.querySelector('#control-panel-shell')?.classList.add('is-collapsed');
      const badge = document.querySelector('#surface-badge');
      if (badge) badge.hidden = true;
      const toggle = document.querySelector('#hud-panel-toggle');
      if (toggle) toggle.style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 2500));
    await p.screenshot({ path: outPath });
    console.log('保存:', outPath, '（待機画面）');
    console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
    await b.close();
    return;
  }

  // 曲を選んで再生
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((hint) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find(o => norm(o.textContent).includes(norm(hint)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, trackHint);
  if (!picked) { console.error(`[${trackHint}] トラックが見つからない`); await b.close(); process.exit(1); }
  console.log(`[${picked}] 読み込み待ち`);
  await new Promise(r => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  console.log(`[${picked}] 再生開始`);

  const started = Date.now();
  let completed = false;
  while ((Date.now() - started) / 1000 < timeoutSec) {
    await new Promise(r => setTimeout(r, 10000));
    const st = await p.evaluate(() => ({
      status: document.querySelector('#hud-status')?.textContent ?? '',
      tc: document.querySelector('#hud-timecode')?.textContent ?? '',
    }));
    if (st.status.toUpperCase().includes('COMPLETE')) { completed = true; break; }
    console.log(`  ${st.status} ${st.tc}`);
  }
  if (!completed) { console.error('タイムアウト。完成しなかった'); await b.close(); process.exit(1); }

  console.log('完成。落ち着くまで待つ');
  await new Promise(r => setTimeout(r, 12000));

  // 画面表示（HUD・タイトル）と操作パネル、DEV バッジを外して撮る
  await p.evaluate(() => {
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const hud = document.querySelector('#show-hud-chrome');
    if (hud && hud.checked) { hud.checked = false; fire(hud, 'change'); }
    document.querySelector('#control-panel-shell')?.classList.add('is-collapsed');
    const badge = document.querySelector('#surface-badge');
    if (badge) badge.hidden = true;
    const toggle = document.querySelector('#hud-panel-toggle');
    if (toggle) toggle.style.display = 'none';
  });
  await new Promise(r => setTimeout(r, 2500));

  await p.screenshot({ path: outPath });
  console.log('保存:', outPath);
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})();
