// **再生中の連続フレームを 1 枚のストリップにする。**
//
// 「LIVE の動きが見て取れるか」は 1 枚の静止画では判定できない（止まっていても綺麗に写る）。
// 0.12 秒おきに N 枚撮って横に並べ、**隣り合うフレームの差**も数字で出す。
// 変化が読めない＝差が小さい＝ユーザーの言う「動きが見て取れない」状態。
//
// 使い方: node live_strip.js <出力.png> <曲名の一部> [開始秒=45] [枚数=8] [間隔ms=120]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

(async () => {
  const out = process.argv[2];
  const hint = process.argv[3] || 'Fury';
  const startSec = Number(process.argv[4] || 45);
  const shots = Number(process.argv[5] || 8);
  const gapMs = Number(process.argv[6] || 120);
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 620, height: 620 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));
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
  await new Promise((r) => setTimeout(r, startSec * 1000));

  // UI を隠す（面積最大の canvas を残す）＋カメラの漂いを止める
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 300));

  const frames = [];
  for (let i = 0; i < shots; i += 1) {
    frames.push(await p.screenshot({ encoding: 'base64' }));
    if (i < shots - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  await b.close();

  // 隣接フレームの差（輝度の平均絶対差 / 255）を計算する
  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  const q = await b2.newPage();
  await q.setViewport({ width: 700, height: 700 });
  const diffs = await q.evaluate(async (fs2) => {
    const load = (b64) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b64;
    });
    const imgs = [];
    for (const f of fs2) imgs.push(await load(f));
    const cv = document.createElement('canvas');
    cv.width = imgs[0].width; cv.height = imgs[0].height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const grab = (im) => { ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0);
      return ctx.getImageData(0, 0, cv.width, cv.height).data; };
    const out = [];
    let prev = grab(imgs[0]);
    for (let i = 1; i < imgs.length; i += 1) {
      const cur = grab(imgs[i]);
      let sum = 0; let n = 0;
      for (let k = 0; k < cur.length; k += 4) {
        const a = (prev[k] * 0.299 + prev[k + 1] * 0.587 + prev[k + 2] * 0.114);
        const c = (cur[k] * 0.299 + cur[k + 1] * 0.587 + cur[k + 2] * 0.114);
        sum += Math.abs(a - c); n += 1;
      }
      out.push(sum / n / 255);
      prev = cur;
    }
    return out;
  }, frames);

  const cell = 300;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12161c;color:#e8eef5;font:14px/1.4 -apple-system,"Hiragino Sans",sans-serif}
    .row{display:grid;grid-template-columns:repeat(${frames.length},${cell}px);gap:8px;padding:14px}
    img{width:${cell}px;height:${cell}px;display:block;border-radius:4px}
    figcaption{padding:6px 2px 0;font-size:12px;opacity:.85}
    h1{font-size:15px;margin:14px 14px 0;font-weight:600}
  </style><h1>${picked.trim()} — ${startSec}s から ${gapMs}ms おき（隣接フレーム差の平均 ${(diffs.reduce((a, b) => a + b, 0) / diffs.length * 100).toFixed(2)}%）</h1>
  <div class="row">${frames.map((f, i) => `<figure><img src="data:image/png;base64,${f}">
    <figcaption>${i === 0 ? '基準' : `+${i * gapMs}ms / 差 ${(diffs[i - 1] * 100).toFixed(2)}%`}</figcaption></figure>`).join('')}</div>`;
  const q2 = await b2.newPage();
  await q2.setViewport({ width: frames.length * (cell + 8) + 28, height: cell + 90 });
  await q2.setContent(html, { waitUntil: 'networkidle0' });
  await q2.screenshot({ path: out, fullPage: true });
  await b2.close();
  console.log(`saved ${out} | 隣接差 ${diffs.map((d) => (d * 100).toFixed(2)).join(' / ')} %` +
    (errs.length ? '\nERRORS:\n' + errs.join('\n') : ' | console errors: 0'));
})().catch((e) => { console.error(e); process.exit(1); });
