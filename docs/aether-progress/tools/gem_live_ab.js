// **再生中（LIVE）に**宝石の材質・幾何ファセットが効いているかを、同一 run で A/B する。
//
// なぜ要るか（2026-08-12）: ユーザー指摘「鉱石の見た目が完成時にしか出ない」。
// 軸は Fury で 40 秒に 1.00 まで上がる（gem_live_vs_done.js で実測）ので、
// 「軸が上がらないから出ない」ではない。**軸は上がっているのに LIVE で見えない**のが何かを切り分ける。
//
// 手順: 60 秒聴かせてから、**再生を止めずに**数秒おきにパネルを切り替えて撮る。
//   a_default : 既定（宝石 1 / ファセット既定）
//   b_gem0    : 宝石強度 0（材質だけ無効。幾何ファセットは残る）
//   c_facet0  : 宝石 1 / ファセット強度 0（幾何だけ無効。材質は残る）
//   d_gem2    : 宝石強度 2（材質を最大）
// 差が出なければ「LIVE では何かが上に被さって見えない」、差が出れば「量の問題」。
//
// 使い方: node gem_live_ab.js <outDir> <形成秒> <曲名の一部>
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';
// #mineral-sliders の並び: 0=軸 / 1=ファセット強度 / 2=宝石強度 / 3=地の暗さ / 4=稜 / 5=閃き / 6=透過 / 7=分散
const IDX = { axis: 0, facet: 1, gem: 2 };

const setSlider = (p, i, v) => p.evaluate((i, v) => {
  const el = document.querySelectorAll('#mineral-sliders input')[i];
  if (!el) return false;
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, i, v);

const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 400));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }));
};

(async () => {
  const outDir = process.argv[2] || 'gemab';
  const formSec = Number(process.argv[3] || 60);
  const hint = process.argv[4] || 'Fury';
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
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
    if (!sel) return null;
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await b.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, formSec * 1000));

  const axis = await p.evaluate(() => window.__mineralAxis?.axis ?? -1);
  console.log(`[${picked.trim()}] t=${formSec}s axis=${axis.toFixed(3)}`);

  await shoot(p, path.join(outDir, 'a_default.png'));
  await setSlider(p, IDX.gem, 0);
  await new Promise((r) => setTimeout(r, 2000));
  await shoot(p, path.join(outDir, 'b_gem0.png'));
  await setSlider(p, IDX.gem, 1);
  await setSlider(p, IDX.facet, 0);
  await new Promise((r) => setTimeout(r, 4000)); // 幾何は次の変形更新で戻るので少し待つ
  await shoot(p, path.join(outDir, 'c_facet0.png'));
  await setSlider(p, IDX.facet, 1);
  await setSlider(p, IDX.gem, 2);
  await new Promise((r) => setTimeout(r, 4000));
  await shoot(p, path.join(outDir, 'd_gem2.png'));

  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
