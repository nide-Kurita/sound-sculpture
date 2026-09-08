// **待機（＝初期色）の天気 × 時刻グリッド。** worklist vita [P1]「初期色が面白くない」用。
//
// なぜ待機で撮るか: ユーザーの指摘は「**初期の**色があまり面白くない」。
// 待機〜再生直後は曲パレットがまだ乗っていないので、色を決めているのは
// スタイルの粘土ベース ＋ 天気 ＋ 時刻 ＋ 混色だけ。ここが動いていないなら
// 「天気・時間帯で色を楽しむ」は成立していない。
//
// `env_color_grid.js` は**完成後**の色を測る（形を凍らせて色だけ振る）別の道具。
// あちらは曲パレットが乗った後の話なので、初期色の判断には使えない。
//
// 出すもの:
//   - 本体画素の色相・彩度・明度（背景は左右端 8px から行ごとに推定して除外する）
//   - 天気ぶんの広がり／時刻ぶんの広がり（色相は円周上の距離で測る）
//   - 並べた 1 枚の画像（見た目の判断は数値だけでしない、というユーザーとの合意）
//
// 使い方: node initial_color_grid.js <出力ディレクトリ> [天気の振れ幅=1] [時刻の振れ幅=1] [面内の色相ムラ=1] [URL]
//   振れ幅は dev パネル `#envcolor-panel`、色相ムラは `#colormix-panel` の
//   スライダーを動かして与える（実機と同じ経路を通す）。
//
// **「ムラ」と「環境の色」を同じ土俵で出す。**
//   ムラ（面内の色相のばらつき）が環境の幅より大きいと、本体の色は
//   「今日の天気の色」ではなく「ランダムなまだら」に見える。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const WEATHERS = [
  ['clear', '晴れ'], ['cloudy', '曇り'], ['overcast', 'どんより'],
  ['rain', '雨'], ['snow', '雪'], ['thunderstorm', '雷雨'],
];
const HOURS = [3, 9, 15, 21];

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

/** 色相の広がり（円周上）。0.5 が最大（補色） */
const hueSpread = (hues) => {
  let worst = 0;
  for (let i = 0; i < hues.length; i += 1) {
    for (let j = i + 1; j < hues.length; j += 1) {
      let d = Math.abs(hues[i] - hues[j]);
      if (d > 0.5) d = 1 - d;
      if (d > worst) worst = d;
    }
  }
  return worst;
};

(async () => {
  const outDir = process.argv[2] || 'initcolor';
  const wGain = Number(process.argv[3] ?? 1);
  const hGain = Number(process.argv[4] ?? 1);
  const noise = Number(process.argv[5] ?? 1);
  const url = process.argv[6] || 'http://localhost:5173/?style=vita&surface=dev';
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 620, height: 620 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 9000));

  // UI を隠す（面積最大の canvas を残す）
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });

  // 振れ幅ノブ（dev パネル）を設定する。**パネル経由で動かす**ので配線ごと確認できる。
  const gains = await p.evaluate((g) => {
    const inputs = [...document.querySelectorAll('#envcolor-sliders input[type=range]')];
    if (inputs.length < 2) return 'no-panel';
    inputs[0].value = String(g.w);
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = String(g.h);
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return `${inputs[0].value} / ${inputs[1].value}`;
  }, { w: wGain, h: hGain });
  const noiseSet = await p.evaluate((v) => {
    const inputs = [...document.querySelectorAll('#colormix-sliders input[type=range]')];
    if (inputs.length < 2) return 'no-panel';
    inputs[1].value = String(v);   // [広がり, 面内の色相ムラ, 配分]
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return inputs[1].value;
  }, noise);
  console.log(`振れ幅（天気 / 時刻）= ${gains} / 面内の色相ムラ = ${noiseSet}`);
  await new Promise((r) => setTimeout(r, 1500));

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

  const cells = [];
  for (const [wid, wlabel] of WEATHERS) {
    for (const hour of HOURS) {
      await setPreset(wid);
      await setHour(hour);
      // 色は lerp で追従する。**待たずに撮ると途中の色を測ることになる**
      // （2026-08-11 に env 側で同じ失敗をしている）。
      await new Promise((r) => setTimeout(r, 9000));
      const clay = await p.evaluate(() => (window.__clay ? { ...window.__clay } : null));
      const file = path.join(outDir, `${wid}-${hour}.png`);
      await p.screenshot({ path: file });
      const img = decode(file);
      const stride = img.width * img.bpp;
      let sx = 0, sy = 0, ss = 0, sl = 0, c = 0;
      let bgSx = 0, bgSy = 0, bgS = 0, bgL = 0, bgC = 0;
      for (let y = 0; y < img.height; y += 1) {
        let br = 0, bg = 0, bb = 0, k = 0;
        for (let x = 0; x < 8; x += 1) {
          for (const xx of [x, img.width - 1 - x]) {
            const i = y * stride + xx * img.bpp;
            br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; k += 1;
          }
        }
        br /= k; bg /= k; bb /= k;
        const [bh, bs, bl2] = rgbToHsl(br, bg, bb);
        bgSx += Math.cos(bh * 2 * Math.PI); bgSy += Math.sin(bh * 2 * Math.PI);
        bgS += bs; bgL += bl2; bgC += 1;
        for (let x = 0; x < img.width; x += 1) {
          const i = y * stride + x * img.bpp;
          const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
          if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(bl - bb) < 40) continue;
          const [h, s, l] = rgbToHsl(r, g, bl);
          if (s < 0.05) { sl += l; c += 1; continue; }
          sx += Math.cos(h * 2 * Math.PI); sy += Math.sin(h * 2 * Math.PI);
          ss += s; sl += l; c += 1;
        }
      }
      let hue = c ? Math.atan2(sy / c, sx / c) / (2 * Math.PI) : 0;
      if (hue < 0) hue += 1;
      // 面内のムラ = 色相ベクトルの平均長から出す円周標準偏差（0=一様, 大きいほどまだら）
      const R = c ? Math.hypot(sx / c, sy / c) : 1;
      const mottle = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-6, R)))) / (2 * Math.PI);
      let bgHue = Math.atan2(bgSy / bgC, bgSx / bgC) / (2 * Math.PI);
      if (bgHue < 0) bgHue += 1;
      const cell = {
        weather: wid, label: wlabel, hour, file,
        hue, sat: c ? ss / c : 0, light: c ? sl / c : 0, px: c / (img.width * img.height), mottle,
        bgHue, bgSat: bgS / bgC, bgLight: bgL / bgC,
      };
      cell.clay = clay;
      cells.push(cell);
      console.log(`${wlabel.padEnd(6)} ${String(hour).padStart(2)}時  本体 H ${hue.toFixed(3)} S ${cell.sat.toFixed(3)} L ${cell.light.toFixed(3)}` +
        `  背景 H ${bgHue.toFixed(3)} L ${cell.bgLight.toFixed(3)}` +
        `  ムラ ${mottle.toFixed(3)}` +
        (clay ? `  | 粘土基準 H ${clay.hueBase.toFixed(3)} (天気 ${clay.wxHue >= 0 ? '+' : ''}${clay.wxHue.toFixed(3)} / 時刻 ${clay.hourHue >= 0 ? '+' : ''}${clay.hourHue.toFixed(3)})` +
          ` 2極 ${clay.warmHue.toFixed(2)}↔${clay.coolHue.toFixed(2)} ノイズ ±${clay.hueNoiseSpan.toFixed(2)}` : ''));
    }
  }

  // --- 広がり ---
  console.log('\n=== 広がり（本体の色）===');
  for (const hour of HOURS) {
    const row = cells.filter((c) => c.hour === hour);
    console.log(`${String(hour).padStart(2)}時 固定 → 天気ぶんの色相の広がり ${hueSpread(row.map((c) => c.hue)).toFixed(3)}` +
      ` / 彩度 ${(Math.max(...row.map((c) => c.sat)) - Math.min(...row.map((c) => c.sat))).toFixed(3)}` +
      ` / 明度 ${(Math.max(...row.map((c) => c.light)) - Math.min(...row.map((c) => c.light))).toFixed(3)}`);
  }
  for (const [wid, wlabel] of WEATHERS) {
    const col = cells.filter((c) => c.weather === wid);
    console.log(`${wlabel.padEnd(6)} 固定 → 時刻ぶんの色相の広がり ${hueSpread(col.map((c) => c.hue)).toFixed(3)}` +
      ` / 彩度 ${(Math.max(...col.map((c) => c.sat)) - Math.min(...col.map((c) => c.sat))).toFixed(3)}` +
      ` / 明度 ${(Math.max(...col.map((c) => c.light)) - Math.min(...col.map((c) => c.light))).toFixed(3)}`);
  }
  console.log(`\n全 ${cells.length} セットの色相の広がり ${hueSpread(cells.map((c) => c.hue)).toFixed(3)}` +
    `（0.5 が最大＝補色）／彩度 ${(Math.max(...cells.map((c) => c.sat)) - Math.min(...cells.map((c) => c.sat))).toFixed(3)}` +
    `／明度 ${(Math.max(...cells.map((c) => c.light)) - Math.min(...cells.map((c) => c.light))).toFixed(3)}`);
  const cl = cells.filter((c) => c.clay);
  if (cl.length) {
    const span = (f) => Math.max(...cl.map(f)) - Math.min(...cl.map(f));
    console.log('\n=== どの段で環境の信号が消えているか ===');
    console.log(`天気シフト（設計値）の色相の幅   ${span((c) => c.clay.wxHue).toFixed(3)}`);
    console.log(`時刻シフト（設計値）の色相の幅   ${span((c) => c.clay.hourHue).toFixed(3)}`);
    console.log(`粘土の基準色相（追従後）の幅     ${hueSpread(cl.map((c) => c.clay.hueBase)).toFixed(3)}`);
    console.log(`**画面上の本体色相の幅**         ${hueSpread(cl.map((c) => c.hue)).toFixed(3)}`);
    console.log(`面内ノイズの振れ幅（±）          ${cl[0].clay.hueNoiseSpan.toFixed(3)}  ← これより小さい信号は埋もれる`);
    console.log(`面内混色の2極                    暖 ${cl[0].clay.warmHue.toFixed(3)} ↔ 寒 ${cl[0].clay.coolHue.toFixed(3)}`);
    const mott = cells.reduce((a, c) => a + c.mottle, 0) / cells.length;
    const envSpan = hueSpread(cl.map((c) => c.hue));
    console.log(`\n**面内のムラ（円周 sd）        ${mott.toFixed(3)}**`);
    console.log(`**環境で動く幅               ${envSpan.toFixed(3)}**`);
    console.log(`ムラ ÷ 環境                  ${(mott / Math.max(1e-6, envSpan)).toFixed(2)}` +
      `  ← 1 を大きく超えるほど「今日の色」ではなく「まだら」に見える`);
  }
  console.log('console errors:', errs.length);

  // --- 並べた 1 枚 ---
  const cell = 250;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d1117;color:#e8eef5;font:13px -apple-system,"Hiragino Sans",sans-serif}
    table{border-collapse:collapse;margin:12px}
    td,th{padding:4px;text-align:center;font-size:12px}
    img{width:${cell}px;height:${cell}px;display:block;border-radius:4px}
    .cap{opacity:.75;font-size:11px;padding-top:3px}
  </style><table>
  <caption style="text-align:left;padding:8px 4px;font-size:14px">振れ幅 天気 ${wGain} / 時刻 ${hGain}
    / 面内の色相ムラ ${noise}
    — 画面上の本体色相の広がり ${hueSpread(cells.map((c) => c.hue)).toFixed(3)}
    ／面内のムラ ${(cells.reduce((a, c) => a + c.mottle, 0) / cells.length).toFixed(3)}</caption>
  <tr><th></th>${HOURS.map((h) => `<th>${h}時</th>`).join('')}</tr>
  ${WEATHERS.map(([wid, wlabel]) => `<tr><th>${wlabel}</th>${HOURS.map((h) => {
    const c = cells.find((x) => x.weather === wid && x.hour === h);
    return `<td><img src="data:image/png;base64,${fs.readFileSync(c.file).toString('base64')}">
      <div class="cap">H ${c.hue.toFixed(2)} S ${c.sat.toFixed(2)} L ${c.light.toFixed(2)}</div></td>`;
  }).join('')}</tr>`).join('')}
  </table>`;
  const q = await b.newPage();
  await q.setViewport({ width: HOURS.length * (cell + 16) + 90, height: WEATHERS.length * (cell + 34) + 60 });
  await q.setContent(html, { waitUntil: 'networkidle0' });
  await q.screenshot({ path: path.join(outDir, 'grid.png'), fullPage: true });
  await b.close();
  console.log('saved', path.join(outDir, 'grid.png'));
})().catch((e) => { console.error(e); process.exit(1); });
