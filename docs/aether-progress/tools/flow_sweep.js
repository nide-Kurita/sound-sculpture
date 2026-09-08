// **接線流（段A1 作り直し・2026-08-25）の既定値を実測で決める。**
//
// 接線変位は径方向と違って青天井ではない: 隣接頂点との差が辺長（半径 1.34 / detail 13 で
// 約 0.115）を超えると三角形が反転する。一方、弱すぎると 08-25 の判定と同じく見えない。
// そこで **#voice-panel の「接線流の強さ」スライダーを実際に動かして**（ユーザーと同じ経路）、
//   - 接線流の平均変位 / 頂点あたりの最大変位（メッシュ破綻の見張り）
//   - 実際に画面上で動いた量 coreMotion / coreMotionPeak
//   - **打点の変位が下がっていないこと**（ガード。下がったら差し戻し）
// を同一ロード内で掃引して記録する。
//
// 使い方: node flow_sweep.js <曲名の一部> [値1 値2 ...]
//   node flow_sweep.js 修羅場 0 1 2 3 4
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

// #voice-sliders の並び（initVoicePanel の specs 順）
const FLOW_INDEX = 1;

(async () => {
  const [hint, ...rest] = process.argv.slice(2);
  const values = rest.length ? rest.map(Number) : [0, 1, 2, 3, 4];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 640, height: 640 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent.trim();
  }, hint);
  if (!picked) { await browser.close(); throw new Error(`[${hint}] 曲が見つからない`); }
  const panelOk = await p.evaluate(() => {
    const inputs = document.querySelectorAll('#voice-sliders input[type=range]');
    return inputs.length;
  });
  console.log(`曲: ${picked} / #voice-sliders のスライダー数: ${panelOk}`);
  if (panelOk === 0) { await browser.close(); throw new Error('#voice-sliders が空。パネルが配線されていない'); }

  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => { if (window.__liveProbe) window.__liveProbe.on = true; });
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, 40000)); // 曲が展開するまで待つ

  const out = [];
  for (const v of values) {
    await p.evaluate((idx, val) => {
      const input = document.querySelectorAll('#voice-sliders input[type=range]')[idx];
      input.value = String(val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, FLOW_INDEX, v);
    await new Promise((r) => setTimeout(r, 1500)); // 落ち着かせる
    // 20 秒ぶんを測る。**リングバッファは 3600 行で飽和して先頭が動く**ので、
    // 「開始時の行数」で切ると空になる（2026-08-25 に踏んだ）。末尾から dt を積んで切る。
    await new Promise((r) => setTimeout(r, 20000));
    const seg = await p.evaluate(() => {
      const rows = window.__live?.dumpVocal() ?? [];
      const out = [];
      let acc = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        out.unshift(rows[i]);
        acc += rows[i][0];
        if (acc >= 18) break;
      }
      return out;
    });
    const c = (i) => seg.map((r) => r[i]);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const presence = c(10);
    const sung = presence.map((x) => x > 0.3);
    const pick = (a) => a.filter((_, i) => sung[i]);
    const rec = {
      flowAmp: v,
      samples: seg.length,
      sungFrames: pick(presence).length,
      pulseDisp: +mean(pick(c(13))).toFixed(5),
      waveDisp: +mean(pick(c(14))).toFixed(5),
      flowDisp: +mean(pick(c(15))).toFixed(5),
      flowPeak: +Math.max(0, ...c(16)).toFixed(4),
    };
    // 画面上で実際に動いた量（liveDebug の集計を使う）
    const motion = await p.evaluate(() => ({
      coreMotion: window.__live?.coreMotion ?? 0,
      coreMotionPeak: window.__live?.coreMotionPeak ?? 0,
    }));
    rec.coreMotion = +motion.coreMotion.toFixed(3);
    rec.coreMotionPeak = +motion.coreMotionPeak.toFixed(3);
    out.push(rec);
    console.log(JSON.stringify(rec));
  }
  await browser.close();

  console.log('\n=== 掃引まとめ（句が出ている間。辺長 0.115）===');
  console.log('flowAmp'.padEnd(9), '接線流平均'.padEnd(11), '最大変位'.padEnd(9),
    '辺長比'.padEnd(8), '打点変位'.padEnd(9), '径の波');
  for (const r of out) {
    console.log(String(r.flowAmp).padEnd(9), String(r.flowDisp).padEnd(11),
      String(r.flowPeak).padEnd(9), (r.flowPeak / 0.115).toFixed(2).padEnd(8),
      String(r.pulseDisp).padEnd(9), r.waveDisp);
  }
  console.log('\nconsole errors:', errs.length);
})();
