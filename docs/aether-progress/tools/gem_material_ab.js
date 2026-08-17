// 宝石マテリアルの isolate: 完成後に軸を 1 に固定（幾何ファセットを凍結）してから、
// 「宝石強度」スライダーだけ 0 / 2 に振り、**材質（映り込み鋭化・微ファセット法線・スパークル）
// だけ**の差を撮る。幾何は動かないので、差が出れば gem-material.ts の寄与だと言える。
// 使い方: node gem_material_ab.js <outDir> [trackHint] [formSec]
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

(async () => {
  const outDir = process.argv[2] || 'gemab';
  const trackHint = process.argv[3] || 'Fury';
  const formSec = Number(process.argv[4] || 40);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage(); await p.setViewport({ width: 1000, height: 1000 });
  const errs = []; p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:5173/?style=vita', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((hint) => {
    const sel = document.querySelector('#dev-audio-track'); if (!sel) return null;
    const opt = [...sel.options].find(o => o.textContent.includes(hint)); if (!opt) return null;
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opt.textContent;
  }, trackHint);
  if (!picked) { console.error(`[${trackHint}] not found`); await b.close(); process.exit(1); }
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  console.log(`[${picked}] form ${formSec}s then freeze`);
  await new Promise(r => setTimeout(r, formSec * 1000));
  await p.evaluate(() => { const btn = document.querySelector('#complete-sculpture'); if (btn) { btn.disabled = false; btn.click(); } });
  await new Promise(r => setTimeout(r, 12000));

  // 軸=固定 1（幾何ファセットを凍結）。slider[0]=軸, [1]=ファセット強度, [2]=宝石強度。
  await p.evaluate(() => {
    const inputs = document.querySelectorAll('#mineral-sliders input');
    if (inputs[0]) { inputs[0].value = '1'; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
    const tgl = document.querySelector('#toggle-mineral-override');
    if (tgl && tgl.textContent.includes('自動')) tgl.click();
  });
  await new Promise(r => setTimeout(r, 800));

  const setGem = async (g) => {
    await p.evaluate((v) => {
      const inputs = document.querySelectorAll('#mineral-sliders input');
      if (inputs[2]) { inputs[2].value = String(v); inputs[2].dispatchEvent(new Event('input', { bubbles: true })); }
    }, g);
    await new Promise(r => setTimeout(r, 700));
  };

  for (const g of [0, 2]) {
    await setGem(g);
    await shoot(p, path.join(outDir, `gem_${g}.png`));
    console.log(`gem=${g} shot`);
  }
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
