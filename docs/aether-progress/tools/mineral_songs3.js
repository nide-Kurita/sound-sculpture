// 音色→形（鉱物/丸み）を**自動軸**で 3 曲通し、grit が語彙を分けるかを見る。
// Fury（歪みロック→鉱物）/ I'm Yours（アコギ→丸み）/ Donna Lee（軽いバンド→中間）。
// 各曲を最初から形成して完成・撮影する（override は使わない＝曲の音色で決まる）。
// window.__mineralAxisDebug に完成時の軸を出す（species.mineral）ので数値も拾う。
//
// 使い方: node mineral_songs3.js <outDir> [formSec]
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

const runOne = async (b, hint, formSec, outPng) => {
  const p = await b.newPage(); await p.setViewport({ width: 1000, height: 1000 });
  const errs = []; p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:5173/?style=vita', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 7000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track'); if (!sel) return null;
    const opt = [...sel.options].find(o => o.textContent.includes(h)); if (!opt) return null;
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] not found`); await p.close(); return; }
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise(r => setTimeout(r, formSec * 1000));
  await p.evaluate(() => { const btn = document.querySelector('#complete-sculpture'); if (btn) { btn.disabled = false; btn.click(); } });
  await new Promise(r => setTimeout(r, 12000));
  await shoot(p, outPng);
  console.log(`[${picked}] -> ${path.basename(outPng)}  errors:`, errs.length ? errs.slice(0, 2) : 0);
  await p.close();
};

(async () => {
  const outDir = process.argv[2] || 'mineral3';
  const formSec = Number(process.argv[3] || 45);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  await runOne(b, 'Fury', formSec, path.join(outDir, 'fury.png'));
  await runOne(b, "I'm Yours", formSec, path.join(outDir, 'imyours.png'));
  await runOne(b, 'Donna Lee', formSec, path.join(outDir, 'donnalee.png'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
