// 混色（時刻・天気・曲を面内で暖⇔寒に混ぜる）の A/B を、同一個体で撮る。
//
// なぜ要るか: シードはロードごとに変わるので、別々に起動した2枚は形も色も比べられない
// （handoff/VITA.md 6章）。混色 ON/OFF は dev パネル #toggle-colormix で同一ロード内に
// 切り替えられ、形成中は頂点カラーが焼き直される（≤0.22s）ので、
// **同じ個体で「単色（OFF）↔ 混色（ON）」だけを差として撮れる。**
//
// 出す数: 本体画素の色相の円周分散（= どれだけ単色でないか）。
//   R = 平均合成ベクトル長（1 に近い=単色、小さい=色相が散っている）
//   circStd = sqrt(-2 ln R) を色相単位へ（大きいほど混ざっている）
//
// 使い方: node colormix_ab.js <outDir> [trackHint] [formSec]
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

// 本体だけを取る。背景は左右端8pxから行ごとに推定（vita は上下グラデーション）
const hueSpread = (file) => {
  const img = decode(file);
  const stride = img.width * img.bpp;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < img.height; y++) {
    let br = 0, bg = 0, bb = 0, c = 0;
    for (let x = 0; x < 8; x++) {
      for (const xx of [x, img.width - 1 - x]) {
        const i = y * stride + xx * img.bpp;
        br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; c++;
      }
    }
    br /= c; bg /= c; bb /= c;
    for (let x = 0; x < img.width; x++) {
      const i = y * stride + x * img.bpp;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < 34) continue;
      const [h, s] = rgbToHsl(r, g, b);
      if (s < 0.08) continue; // 無彩色は色相が定義できない
      sx += Math.cos(h * 2 * Math.PI);
      sy += Math.sin(h * 2 * Math.PI);
      n++;
    }
  }
  if (!n) return null;
  const R = Math.hypot(sx / n, sy / n);
  const circStd = Math.sqrt(Math.max(0, -2 * Math.log(R))) / (2 * Math.PI); // 色相単位
  return { px: n, R, circStd };
};

const shootCanvas = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise(r => setTimeout(r, 500));
  await p.screenshot({ path: out });
  await p.evaluate(() => { document.querySelectorAll('body *').forEach(e => { e.style.visibility = ''; }); });
};

(async () => {
  const outDir = process.argv[2] || 'colormix';
  const trackHint = process.argv[3] || "I'm Yours";
  const formSec = Number(process.argv[4] || 45);
  fs.mkdirSync(outDir, { recursive: true });

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 1000 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:5173/?style=vita', { waitUntil: 'networkidle2', timeout: 60000 });
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
  console.log(`[${picked}] ${formSec} 秒だけ形成してから Complete で凍結する`);
  await new Promise(r => setTimeout(r, formSec * 1000));

  // 形を凍結する（Complete）。以降は個体が動かないので、混色だけを差として撮れる。
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise(r => setTimeout(r, 12000)); // 完成アニメーション6秒 + 余裕

  // 同一の凍結個体で spread を振る。パネルのスライダーを動かすと即座に焼き直される。
  const setSpread = async (v) => {
    await p.evaluate((val) => {
      const inp = document.querySelector('#colormix-sliders input'); // 先頭 = 広がり
      if (!inp) return 'no-input';
      inp.value = String(val);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    }, v);
    await new Promise(r => setTimeout(r, 600));
  };

  const levels = [0, 0.18, 0.3];
  const results = [];
  for (const v of levels) {
    await setSpread(v);
    const png = path.join(outDir, `spread_${v.toFixed(2)}.png`);
    await shootCanvas(p, png);
    const m = hueSpread(png);
    results.push({ v, png, m });
    console.log(`spread=${v.toFixed(2)}  circStd=${m ? m.circStd.toFixed(4) : 'n/a'}  R=${m ? m.R.toFixed(3) : 'n/a'}  px=${m ? m.px : 0}`);
  }
  const base = results.find(r => r.v === 0);
  if (base && base.m) {
    for (const r of results) {
      if (r.v === 0 || !r.m) continue;
      console.log(`  spread ${r.v.toFixed(2)} / OFF(0): circStd ${(r.m.circStd / base.m.circStd).toFixed(2)}x`);
    }
  }
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
