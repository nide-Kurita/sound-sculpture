// 音色→形（鉱物/丸み）の faceting を、凍結した同一個体で軸を振って撮る。
//
// faceting は毎フレームの変形で効く（完成後も反映）ので、Complete で形を凍結してから
// dev パネル「音色で形」の軸を 0/0.5/1 に強制して撮れば、**faceting だけの差**が見える
// （結晶アンカーは形成時の軸で決まるので、この掃引には出ない。アンカー込みの差は
//  mineral_song_ab.js で別々に形成して撮る）。
//
// 使い方: node mineral_facet_sweep.js <outDir> [trackHint] [formSec]
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
  const outDir = process.argv[2] || 'mineralfacet';
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

  // 軸を強制する（override ON）ヘルパ: スライダー[0]=軸, [1]=ファセット強度、トグルで固定。
  const setAxis = async (axis) => {
    await p.evaluate((a) => {
      const inputs = document.querySelectorAll('#mineral-sliders input');
      if (inputs[0]) { inputs[0].value = String(a); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
      const tgl = document.querySelector('#toggle-mineral-override');
      // 固定ON（textContent が「軸=自動」の間は押して固定にする）
      if (tgl && tgl.textContent.includes('自動')) tgl.click();
    }, axis);
    await new Promise(r => setTimeout(r, 700));
  };

  const levels = [0, 0.5, 1.0];
  for (const a of levels) {
    await setAxis(a);
    await shoot(p, path.join(outDir, `axis_${a.toFixed(1)}.png`));
    console.log(`axis=${a.toFixed(1)} shot`);
  }
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
