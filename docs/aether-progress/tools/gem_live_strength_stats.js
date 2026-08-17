// 再生中（LIVE）に宝石の光学が**そもそも描かれているのか**を数値で確かめる。
//
// 形は毎フレーム動くので 1 枚ずつの A/B では判定できない（2026-08-12 に一度そうなった）。
// そこで「宝石強度 0 で N 枚 → 2 で N 枚」を短い間隔で撮り、**平均**で比べる。
// 出るのは面積比なので、形の揺れは平均で均される。
//
// 使い方: node gem_live_strength_stats.js <outDir> <形成秒> <曲名の一部> [枚数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';
const GEM_SLIDER = 2; // 0=軸 / 1=ファセット強度 / 2=宝石強度

const stats = (file) => {
  const img = decode(file);
  const { width: w, height: h, bpp } = img;
  const px = img.data;
  let body = 0, hot = 0, sumL = 0, sumS = 0;
  for (let y = 0; y < h; y += 1) {
    const j = (y * w) * bpp; // その行の左端＝背景（深海のグラデ）
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * bpp;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]) <= 26) continue;
      body += 1;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sumL += l; sumS += mx > 0 ? (mx - mn) / mx : 0;
      if (l > 0.80) hot += 1; // 稜・鏡面のハイライト
    }
  }
  return { area: body / (w * h), hot: hot / Math.max(1, body), meanL: sumL / Math.max(1, body), meanS: sumS / Math.max(1, body) };
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

(async () => {
  const outDir = process.argv[2] || 'gemstats';
  const formSec = Number(process.argv[3] || 60);
  const hint = process.argv[4] || 'Fury';
  const shots = Number(process.argv[5] || 6);
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
  await new Promise((r) => setTimeout(r, formSec * 1000));
  console.log(`[${picked.trim()}] axis=${(await p.evaluate(() => window.__mineralAxis?.axis ?? -1)).toFixed(3)}`);

  const run = async (gem, tag) => {
    await p.evaluate((i, v) => {
      const el = document.querySelectorAll('#mineral-sliders input')[i];
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, GEM_SLIDER, gem);
    await new Promise((r) => setTimeout(r, 1200));
    const acc = [];
    for (let k = 0; k < shots; k += 1) {
      const f = path.join(outDir, `${tag}_${k}.png`);
      await shoot(p, f);
      acc.push(stats(f));
      await new Promise((r) => setTimeout(r, 900));
    }
    const avg = (key) => acc.reduce((s, v) => s + v[key], 0) / acc.length;
    console.log(`宝石強度 ${gem}: hot=${(avg('hot') * 100).toFixed(2)}%  meanL=${avg('meanL').toFixed(3)}  ` +
      `meanSat=${avg('meanS').toFixed(3)}  面積=${(avg('area') * 100).toFixed(1)}%`);
  };
  await run(0, 'gem0');
  await run(2, 'gem2');
  await run(0, 'gem0b'); // 戻して再現性を見る（曲の展開で変わっていないか）
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
