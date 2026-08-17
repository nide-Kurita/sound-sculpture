// 熟成度を**固定して掃引**し、LIVE→完成の軌跡が見た目にどう出るかを測る（worklist [P1]）。
//
// 曲を最後まで聴かないと途中が見られない、では追い込めないので、dev パネルの
// 「熟成度=固定」で 0 / 0.3 / 0.6 / 0.9 を作り、**同一個体・再生中**に撮って並べる。
// 完成後（自動 1.0）も撮って、飛びが消えたかを数値で見る。
//
// 出力: <outDir>/m000.png … m090.png / done.png と、各フェーズの指標
//
// 使い方: node maturity_sweep.js <outDir> <形成秒> <曲名の一部> [枚数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

const stats = (file) => {
  const img = decode(file);
  const { width: w, height: h, bpp } = img;
  const px = img.data;
  let body = 0, hot = 0, veil = 0, sumL = 0, sumS = 0;
  for (let y = 0; y < h; y += 1) {
    const j = (y * w) * bpp;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * bpp;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]) <= 26) continue;
      body += 1;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx > 0 ? (mx - mn) / mx : 0;
      sumL += l; sumS += s;
      if (l > 0.80) hot += 1;
      if (l > 0.62 && s < 0.22) veil += 1;
      // 白飛び（3ch とも 250 以上）は別に数える。clearcoat を LIVE から立てるので必ず見る
      if (r > 250 && g > 250 && b > 250) hot += 0;
    }
  }
  return { area: body / (w * h), hot: hot / Math.max(1, body), veil: veil / Math.max(1, body),
    meanL: sumL / Math.max(1, body), meanS: sumS / Math.max(1, body) };
};

const blown = (file) => {
  const img = decode(file);
  const { width: w, height: h, bpp } = img;
  const px = img.data;
  let body = 0, blow = 0;
  for (let y = 0; y < h; y += 1) {
    const j = (y * w) * bpp;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * bpp;
      if (Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]) <= 26) continue;
      body += 1;
      if (px[i] > 250 && px[i + 1] > 250 && px[i + 2] > 250) blow += 1;
    }
  }
  return blow / Math.max(1, body);
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
  const outDir = process.argv[2] || 'matsweep';
  const formSec = Number(process.argv[3] || 60);
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
  if (formSec > 0) {
    await new Promise((r) => setTimeout(r, formSec * 1000));
  } else {
    // **形成秒 0 = 曲の終わり際まで待つ。** 熟成度が上がりきった状態で比べないと
    // 「飛びが縮んだか」の判定にならない（途中で Complete を押すと熟成度がまだ低い）。
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const d = await p.evaluate(() => (window.__maturity ? { ...window.__maturity } : null));
      if (!d) continue;
      if (d.completed) { console.log('  自動で完成した'); break; }
      // **0.93 まで待つと掃引中に曲が終わって自動完成する**（2026-08-13 に踏んだ。
      // auto と done が同じ状態になって比較にならない）。0.80 で切り上げる。
      if (d.progress >= 0.80) break;
      if (i % 15 === 0) console.log(`  進行度 ${d.progress.toFixed(2)} / 熟成度 ${(d.maturity ?? 0).toFixed(2)}`);
    }
  }

  const setMaturity = (v) => p.evaluate((v) => {
    const el = document.querySelector('#maturity-sliders input[type=range]');
    if (!el) return false;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, v);

  const phase = async (tag) => {
    const acc = [];
    let blow = 0;
    for (let k = 0; k < shots; k += 1) {
      const f = path.join(outDir, `${tag}_${k}.png`);
      await shoot(p, f);
      acc.push(stats(f));
      blow = Math.max(blow, blown(f));
      await new Promise((r) => setTimeout(r, 800));
    }
    const avg = (key) => acc.reduce((s, v) => s + v[key], 0) / acc.length;
    console.log(`${tag.padEnd(6)} hot=${(avg('hot') * 100).toFixed(2)}%  veil=${(avg('veil') * 100).toFixed(1)}%  ` +
      `meanL=${avg('meanL').toFixed(3)}  meanSat=${avg('meanS').toFixed(3)}  面積=${(avg('area') * 100).toFixed(1)}%  ` +
      `白飛び=${(blow * 100).toFixed(2)}%`);
  };

  console.log(`[${picked.trim()}] 軸=${(await p.evaluate(() => window.__mineralAxis?.axis ?? -1)).toFixed(2)}`);
  // **自動（＝いまの曲の熟成度）を先に撮る。** 掃引を先にやると、その間に曲が終わって
  // 自動完成してしまい、auto が done と同じ状態になる（2026-08-13 に踏んだ）。
  await p.evaluate(() => {
    const btn = document.querySelector('#toggle-maturity-override');
    if (btn && btn.dataset.active === 'true') btn.click();
  });
  console.log(`  自動の熟成度 = ${(await p.evaluate(() => window.__maturity?.maturity ?? -1)).toFixed(2)}`);
  await phase('auto');

  // 「熟成度=固定」で軌跡の途中を作る
  await p.evaluate(() => {
    const btn = document.querySelector('#toggle-maturity-override');
    if (btn && btn.dataset.active !== 'true') btn.click();
  });
  for (const v of [0, 0.3, 0.6, 0.9]) {
    await setMaturity(v);
    await new Promise((r) => setTimeout(r, 2500));
    await phase(`m${String(Math.round(v * 100)).padStart(3, '0')}`);
  }
  await p.evaluate(() => {
    const btn = document.querySelector('#toggle-maturity-override');
    if (btn && btn.dataset.active === 'true') btn.click();
  });
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise((r) => setTimeout(r, 14000));
  await phase('done');
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
