// 天気・時刻による色変化が本体へ効いているかを測る。
//
// なぜ要るか: 「天気 / 時間 / 音楽性による色変化」は原則で**必須**の要素で、
// 過去にこれを消して却下されている。ところが volume では `applyWeatherClayTint` が
// 空実装のまま、天気も時刻もまったく反映されていなかった（2026-08-10 に発見）。
// 塞いだあと、本当に色が動くようになったかを数で確かめる。
//
// 見るのは**本体画素の色相・彩度・明度**であって、背景ではない。
// 背景ドームは天気で派手に変わるので、背景込みで測ると「効いている」と誤診する。
//
// 使い方: node weather_color_check.js [URL] [待ちms]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
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

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=volume&surface=dev';
  const wait = Number(process.argv[3] || 10000);
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, wait));

  const hideUi = () => p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });

  let n = 0;
  // 本体だけ測る。背景は左右端8pxから行ごとに推定するので、天気で背景が変わっても追従する
  const bodyHsl = async () => {
    const f = path.join(os.tmpdir(), `weather-${n++}.png`);
    await p.screenshot({ path: f });
    const img = decode(f);
    const stride = img.width * img.bpp;
    let sx = 0, sy = 0, ss = 0, sl = 0, c = 0;
    for (let y = 0; y < img.height; y++) {
      let br = 0, bg = 0, bb = 0, k = 0;
      for (let x = 0; x < 8; x++) {
        for (const xx of [x, img.width - 1 - x]) {
          const i = y * stride + xx * img.bpp;
          br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; k++;
        }
      }
      br /= k; bg /= k; bb /= k;
      for (let x = 0; x < img.width; x++) {
        const i = y * stride + x * img.bpp;
        const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
        if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(bl - bb) < 40) continue;
        const [h, s, l] = rgbToHsl(r, g, bl);
        if (s < 0.05) { sl += l; c++; continue; }
        sx += Math.cos(h * 2 * Math.PI); sy += Math.sin(h * 2 * Math.PI);
        ss += s; sl += l; c++;
      }
    }
    if (!c) return null;
    let h = Math.atan2(sy / c, sx / c) / (2 * Math.PI);
    if (h < 0) h += 1;
    return { hue: h, sat: ss / c, light: sl / c, px: c };
  };

  const setPreset = (id) => p.evaluate((v) => {
    const sel = document.querySelector('#weather-preview-preset');
    if (!sel) return 'no-select';
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value;
  }, id);
  const setHour = (h) => p.evaluate((v) => {
    const input = document.querySelector('#daytime-preview-hour');
    if (!input) return 'no-input';
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  }, h);

  const presets = await p.evaluate(() =>
    [...(document.querySelector('#weather-preview-preset')?.options ?? [])].map(o => o.value));
  console.log('選べる天気プリセット:', JSON.stringify(presets));

  await hideUi();
  await new Promise(r => setTimeout(r, 600));

  const rows = [];
  for (const id of presets.filter(v => v !== 'live')) {
    await setPreset(id);
    await hideUi();
    await new Promise(r => setTimeout(r, 1200));
    const s = await bodyHsl();
    rows.push({ label: `天気 ${id}`, ...s });
  }
  await setPreset('clear');
  for (const hour of [3, 9, 15, 21]) {
    await setHour(hour);
    await hideUi();
    await new Promise(r => setTimeout(r, 1200));
    const s = await bodyHsl();
    rows.push({ label: `時刻 ${hour}時`, ...s });
  }

  for (const r of rows) {
    console.log(`  ${r.label.padEnd(14)} hue ${r.hue.toFixed(3)}  sat ${r.sat.toFixed(3)}  light ${r.light.toFixed(3)}`);
  }
  const hueDist = (a, c) => { const d = Math.abs(a - c) % 1; return Math.min(d, 1 - d); };
  const spread = (sel) => {
    const xs = rows.filter(r => r.label.startsWith(sel));
    let m = 0;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) m = Math.max(m, hueDist(xs[i].hue, xs[j].hue));
    const lights = xs.map(x => x.light);
    return `色相の広がり ${m.toFixed(3)} / 明度の幅 ${(Math.max(...lights) - Math.min(...lights)).toFixed(3)}`;
  };
  console.log('天気による差:', spread('天気'));
  console.log('時刻による差:', spread('時刻'));
  console.log('console errors:', errs.length ? errs : 'none');
  await b.close();
})();
