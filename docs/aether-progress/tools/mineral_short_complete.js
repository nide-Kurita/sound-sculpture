// **ユーザーの実機手順を再現する**: 曲を N 秒だけ鳴らして Complete を押す（既定 10 秒）。
//
// なぜ要るか（2026-08-17）: ユーザーが Fury を約10秒で Complete したとき
// 「LIVE では鉱物感がまったく分からないのに、完了した瞬間に一気に鉱物化する」と指摘。
// 曲を最後まで流す計測（`completion_gap_stats.js` の 0 モード）では**この経路を見ていない**。
//
// 記録するもの: 鉱物軸 / 熟成度 / **結晶面の枚数（0〜18）** の時系列と、
// LIVE 最終フレーム・完成直後（+1秒）・完成後（+12秒）の3枚と指標。
//
// 使い方: node mineral_short_complete.js <outDir> [秒=10] [曲名の一部=Fury] [枚数=4]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

const stats = (file) => {
  const img = decode(file);
  const { width: w, height: h, bpp } = img;
  const px = img.data;
  let body = 0, hot = 0, dark = 0, sumL = 0, sumS = 0;
  for (let y = 0; y < h; y += 1) {
    const j = (y * w) * bpp;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * bpp;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]) <= 26) continue;
      body += 1;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sumL += l; sumS += mx > 0 ? (mx - mn) / mx : 0;
      if (l > 0.80) hot += 1;
      // 結晶面の「暗い地」（宝石が宝石に見える主因）。LIVE で鉱物が読めているかの指標
      if (l < 0.28) dark += 1;
    }
  }
  return { area: body / (w * h), hot: hot / Math.max(1, body), dark: dark / Math.max(1, body),
    meanL: sumL / Math.max(1, body), meanS: sumS / Math.max(1, body) };
};

const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 250));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }));
};

const readout = (p) => p.evaluate(() => ({
  axis: window.__mineralAxis?.axis ?? -1,
  faces: window.__mineralAxis?.crystalFaces ?? -1,
  songAxis: window.__mineralAxis?.mineral ?? -1,
  maturity: window.__maturity?.maturity ?? -1,
  fromAccum: window.__maturity?.fromAccum ?? -1,
  progress: window.__maturity?.progress ?? -1,
}));

(async () => {
  const outDir = process.argv[2] || 'shortdone';
  const seconds = Number(process.argv[3] || 10);
  const hint = process.argv[4] || 'Fury';
  const shots = Number(process.argv[5] || 4);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 800, height: 800 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.bringToFront();
  await new Promise((r) => setTimeout(r, 7000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    const norm = (s) => s.normalize('NFC');
    const opt = sel && [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await b.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());

  // 1 秒ごとに軸・熟成度・結晶面数を記録（**LIVE で何が出ていないのかを枚数で見る**）
  const series = [];
  for (let t = 1; t <= seconds; t += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const d = await readout(p);
    series.push({ t, ...d });
    console.log(`t=${String(t).padStart(3)}s 軸=${d.axis.toFixed(3)} 結晶面=${d.faces.toFixed(1)}/18 ` +
      `熟成度=${d.maturity.toFixed(3)}（蓄積 ${d.fromAccum.toFixed(3)} / 進行度 ${d.progress.toFixed(3)}）`);
  }

  const phase = async (tag) => {
    const acc = [];
    for (let k = 0; k < shots; k += 1) {
      const f = path.join(outDir, `${tag}_${k}.png`);
      await shoot(p, f);
      acc.push(stats(f));
      await new Promise((r) => setTimeout(r, 500));
    }
    const avg = (key) => acc.reduce((s, v) => s + v[key], 0) / acc.length;
    const d = await readout(p);
    console.log(`${tag.padEnd(6)} 軸=${d.axis.toFixed(2)} 結晶面=${d.faces.toFixed(1)}/18 熟成度=${d.maturity.toFixed(2)} | ` +
      `稜・鏡面=${(avg('hot') * 100).toFixed(2)}% 暗地=${(avg('dark') * 100).toFixed(1)}% ` +
      `輝度=${avg('meanL').toFixed(3)} 彩度=${avg('meanS').toFixed(3)} 面積=${(avg('area') * 100).toFixed(1)}%`);
    return { tag, ...d, hot: avg('hot'), dark: avg('dark'), meanL: avg('meanL'), meanS: avg('meanS'), area: avg('area') };
  };

  const rows = [];
  rows.push(await phase('live'));
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise((r) => setTimeout(r, 1000));
  rows.push(await phase('done1s'));
  await new Promise((r) => setTimeout(r, 11000));
  rows.push(await phase('done12s'));
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ song: picked.trim(), seconds, series, rows }, null, 1));
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
