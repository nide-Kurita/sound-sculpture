// 「色が濁る」の層別切り分け（worklist vita [P1]）。
// HSL の S は暗部で意味が薄いので **LCh の C（chroma）** で測る。
// 同じ 1 ロード内で層を切り替えるので、シードも形も共通＝差は層だけ。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/docs/aether-progress/tools/png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const srgbToLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const rgbToLch = (r, g, b) => {
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  const L = 116 * fy - 16, a = 500 * (fx - fy), bb = 200 * (fy - fz);
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
};

(async () => {
  const outDir = process.argv[2];
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars','--mute-audio'] });
  const p = await b.newPage();
  await p.setViewport({ width: 620, height: 620 });
  await p.goto('http://localhost:5173/?style=vita&surface=dev', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 9000));
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  const setSel = (sel, v) => p.evaluate((s, x) => {
    const el = document.querySelector(s); if (!el) return 'none';
    el.value = String(x); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return el.value;
  }, sel, v);
  // **番号ではなくラベルで選ぶ。** ノブを足すと番号がずれて、
  // 別のスライダーを動かしたまま測ることになる（2026-08-23 に実際そうなった）。
  const setSlider = (panel, label, v) => p.evaluate((pn, lb, x) => {
    const rows = [...document.querySelectorAll(pn + ' .tuning-slider')];
    const row = rows.find((r) => (r.querySelector('.tuning-slider__label')?.textContent ?? '').includes(lb));
    const input = row?.querySelector('input[type=range]');
    if (!input) return 'none:' + lb;
    input.value = String(x); input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  }, panel, label, v);
  const clickToggle = (sel) => p.evaluate((s) => { document.querySelector(s)?.click(); return true; }, sel);

  const measure = async (tag) => {
    await new Promise(r => setTimeout(r, 5000));
    const f = path.join(outDir, tag.replace(/[^\w]/g, '_') + '.png');
    await p.screenshot({ path: f });
    const img = decode(f);
    const stride = img.width * img.bpp;
    let sumC = 0, sumL = 0, sumL2 = 0, n = 0, sx = 0, sy = 0;
    let bgC = 0, bgN = 0;
    for (let y = 0; y < img.height; y++) {
      let br = 0, bg = 0, bb = 0, k = 0;
      for (let x = 0; x < 8; x++) for (const xx of [x, img.width - 1 - x]) {
        const i = y * stride + xx * img.bpp; br += img.data[i]; bg += img.data[i+1]; bb += img.data[i+2]; k++;
      }
      br /= k; bg /= k; bb /= k;
      const bl = rgbToLch(br, bg, bb); bgC += bl.C; bgN++;
      for (let x = 0; x < img.width; x++) {
        const i = y * stride + x * img.bpp;
        const r = img.data[i], g = img.data[i+1], bb2 = img.data[i+2];
        if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(bb2 - bb) < 40) continue;
        const lch = rgbToLch(r, g, bb2);
        sumC += lch.C; sumL += lch.L; sumL2 += lch.L * lch.L; n++;
        sx += Math.cos(lch.h * Math.PI / 180); sy += Math.sin(lch.h * Math.PI / 180);
      }
    }
    const R = n ? Math.hypot(sx / n, sy / n) : 1;
    const clay = await p.evaluate(() => (window.__clay ? { ...window.__clay } : null));
    const meanL = sumL / n;
    const sdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
    console.log(`${tag.padEnd(30)} 本体 C ${(sumC/n).toFixed(1)} L ${meanL.toFixed(1)} 陰影 ${sdL.toFixed(1)}` +
      ` 色相のまとまり ${R.toFixed(3)} | 背景 C ${(bgC/bgN).toFixed(1)}` +
      (clay ? ` | 粘土基準 H ${clay.hueBase.toFixed(3)} S ${clay.satBase.toFixed(3)} L ${clay.lightBase.toFixed(3)}` : ''));
    return { tag, C: sumC/n, L: sumL/n, R };
  };

  await setSel('#weather-preview-preset', 'clear');
  await setSel('#daytime-preview-hour', 15);
  if (process.env.LIGHT_SWEEP) {
    for (const h of [15, 3]) {
      await setSel('#daytime-preview-hour', h);
      for (const g of [1, 1.2, 1.4, 1.7, 2.1]) {
        await setSlider('#env-sliders', '本体の明るさ', g);
        await measure(`晴れ${h}時 明るさ x${g}`);
      }
    }
    await b.close();
    return;
  }
  await measure('晴れ15時 現状');
  await clickToggle('#toggle-bloom');            // ブルーム OFF
  await measure('  ブルーム OFF');
  await clickToggle('#toggle-bloom');            // 戻す
  await setSlider('#colormix-sliders', '広がり', 0);
  await measure('  染み OFF（地だけ）');
  await setSlider('#colormix-sliders', '面内の色相ムラ', 0);
  await measure('  染み OFF + ムラ 0');
  await setSlider('#colormix-sliders', '膜への色乗り', 1);
  await measure('  ＋膜の色乗り 1.0');
  await setSlider('#colormix-sliders', '広がり', 0.28);
  await setSlider('#colormix-sliders', '面内の色相ムラ', 0.35);
  await setSlider('#colormix-sliders', '膜への色乗り', 0.75);
  for (const h of [3, 9, 21]) { await setSel('#daytime-preview-hour', h); await measure(`晴れ${h}時 現状`); }
  await b.close();
})();
