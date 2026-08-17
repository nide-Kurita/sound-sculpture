// 音色軸（SpeciesProfile.mineral）を**自動軸のまま**全曲で実測する。絵は撮らない（速い）。
//
// これが無かったせいで「軸がほぼ全曲 0 なので宝石が一切出ない」ことに気づけなかった
// （2026-08-12）。強度を触る前に必ずこれを回して、曲ごとの軸が目標帯に入っているか見る。
//
// 読むのは window.__mineralAxis（main.ts の mineralDebug。?surface=dev が必要）。
//
// 使い方: node mineral_axis_probe.js [秒数] [曲名の一部...]
//   node mineral_axis_probe.js 90                # 全曲を 90 秒ずつ
//   node mineral_axis_probe.js 60 Fury "I'm Yours"
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

// 曲名の一部（Dev Audio のカタログ表示名に含まれる文字列）
const ALL_SONGS = [
  'Fury',
  '6_00',
  'Fly Away',
  'Peaches',
  '修羅場',
  'ロビンソン',
  'AIR',
  'Donna Lee',
  "I'm Yours",
];

const runOne = async (b, hint, seconds) => {
  const p = await b.newPage();
  await p.setViewport({ width: 700, height: 700 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.bringToFront();
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    // **macOS のファイル名は NFD**（「ロビンソン」の濁点が分離している）。
    // 引数は NFC で来るので、両側を正規化しないと日本語の曲名が一致しない。
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) {
    console.error(`[${hint}] 曲が見つからない`);
    await p.close();
    return null;
  }
  // **大きい WAV（Fury 71MB / 6:00 58MB）は fetch + decodeAudioData に数秒かかる。**
  // 待たずに録音開始を押すと何も再生されず、全部 0 の行になる（実際に一度そうなった）。
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  // 実際に解析が動き出したか確認して、動いていなければ押し直す
  for (let t = 0; t < 20; t += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const alive = await p.evaluate(() => (window.__mineralAxis?.gritAvg ?? 0) > 0);
    if (alive) break;
    if (t === 9) {
      await p.evaluate(() => document.querySelector('#begin-recording')?.click());
    }
  }

  const samples = [];
  for (let t = 0; t < seconds; t += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await p.evaluate(() => {
      const d = window.__mineralAxis;
      return d ? { ...d } : null;
    });
    if (s) samples.push(s);
  }
  await p.close();

  if (!samples.length) {
    console.error(`[${picked}] window.__mineralAxis が取れない（?surface=dev か確認）`);
    return null;
  }
  const last = samples[samples.length - 1];
  if (process.env.TRAJ) {
    // 軸の立ち上がり（何秒でいくつになるか）。「再生してすぐ見ても出ない」の切り分け用
    console.log(
      `  軸の推移: ${samples.map((s, i) => `${i + 1}s=${s.axis.toFixed(2)}`).filter((_, i) => i % 5 === 4).join(' ')}`,
    );
  }
  // ウォームアップ（軸が既定値の間）を除いた後半だけの平均も出す
  const tail = samples.slice(Math.floor(samples.length * 0.5));
  const mean = (arr, key) => arr.reduce((a, s) => a + s[key], 0) / arr.length;
  return {
    song: picked.trim(),
    axis: last.axis,
    axisTail: mean(tail, 'axis'),
    gritAvg: last.gritAvg,
    gritNow: mean(tail, 'grit'),
    organic: last.organic,
    aggressive: last.aggressive,
    // calibration 用の生の曲平均（合成軸と違って飽和しない）
    loudRatio: last.loudRatio,
    brightness: last.brightness,
    melodyFocus: last.melodyFocus,
    centroid: last.centroid,
    transient: last.transient,
    density: last.density,
    errors: errs.length,
  };
};

(async () => {
  const seconds = Number(process.argv[2] || 90);
  const songs = process.argv.length > 3 ? process.argv.slice(3) : ALL_SONGS;
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  // **逐次でしか測れない。** 並列にすると背景タブの rAF が止まり、
  // シミュレーションが進まないまま 90 秒経って「grit はあるのに種がウォームアップ未満」
  // という壊れた行になる（2026-08-12 に実際に踏んだ。organic が既定値 0.146 のままなら疑う）。
  const rows = [];
  const BATCH = 1;
  for (let i = 0; i < songs.length; i += BATCH) {
    const batch = songs.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((hint) => runOne(b, hint, seconds)));
    for (const r of results) {
      if (!r) continue;
      rows.push(r);
      console.log(
        `${r.song.padEnd(30)} axis=${r.axis.toFixed(3)} (tail ${r.axisTail.toFixed(3)})  ` +
        `grit=${r.gritAvg.toFixed(4)}  loud=${r.loudRatio.toFixed(3)}  bright=${r.brightness.toFixed(3)}  ` +
        `mel=${r.melodyFocus.toFixed(3)}  organic=${r.organic.toFixed(3)}  agg=${r.aggressive.toFixed(3)}  err=${r.errors}`,
      );
    }
  }
  await b.close();
  console.log('\nJSON:');
  console.log(JSON.stringify(rows, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
