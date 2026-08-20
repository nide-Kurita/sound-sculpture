// `#mineral-panel` のノブ1本を**同一個体・再生中**に振って、等倍で切り出して並べる。
//
// なぜ要るか（2026-08-18）: 水晶らしさの詰めは「係数を上げたら見た目がどう割れるか」を
// 目で見ないと決まらない。別 run で撮ると別個体になるので、**1 run の中で振る**。
// 縮小すると条線が消えるので **crop_zoom で等倍〜拡大**して見る（肌理のときと同じ失敗を避ける）。
//
// スライダーの並び（`initMineralPanel` の specs 順）:
//   0 軸 / 1 ファセット強度 / 2 宝石強度 / 3 結晶面の地の暗さ / 4 稜 / 5 面の閃き /
//   6 透過 / 7 分散(fire) / 8 内部の条線 / 9 内部の霧 / 10 縁の分散
//
// 使い方: node gem_knob_sweep.js <outDir> <形成秒> <曲> <スライダー番号> <値1,値2,...>
//   node gem_knob_sweep.js /tmp/vein 14 Fury 8 0,0.5,1.5
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }));
};

(async () => {
  const outDir = process.argv[2] || 'knob';
  const formSec = Number(process.argv[3] || 14);
  const hint = process.argv[4] || 'Fury';
  const index = Number(process.argv[5] || 8);
  const values = (process.argv[6] || '0,0.5,1.5').split(',').map(Number);
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
  // **形を止める**（`#complete-sculpture` を押すと完成状態になるが、形が凍って比較できる）
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise((r) => setTimeout(r, 13000));
  const label = await p.evaluate((i) => {
    const rows = document.querySelectorAll('#mineral-sliders .tuning-slider');
    return rows[i]?.querySelector('.tuning-slider__label')?.textContent?.trim() ?? `slider${i}`;
  }, index);
  console.log(`[${picked.trim()}] ノブ「${label}」を振る（完成後に固定して比較）`);
  for (const v of values) {
    const ok = await p.evaluate((i, val) => {
      const el = document.querySelectorAll('#mineral-sliders input[type=range]')[i];
      if (!el) return false;
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, index, v);
    if (!ok) { console.error(`スライダー ${index} が無い`); break; }
    await new Promise((r) => setTimeout(r, 1200));
    const f = path.join(outDir, `v${String(v).replace('.', '_')}.png`);
    await shoot(p, f);
    console.log(`  ${label}=${v} -> ${path.basename(f)}`);
  }
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
