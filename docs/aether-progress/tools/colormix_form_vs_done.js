// 混色が「再生中（forming）」と「完成後（done）」で同じに見えるかを、同一個体で確かめる。
//
// なぜ要るか: ユーザー指摘「完成後の色合いが単色すぎる。再生中とは違う値になっている？」。
// vita は forming 中は core の emissive を 0 にして頂点カラー（真珠＋混色）をそのまま見せるが、
// 完成の breathe では palette.hue の**単色 emissive**を全体に足すので、混色が洗われて単色に寄る。
// これを数で確認する: 同じ個体の forming と done で本体の色相の散らばり circStd を比べる。
//
// 使い方: node colormix_form_vs_done.js <outDir> [trackHint] [formSec]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
};
const hueSpread = (file) => {
  const img = decode(file);
  const stride = img.width * img.bpp;
  let sx = 0, sy = 0, ssat = 0, sl = 0, n = 0;
  for (let y = 0; y < img.height; y++) {
    let br = 0, bg = 0, bb = 0, c = 0;
    for (let x = 0; x < 8; x++) for (const xx of [x, img.width - 1 - x]) {
      const i = y * stride + xx * img.bpp; br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; c++;
    }
    br /= c; bg /= c; bb /= c;
    for (let x = 0; x < img.width; x++) {
      const i = y * stride + x * img.bpp;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < 34) continue;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (s < 0.08) continue;
      sx += Math.cos(h * 2 * Math.PI); sy += Math.sin(h * 2 * Math.PI); ssat += s; sl += l; n++;
    }
  }
  if (!n) return null;
  const R = Math.hypot(sx / n, sy / n);
  return { px: n, R, circStd: Math.sqrt(Math.max(0, -2 * Math.log(R))) / (2 * Math.PI), sat: ssat / n, light: sl / n };
};
const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach(e => { e.style.visibility = ''; }));
};

(async () => {
  const outDir = process.argv[2] || 'formdone';
  const trackHint = process.argv[3] || "I'm Yours";
  const formSec = Number(process.argv[4] || 45);
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
  if (!picked) { console.error('track not found'); await b.close(); process.exit(1); }
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise(r => setTimeout(r, formSec * 1000));

  const formPng = path.join(outDir, 'forming.png');
  await shoot(p, formPng);

  await p.evaluate(() => { const btn = document.querySelector('#complete-sculpture'); if (btn) { btn.disabled = false; btn.click(); } });
  await new Promise(r => setTimeout(r, 12000));
  const donePng = path.join(outDir, 'done.png');
  await shoot(p, donePng);

  const f = hueSpread(formPng), d = hueSpread(donePng);
  console.log(`[${picked}]`);
  console.log('forming(再生中):', f);
  console.log('done(完成後)   :', d);
  if (f && d) console.log(`circStd forming=${f.circStd.toFixed(4)}  done=${d.circStd.toFixed(4)}  (done/forming=${(d.circStd / f.circStd).toFixed(2)})  light forming=${f.light.toFixed(2)} done=${d.light.toFixed(2)}`);
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
