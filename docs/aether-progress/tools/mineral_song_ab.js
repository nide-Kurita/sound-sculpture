// 音色→形（鉱物/丸み）の完全 A/B: 同じ曲を軸=固定 0 と 1 で**別々に最初から形成**して撮る。
// 形成前に軸を固定するので、結晶アンカーの蓄積＋faceting の両方が差として出る。
// シードはファイルのバイト列由来で同じ曲なら同一なので、base 形状は揃い、語彙だけ変わる。
//
// 使い方: node mineral_song_ab.js <outDir> [trackHint] [formSec] [axisA] [axisB]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise(r => setTimeout(r, 450));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach(e => { e.style.visibility = ''; }));
};

const runOne = async (b, trackHint, formSec, axis, outPng) => {
  const p = await b.newPage(); await p.setViewport({ width: 1000, height: 1000 });
  const errs = []; p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:5173/?style=vita', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 7000));
  // 形成前に軸を固定
  await p.evaluate((a) => {
    const inputs = document.querySelectorAll('#mineral-sliders input');
    if (inputs[0]) { inputs[0].value = String(a); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
    const tgl = document.querySelector('#toggle-mineral-override');
    if (tgl && tgl.textContent.includes('自動')) tgl.click();
  }, axis);
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((hint) => {
    const sel = document.querySelector('#dev-audio-track'); if (!sel) return null;
    const opt = [...sel.options].find(o => o.textContent.includes(hint)); if (!opt) return null;
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opt.textContent;
  }, trackHint);
  if (!picked) { console.error(`[${trackHint}] not found`); await p.close(); return null; }
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise(r => setTimeout(r, formSec * 1000));
  await p.evaluate(() => { const btn = document.querySelector('#complete-sculpture'); if (btn) { btn.disabled = false; btn.click(); } });
  await new Promise(r => setTimeout(r, 12000));
  await shoot(p, outPng);
  console.log(`[${picked}] axis=${axis} -> ${path.basename(outPng)}  errors:`, errs.length ? errs.slice(0, 2) : 0);
  await p.close();
};

(async () => {
  const outDir = process.argv[2] || 'mineralab';
  const trackHint = process.argv[3] || 'Fury';
  const formSec = Number(process.argv[4] || 45);
  const axisA = Number(process.argv[5] ?? 0);
  const axisB = Number(process.argv[6] ?? 1);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  await runOne(b, trackHint, formSec, axisA, path.join(outDir, `axis_${axisA}.png`));
  await runOne(b, trackHint, formSec, axisB, path.join(outDir, `axis_${axisB}.png`));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
