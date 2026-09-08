// 段B2: 板ガラス ON/OFF の同一フレーム差分を測る（`window.__voiceGlassDiag.mul`）。
//
// 実機で「わからない」とき、画素差が出ているかを headless で確認する。
// mul=1（通常）と mul=0（B2 完全 off）を句中に切り替え、diff% を出す。
//
// 使い方:
//   PORT=5174 node voice_glass_ab.js <outDir> <曲名の一部> [形成秒=55] [試行=6]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const { decode } = require('./png');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const PORT = process.env.PORT || '5173';
const URL = `http://localhost:${PORT}/?style=vita&surface=dev`;

const diffPct = (a, b) => {
  const n = Math.min(a.data.length, b.data.length);
  let diff = 0, tot = 0;
  for (let i = 0; i < n; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (dr + dg + db > 18) diff += 1;
    tot += 1;
  }
  return (100 * diff) / Math.max(1, tot);
};

const hideUi = (p) => p.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')];
  if (!cs.length) return;
  const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  const keep = new Set();
  for (let e = c; e; e = e.parentElement) keep.add(e);
  document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
});

const setMul = (p, mul) => p.evaluate((m) => {
  if (window.__voiceGlassDiag) window.__voiceGlassDiag.mul = m;
}, mul);

const waitPhrase = async (p, timeoutMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await p.evaluate(() => ({
      pres: window.__live?.melodyPresence ?? 0,
      glass: window.__live?.voiceGlass ?? 0,
      gain: window.__live?.voiceGlassGain ?? 0,
      facet: window.__live?.facetVoiceGlassMax ?? 0,
      axis: window.__mineralAxis?.axis ?? 0,
    }));
    if (s.pres > 0.12 && s.glass > 0.08 && s.gain > 0.05 && s.axis > 0.05) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

(async () => {
  const outDir = process.argv[2] || '/tmp/voice-glass-ab';
  const hint = process.argv[3] || 'Fury';
  const formSec = Number(process.argv[4] || 55);
  const trials = Number(process.argv[5] || 6);
  fs.mkdirSync(outDir, { recursive: true });

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 720, height: 720 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 7000));
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
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await b.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, formSec * 1000));
  await hideUi(p);

  const diffs = [];
  let missed = 0;
  for (let i = 0; i < trials; i += 1) {
    await setMul(p, 1);
    const snap = await waitPhrase(p, 14000);
    if (!snap) { missed += 1; continue; }
    const onPath = path.join(outDir, `on-${i}.png`);
    const offPath = path.join(outDir, `off-${i}.png`);
    await p.screenshot({ path: onPath });
    await setMul(p, 0);
    await new Promise((r) => setTimeout(r, 350));
    await p.screenshot({ path: offPath });
    await setMul(p, 1);
    const d = diffPct(decode(onPath), decode(offPath));
    diffs.push({ d, ...snap });
    console.log(
      `trial ${i + 1}: diff=${d.toFixed(2)}% glass=${snap.glass.toFixed(3)} facet=${snap.facet.toFixed(3)} axis=${snap.axis.toFixed(3)}`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }

  const mean = diffs.length ? diffs.reduce((s, x) => s + x.d, 0) / diffs.length : 0;
  const max = diffs.length ? Math.max(...diffs.map((x) => x.d)) : 0;
  console.log(`\n[${picked}] trials=${diffs.length}/${trials} missed=${missed}`);
  console.log(`diff mean=${mean.toFixed(2)}% max=${max.toFixed(2)}%`);
  console.log(`out: ${outDir}`);
  if (errs.length) console.log('errors:', errs.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
