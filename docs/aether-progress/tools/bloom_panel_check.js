// dev チューニングパネルのブルームスライダーが実際に描画へ効いているかを確認する。
//
// 目的: 「スライダーは付いたが uniform が繋がっていない」を無音でも検出すること。
// （強度が適切かどうかは無音では判断できない＝それは実機で曲を鳴らして決める。
//   ここで見るのは配線が生きているかどうかだけ。）
//
// やること:
//   1. #bloom-sliders に range が2本できているか
//   2. 同一ロード内で strength を 0 → 最大へ動かし、canvas のピクセルが変わるか
//      （シードはロードごとにランダムなので、必ず同一ロード内で A/B を取る）
//   3. ブルーム ON/OFF ボタンで元に戻るか
//
// 使い方: node bloom_panel_check.js [URL] [待ちms] [complete]
//   第3引数に 1 を渡すと #complete-sculpture を押して完成状態にしてから測る。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const setSlider = (index, value) => {
  const inputs = [...document.querySelectorAll('#bloom-sliders input[type="range"]')];
  const input = inputs[index];
  if (!input) return null;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(input.value);
};

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=vita';
  const wait = Number(process.argv[3] || 8000);
  const doComplete = process.argv[4] === '1';
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

  const panel = await p.evaluate(() => {
    const el = document.querySelector('#bloom-panel');
    const inputs = [...document.querySelectorAll('#bloom-sliders input[type="range"]')];
    return {
      panelFound: Boolean(el),
      panelHidden: el ? el.hidden : null,
      sliderCount: inputs.length,
      ranges: inputs.map(i => `${i.min}..${i.max} step ${i.step} = ${i.value}`),
      labels: [...document.querySelectorAll('#bloom-sliders .tuning-slider__label')].map(e => e.textContent),
      exportHasBloom: (document.querySelector('#tuning-export-text')?.value ?? '').includes('ブルーム'),
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

  // 同一ロード内で値を振って canvas を比較する。
  // 星の瞬きで無関係の差も出るので「平均差」では測らない（handoff/VITA.md 6章）。
  // 加算ブルームは必ず明るくなる方向なので、最大増分と増えた画素の割合で見る。
  let n = 0;
  const shot = async () => {
    const file = path.join(os.tmpdir(), `bloom-check-${n++}.png`);
    await p.screenshot({ path: file });
    return decode(file);
  };
  const brighter = (a, b) => {
    let maxUp = 0, up = 0, px = 0;
    for (let i = 0; i < a.data.length; i += a.bpp) {
      px += 1;
      let d = 0;
      for (let c = 0; c < 3; c += 1) d = Math.max(d, b.data[i + c] - a.data[i + c]);
      if (d > 6) up += 1; // 6/255 未満は星の瞬き等のノイズとして捨てる
      if (d > maxUp) maxUp = d;
    }
    return { maxUp, upPct: ((up / px) * 100).toFixed(2) + '%' };
  };
  // 白飛び（3チャンネルとも 250 以上）。既定値を強くしたときに一番効くのがここ。
  const blownOut = (img) => {
    let blown = 0, px = 0;
    for (let i = 0; i < img.data.length; i += img.bpp) {
      px += 1;
      if (img.data[i] >= 250 && img.data[i + 1] >= 250 && img.data[i + 2] >= 250) blown += 1;
    }
    return ((blown / px) * 100).toFixed(3) + '%';
  };

  // UI を隠して canvas だけを測る（vita_shot.js と同じ手法）。
  // パネルの白い背景が白飛び率に混ざると、過去の canvas 実測値と比較できなくなる。
  // visibility:hidden にしてもボタンは element.click() で叩けるので操作は続けられる。
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise(r => setTimeout(r, 500));

  // まず「既定値のまま」の ON / OFF を測る（bloom-pass.ts の DEFAULT_BLOOM_* の妥当性確認）
  const defaultOn = await shot();
  await p.evaluate(() => document.querySelector('#toggle-bloom')?.click());
  await new Promise(r => setTimeout(r, 600));
  const defaultOff = await shot();
  await p.evaluate(() => document.querySelector('#toggle-bloom')?.click());
  await new Promise(r => setTimeout(r, 600));
  console.log('既定値 ON vs OFF:', JSON.stringify(brighter(defaultOff, defaultOn)));
  console.log('既定値の白飛び: ON', blownOut(defaultOn), '/ OFF', blownOut(defaultOff));

  await p.evaluate(setSlider, 1, 0); // strength = 0
  await new Promise(r => setTimeout(r, 600));
  const off = await shot();

  const applied = await p.evaluate(setSlider, 1, 3); // strength = 最大
  await new Promise(r => setTimeout(r, 600));
  const on = await shot();
  console.log('strength slider applied value:', applied);
  console.log('strength 0 → 3:', JSON.stringify(brighter(off, on)));

  // threshold も動くか（下げれば拾う画素が増えるので、さらに明るくなるはず）
  const th = await p.evaluate(setSlider, 0, 0.2);
  await new Promise(r => setTimeout(r, 600));
  const lowTh = await shot();
  console.log('threshold slider applied value:', th);
  console.log('threshold 0.9 → 0.2 (strength 3 のまま):', JSON.stringify(brighter(on, lowTh)));

  // 既定に戻す → ON/OFF
  const toggled = await p.evaluate(() => {
    document.querySelector('#reset-bloom')?.click();
    const inputs = [...document.querySelectorAll('#bloom-sliders input[type="range"]')];
    const after = inputs.map(i => Number(i.value));
    document.querySelector('#toggle-bloom')?.click();
    const offLabel = document.querySelector('#toggle-bloom')?.textContent?.trim();
    document.querySelector('#toggle-bloom')?.click();
    const onLabel = document.querySelector('#toggle-bloom')?.textContent?.trim();
    return { afterReset: after, offLabel, onLabel };
  });
  console.log('reset/toggle:', JSON.stringify(toggled));

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'console errors: 0');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
