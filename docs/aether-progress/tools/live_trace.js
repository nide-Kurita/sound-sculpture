// **LIVE の生波形を 1 枚の図にする。** worklist [P0] の before/after 判定用。
//
// 平均値では「点滅しているのか、点きっぱなしなのか」が区別できない
// （実測: Fury の中音フラッシュは平均 0.998 / sd 0.012 ＝ 6.8 分ずっと最大）。
// `window.__live.dump()`（直近 900 フレーム ≒ 15 秒の生波形）を折れ線にして、
// **天井に張り付いた直線が打点の列に戻ったか**を目で確かめられるようにする。
//
// 使い方: node live_trace.js <出力.png> <曲名の一部> [開始秒=60] [見出し]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

(async () => {
  const out = process.argv[2];
  const hint = process.argv[3] || 'Fury';
  const startSec = Number(process.argv[4] || 60);
  const title = process.argv[5] || '';
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
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
  await p.evaluate(() => { if (window.__liveProbe) window.__liveProbe.on = true; });
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, startSec * 1000));
  const rows = await p.evaluate(() => window.__live?.dump() ?? []);
  await b.close();
  if (!rows.length) { console.error('__live が無い（?surface=dev で開いているか確認）'); process.exit(1); }

  // 統計（画の下に数字も出す）
  const stat = (k) => {
    const v = rows.map((r) => r[k]);
    const mean = v.reduce((a, c) => a + c, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, c) => a + (c - mean) ** 2, 0) / v.length);
    const sat = v.filter((c) => c >= 0.97).length / v.length;
    return { mean, sd, sat };
  };
  const s1 = stat(1), s2 = stat(2), s3 = stat(3);
  const secs = rows.reduce((a, r) => a + r[0], 0);

  const W = 1180, H = 300;
  const series = [
    { label: `低 → 粘土のパルス（thump） 平均 ${s1.mean.toFixed(2)} / 飽和 ${(s1.sat * 100).toFixed(0)}%`, k: 1, color: '#7fd4ff' },
    { label: `中 → 膜の線・フラッシュ（chatter） 平均 ${s2.mean.toFixed(2)} / 飽和 ${(s2.sat * 100).toFixed(0)}%`, k: 2, color: '#ffd479' },
    { label: `高 → 粒子（sparkle） 平均 ${s3.mean.toFixed(2)} / 飽和 ${(s3.sat * 100).toFixed(0)}%`, k: 3, color: '#b6ff9c' },
  ];
  const poly = (k) => rows.map((r, i) =>
    `${(i / (rows.length - 1) * (W - 70) + 60).toFixed(1)},${(H - 34 - Math.min(1, r[k]) * (H - 60)).toFixed(1)}`).join(' ');

  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  const q = await b2.newPage();
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12161c;color:#e8eef5;font:13px/1.5 -apple-system,"Hiragino Sans",sans-serif}
    h1{font-size:15px;margin:16px 18px 4px;font-weight:600}
    .sub{margin:0 18px 10px;opacity:.7;font-size:12px}
    .chart{margin:0 18px 14px}
    .cap{margin:0 0 4px}
  </style>
  <h1>${title || picked.trim()}</h1>
  <div class="sub">${picked.trim()} — 再生 ${startSec} 秒時点からの直近 ${secs.toFixed(1)} 秒（${rows.length} フレーム）。
  上端 = 天井（1.0）。**天井に張り付いた直線 = 点きっぱなし = 打点が見て取れない。**</div>
  ${series.map((s) => `<div class="chart"><div class="cap" style="color:${s.color}">${s.label}</div>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect x="60" y="26" width="${W - 70}" height="${H - 60}" fill="#0b0e13" stroke="#2a323d"/>
      <line x1="60" y1="26" x2="${W - 10}" y2="26" stroke="#5a6472" stroke-dasharray="4 4"/>
      <text x="18" y="30" fill="#8b96a5" font-size="11">1.0</text>
      <text x="18" y="${H - 30}" fill="#8b96a5" font-size="11">0</text>
      <polyline points="${poly(s.k)}" fill="none" stroke="${s.color}" stroke-width="1.4"/>
    </svg></div>`).join('')}`;
  await q.setViewport({ width: W + 40, height: (H + 24) * 3 + 90 });
  await q.setContent(html, { waitUntil: 'networkidle0' });
  await q.screenshot({ path: out, fullPage: true });
  await b2.close();
  console.log(`saved ${out} | thump ${s1.mean.toFixed(3)}(sd ${s1.sd.toFixed(3)}, sat ${(s1.sat * 100).toFixed(0)}%)` +
    ` / chatter ${s2.mean.toFixed(3)}(sd ${s2.sd.toFixed(3)}, sat ${(s2.sat * 100).toFixed(0)}%)` +
    ` / sparkle ${s3.mean.toFixed(3)}(sd ${s3.sd.toFixed(3)}, sat ${(s3.sat * 100).toFixed(0)}%)` +
    (errs.length ? '\nERRORS:\n' + errs.join('\n') : ' | console errors: 0'));
})().catch((e) => { console.error(e); process.exit(1); });
