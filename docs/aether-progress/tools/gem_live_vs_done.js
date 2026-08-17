// **同一個体**で「再生中（LIVE）」と「完成後（DONE）」の宝石の出方を比べる。
//
// なぜ要るか（2026-08-12）: ユーザー指摘「鉱石の見た目が完成時にしか反映されていない。
// LIVE 時から徐々に反映されてほしい」。原因の切り分けには
//   (a) 音色軸そのものが再生中に上がっているのか（＝結晶になる面が何枚あるか）
//   (b) 軸は上がっているのに材質が LIVE で抑えられているのか
// を分けて測る必要がある。別 run で撮ると形が別個体になって比較にならないので、
// **1 run の中で LIVE を数回撮ってから Complete を押す。**
//
// 出力: <outDir>/live_<秒>.png … / done.png と、軸の時系列（stdout / axis.json）
//
// 使い方: node gem_live_vs_done.js <outDir> <形成秒> <曲名の一部>
//   node gem_live_vs_done.js /tmp/gemlive 120 Fury
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
// 軸の表示（window.__mineralAxis）には ?surface=dev が要る
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
  await new Promise((r) => setTimeout(r, 400));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }));
};

(async () => {
  const outDir = process.argv[2] || 'gemlive';
  const formSec = Number(process.argv[3] || 120);
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
  // 大きい WAV はデコードに数秒かかる。待たずに押すと再生されない
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());

  const shots = [20, 45, 75, formSec].filter((s, i, a) => s <= formSec && a.indexOf(s) === i);
  const series = [];
  let elapsed = 0;
  const sample = async () => {
    const d = await p.evaluate(() => (window.__mineralAxis ? { ...window.__mineralAxis } : null));
    series.push({ t: elapsed, ...(d || {}) });
    return d;
  };
  while (elapsed < formSec) {
    await new Promise((r) => setTimeout(r, 5000));
    elapsed += 5;
    const d = await sample();
    if (d) {
      console.log(`t=${String(elapsed).padStart(3)}s axis=${d.axis.toFixed(3)} ` +
        `gritAvg=${d.gritAvg.toFixed(3)} 曲の軸=${d.mineral.toFixed(3)} bright=${(d.brightness ?? 0).toFixed(3)}`);
    }
    if (shots.includes(elapsed)) {
      await shoot(p, path.join(outDir, `live_${elapsed}.png`));
      console.log(`  -> live_${elapsed}.png`);
    }
  }

  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise((r) => setTimeout(r, 14000)); // 完成アニメーション + 余裕
  const done = await sample();
  await shoot(p, path.join(outDir, 'done.png'));
  console.log(`done axis=${done ? done.axis.toFixed(3) : '?'}  -> done.png`);
  fs.writeFileSync(path.join(outDir, 'axis.json'), JSON.stringify({ song: picked.trim(), series }, null, 1));
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
