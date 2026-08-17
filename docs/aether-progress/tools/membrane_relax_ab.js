// 膜の折り重なりをほどく平滑化を、**同一 run 内で**強さだけ変えて撮る。
//
// なぜ要るか: run をまたぐと形が変わって比較にならない。
// 実時間で60秒切って Complete しても、run ごとに到達する形が違う
// （2026-08-11 に3水準を別 run で撮って比較不能だった）。
// 完成後は形が凍っているので、そこで dev パネルの値だけを動かせば
// **形は完全に同じまま、平滑化の効果だけ**を見られる。
//
// 使い方: node membrane_relax_ab.js <出力ディレクトリ> <トラック名の一部> [URL] [形成秒数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const LEVELS = [0, 1, 2, 4];

(async () => {
  const outDir = process.argv[2];
  const trackHint = process.argv[3] || 'Fury';
  const url = process.argv[4] || 'http://localhost:5173/?style=vita';
  const formSec = Number(process.argv[5] || 60);
  if (!outDir) {
    console.error('usage: node membrane_relax_ab.js <outDir> <trackHint> [url] [formSec]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const client = await p.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((hint) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    const opt = [...sel.options].find(o => o.textContent.includes(hint));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, trackHint);
  if (!picked) { console.error(`[${trackHint}] トラックが見つからない`); await b.close(); process.exit(1); }
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  console.log(`[${picked}] ${formSec} 秒形成する`);
  await new Promise(r => setTimeout(r, formSec * 1000));

  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise(r => setTimeout(r, 12000));
  console.log('完成。ここから平滑化の値だけ動かす');

  // #membrane-sliders の1本目が Iterations
  const setIterations = (n) => p.evaluate((v) => {
    const input = document.querySelectorAll('#membrane-sliders input')[0];
    if (!input) return 'no-input';
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  }, n);

  for (const level of LEVELS) {
    const got = await setIterations(level);
    if (got === 'no-input') {
      console.error('#membrane-sliders が無い。vita 以外を見ていないか確認すること');
      await b.close();
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 2500));
    const before = new Set(fs.readdirSync(outDir));
    await p.evaluate(() => document.querySelector('#capture-verify')?.click());
    await new Promise(r => setTimeout(r, 3500));
    for (const f of fs.readdirSync(outDir)) {
      if (!f.endsWith('.png') || before.has(f)) continue;
      if (f.includes('yaw0')) {
        fs.renameSync(path.join(outDir, f), path.join(outDir, `relax-${level}.png`));
      } else {
        fs.unlinkSync(path.join(outDir, f));
      }
    }
    console.log('saved', `relax-${level}.png`);
  }

  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
