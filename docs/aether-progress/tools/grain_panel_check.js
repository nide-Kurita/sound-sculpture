// vita の「粘土の肌理」（clay-grain.ts のシェーダ側法線摂動）が
// 実際に描画へ効いているかを測る。
//
// なぜ測るか: この機能の目的は「三角形が大きいせいで面の境目が読めてしまう」のを
// 崩すこと。つまり狙いは**局所コントラスト（高周波成分）を増やすこと**であって、
// 画面を明るくすることではない。だから見るべき数字は平均輝度ではなく
// 「隣接画素の差の総量」。ここを取り違えると、ブルームのときと同じく
// 「効いていないのに効いていることにする」誤診になる（docs/handoff/VITA.md 3章）。
//
// やること（すべて同一ロード内。シードはロードごとにランダムなので）:
//   1. #grain-sliders に range が2本できているか
//   2. 肌理 ON / OFF での中央領域の勾配エネルギー（＝きめの量）の差
//   3. 平均輝度がほとんど動いていないこと（明るさを足す機能ではない）
//   4. 白飛びが増えていないこと
//   5. strength・scale スライダーが uniform まで届いているか
//   6. ON/OFF のフレーム時間（swiftshader なので絶対値ではなく相対の目安）
//
// 使い方: node grain_panel_check.js [URL] [待ちms] [complete] [PNG出力先の接頭辞]
//   第3引数に 1 を渡すと #complete-sculpture を押して完成状態にしてから測る。
//   第4引数を渡すと <接頭辞>-on.png / <接頭辞>-off.png を保存する。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const setSlider = (index, value) => {
  const inputs = [...document.querySelectorAll('#grain-sliders input[type="range"]')];
  const input = inputs[index];
  if (!input) return null;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(input.value);
};

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=vita&surface=dev';
  const wait = Number(process.argv[3] || 8000);
  const doComplete = process.argv[4] === '1';
  const outPrefix = process.argv[5] || null;
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  // 測定の途中でリロードが挟まると UI が再表示されて数字が壊れる。黙って進めない。
  let navigations = 0;
  p.on('framenavigated', f => { if (f === p.mainFrame()) navigations += 1; });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, wait));

  const panel = await p.evaluate(() => {
    const el = document.querySelector('#grain-panel');
    const inputs = [...document.querySelectorAll('#grain-sliders input[type="range"]')];
    return {
      panelFound: Boolean(el),
      panelHidden: el ? el.hidden : null,
      sliderCount: inputs.length,
      ranges: inputs.map(i => `${i.min}..${i.max} step ${i.step} = ${i.value}`),
      exportHasGrain: (document.querySelector('#tuning-export-text')?.value ?? '').includes('肌理'),
    };
  });
  console.log('panel:', JSON.stringify(panel, null, 2));

  if (doComplete) {
    const r = await p.evaluate(() => {
      const btn = document.querySelector('#complete-sculpture');
      if (!btn) return 'no-button';
      btn.disabled = false; btn.click();
      return 'clicked';
    });
    console.log('complete:', r);
    await new Promise(r => setTimeout(r, 9000)); // 完成アニメーション6秒 + 余裕
  }

  let n = 0;
  const shot = async (file) => {
    const target = file || path.join(os.tmpdir(), `grain-check-${n++}.png`);
    await p.screenshot({ path: target });
    return decode(target);
  };

  const luma = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];

  // 中央の 50% だけを見る。背景ドームは滑らかで、星は瞬いて無関係の高周波を出すので、
  // 彫刻がほぼ確実に占める範囲へ絞る（vita は画面中央に1体だけ）。
  const box = (img) => {
    const x0 = Math.floor(img.width * 0.25), x1 = Math.floor(img.width * 0.75);
    const y0 = Math.floor(img.height * 0.25), y1 = Math.floor(img.height * 0.75);
    return { x0, x1, y0, y1 };
  };
  // 勾配エネルギー = 隣接画素の輝度差の平均。肌理が乗ればここが増える。
  const gradientEnergy = (img) => {
    const { x0, x1, y0, y1 } = box(img);
    const stride = img.width * img.bpp;
    let sum = 0, count = 0;
    for (let y = y0; y < y1 - 1; y += 1) {
      for (let x = x0; x < x1 - 1; x += 1) {
        const i = y * stride + x * img.bpp;
        const l = luma(img, i);
        sum += Math.abs(luma(img, i + img.bpp) - l) + Math.abs(luma(img, i + stride) - l);
        count += 1;
      }
    }
    return sum / count;
  };
  // 大域の陰影コントラスト = 16x16 で平均を取って潰したあとの輝度の標準偏差。
  // 肌理を強くしすぎると法線がランダム化して拡散光が平均化し、
  // 「立体の陰影」そのものが平坦になる。高周波が増えても**ここが下がるなら行き過ぎ**。
  const shadingContrast = (img) => {
    const { x0, x1, y0, y1 } = box(img);
    const stride = img.width * img.bpp;
    const cell = 16;
    const values = [];
    for (let y = y0; y + cell <= y1; y += cell) {
      for (let x = x0; x + cell <= x1; x += cell) {
        let sum = 0;
        for (let dy = 0; dy < cell; dy += 1) {
          for (let dx = 0; dx < cell; dx += 1) {
            sum += luma(img, (y + dy) * stride + (x + dx) * img.bpp);
          }
        }
        values.push(sum / (cell * cell));
      }
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  };
  const meanLumaBox = (img) => {
    const { x0, x1, y0, y1 } = box(img);
    const stride = img.width * img.bpp;
    let sum = 0, count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        sum += luma(img, y * stride + x * img.bpp);
        count += 1;
      }
    }
    return sum / count;
  };
  const diff = (a, b) => {
    let maxUp = 0, maxDown = 0, up = 0, down = 0, px = 0, sumA = 0, sumB = 0;
    for (let i = 0; i < a.data.length; i += a.bpp) {
      px += 1;
      sumA += luma(a, i); sumB += luma(b, i);
      let d = 0, e = 0;
      for (let c = 0; c < 3; c += 1) {
        d = Math.max(d, b.data[i + c] - a.data[i + c]);
        e = Math.max(e, a.data[i + c] - b.data[i + c]);
      }
      if (d > 6) up += 1;
      if (e > 6) down += 1;
      if (d > maxUp) maxUp = d;
      if (e > maxDown) maxDown = e;
    }
    return {
      maxUp, maxDown,
      upPct: ((up / px) * 100).toFixed(2) + '%',
      downPct: ((down / px) * 100).toFixed(2) + '%',
      meanLumaDelta: ((sumB - sumA) / px).toFixed(3),
    };
  };
  const blownOut = (img) => {
    let blown = 0, px = 0;
    for (let i = 0; i < img.data.length; i += img.bpp) {
      px += 1;
      if (img.data[i] >= 250 && img.data[i + 1] >= 250 && img.data[i + 2] >= 250) blown += 1;
    }
    return ((blown / px) * 100).toFixed(3) + '%';
  };

  // UI を隠して canvas だけ測る（env_panel_check.js と同じ手法）。
  const hideUi = () => p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await hideUi();
  await new Promise(r => setTimeout(r, 500));

  // ノイズ床: 何も変えずに2枚。アイドル揺らぎと星の瞬きでこのぶんは常に動く。
  const noiseA = await shot();
  await new Promise(r => setTimeout(r, 700));
  const noiseB = await shot();
  console.log('ノイズ床（変更なしで2枚）:', JSON.stringify(diff(noiseA, noiseB)));
  console.log('ノイズ床の勾配エネルギー差:',
    (gradientEnergy(noiseB) - gradientEnergy(noiseA)).toFixed(4));

  // 既定値のまま ON / OFF
  const on = await shot(outPrefix ? `${outPrefix}-on.png` : null);
  await p.evaluate(() => document.querySelector('#toggle-grain')?.click());
  await new Promise(r => setTimeout(r, 700));
  const off = await shot(outPrefix ? `${outPrefix}-off.png` : null);
  await p.evaluate(() => document.querySelector('#toggle-grain')?.click());
  await new Promise(r => setTimeout(r, 700));
  console.log('既定値 OFF → ON:', JSON.stringify(diff(off, on)));
  console.log('勾配エネルギー（中央50%）: OFF', gradientEnergy(off).toFixed(4),
    '→ ON', gradientEnergy(on).toFixed(4),
    `（${(((gradientEnergy(on) / gradientEnergy(off)) - 1) * 100).toFixed(1)}%）`);
  console.log('中央50%の平均輝度: OFF', meanLumaBox(off).toFixed(3), '→ ON', meanLumaBox(on).toFixed(3));
  console.log('白飛び: ON', blownOut(on), '/ OFF', blownOut(off));

  // strength スイープ。配線確認と「どこから行き過ぎか」を1つの表で見る。
  // 待機中もアイドル揺らぎで形が動くので、2巡して平均を取る（1巡だけだとノイズ床に埋もれる）。
  const sweepValues = [0, 0.35, 0.55, 0.9, 1.4, 2];
  const sweep = new Map(sweepValues.map(v => [v, { grad: [], shade: [], blown: [] }]));
  for (let pass = 0; pass < 2; pass += 1) {
    for (const value of sweepValues) {
      const applied = await p.evaluate(setSlider, 0, value);
      if (pass === 0 && applied !== value) console.log(`  !! strength ${value} が反映されていない (=${applied})`);
      await hideUi();
      await new Promise(r => setTimeout(r, 700));
      const img = await shot();
      const rec = sweep.get(value);
      rec.grad.push(gradientEnergy(img));
      rec.shade.push(shadingContrast(img));
      rec.blown.push(Number(blownOut(img).replace('%', '')));
    }
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const base = sweep.get(0);
  console.log('strength スイープ（中央50%・2巡の平均）');
  console.log('  strength |  肌理(勾配E)  |  大域の陰影(σ) | 白飛び');
  for (const value of sweepValues) {
    const rec = sweep.get(value);
    const g = avg(rec.grad), s = avg(rec.shade);
    console.log(
      `  ${String(value).padStart(8)} | ${g.toFixed(4)} (${(((g / avg(base.grad)) - 1) * 100).toFixed(0).padStart(4)}%)` +
      ` | ${s.toFixed(3)} (${(((s / avg(base.shade)) - 1) * 100).toFixed(0).padStart(4)}%)` +
      ` | ${avg(rec.blown).toFixed(3)}%`,
    );
  }

  await p.evaluate(() => document.querySelector('#reset-grain')?.click());
  await new Promise(r => setTimeout(r, 700));
  const scaleLow = await p.evaluate(setSlider, 1, 4);
  await new Promise(r => setTimeout(r, 700));
  const scaleLowShot = await shot();
  const scaleHigh = await p.evaluate(setSlider, 1, 80);
  await new Promise(r => setTimeout(r, 700));
  const scaleHighShot = await shot();
  console.log(`scale slider applied: ${scaleLow} → ${scaleHigh}`);
  console.log('scale 4 → 80:', JSON.stringify(diff(scaleLowShot, scaleHighShot)));
  console.log('  勾配エネルギー:', gradientEnergy(scaleLowShot).toFixed(4),
    '→', gradientEnergy(scaleHighShot).toFixed(4));

  // フレーム時間。swiftshader（ソフトウェアラスタライザ）なので絶対値は実機と無関係だが、
  // 「フラグメントで毎画素 fbm を回すコスト」の相対的な大きさの目安にはなる。
  await p.evaluate(() => document.querySelector('#reset-grain')?.click());
  await new Promise(r => setTimeout(r, 700));
  const frameMs = () => new Promise(resolve => {
    const samples = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      samples.push(now - last);
      last = now;
      if (samples.length < 60) requestAnimationFrame(tick);
      else {
        samples.sort((a, b) => a - b);
        resolve(samples[Math.floor(samples.length / 2)]);
      }
    };
    requestAnimationFrame(tick);
  });
  // 1組だけだと swiftshader の揺れで符号が逆転する（実際に逆転した）。
  // 3組取って、全組で同じ符号かどうかで判断する。
  const onMs = [], offMs = [];
  for (let i = 0; i < 3; i += 1) {
    onMs.push(await p.evaluate(frameMs));
    await p.evaluate(() => document.querySelector('#toggle-grain')?.click());
    await new Promise(r => setTimeout(r, 400));
    offMs.push(await p.evaluate(frameMs));
    await p.evaluate(() => document.querySelector('#toggle-grain')?.click());
    await new Promise(r => setTimeout(r, 400));
  }
  const paired = onMs.map((v, i) => v - offMs[i]);
  console.log('フレーム時間の中央値（swiftshader・相対の目安・3組）:');
  console.log('  ON :', onMs.map(v => v.toFixed(1)).join(' / '));
  console.log('  OFF:', offMs.map(v => v.toFixed(1)).join(' / '));
  console.log('  ON-OFF:', paired.map(v => v.toFixed(1)).join(' / '),
    paired.every(v => v > 0) ? '（全組で ON が遅い）'
      : paired.every(v => v < 0) ? '（全組で ON が速い＝測れていない）'
        : '（符号がばらつく＝この環境では差を測れない）');

  console.log('測定中のリロード回数（1 = 最初の goto のみ＝正常）:', navigations);
  console.log('console errors:', errs.length ? errs : 'none');
  await b.close();
})();
