// vita の「映り込み」（vita-environment.ts の暗い環境マップ）が
// 実際に描画へ効いているか・明るさをどれだけ足しているかを測る。
//
// なぜ測るか: 過去に RoomEnvironment を scene.environment に入れて画面全体が
// 白く洗われた（docs/handoff/VITA.md 5章）。同じ失敗を繰り返さないため、
// 「効いていること」と「全体を明るくしていないこと」を分けて数値で見る。
//
// やること（すべて同一ロード内。シードはロードごとにランダムなので）:
//   1. #env-sliders に range が1本できているか
//   2. 映り込み ON / OFF での canvas の差（最大増分・変化画素の割合・平均輝度差）
//   3. 白飛び率が増えていないか
//   4. intensity 0 → 1.5 で差が出るか（uniform まで届いているかの配線確認）
//
// 使い方: node env_panel_check.js [URL] [待ちms] [complete] [PNG出力先の接頭辞]
//   第3引数に 1 を渡すと #complete-sculpture を押して完成状態にしてから測る。
//   第4引数を渡すと <接頭辞>-on.png / <接頭辞>-off.png を保存する。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const setIntensity = (value) => {
  const input = document.querySelector('#env-sliders input[type="range"]');
  if (!input) return null;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(input.value);
};

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=vita';
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
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, wait));

  const panel = await p.evaluate(() => {
    const el = document.querySelector('#env-panel');
    const inputs = [...document.querySelectorAll('#env-sliders input[type="range"]')];
    return {
      panelFound: Boolean(el),
      panelHidden: el ? el.hidden : null,
      sliderCount: inputs.length,
      ranges: inputs.map(i => `${i.min}..${i.max} step ${i.step} = ${i.value}`),
      exportHasEnv: (document.querySelector('#tuning-export-text')?.value ?? '').includes('映り込み'),
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
    const target = file || path.join(os.tmpdir(), `env-check-${n++}.png`);
    await p.screenshot({ path: target });
    return decode(target);
  };
  // 星の瞬きで無関係の差が出るため「画像全体の平均差」だけで判断しない
  // （handoff/VITA.md 6章）。増分・減分の両方と、変化画素の割合を見る。
  const diff = (a, b) => {
    let maxUp = 0, maxDown = 0, up = 0, down = 0, px = 0, sumA = 0, sumB = 0;
    const luma = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    for (let i = 0; i < a.data.length; i += a.bpp) {
      px += 1;
      sumA += luma(a, i); sumB += luma(b, i);
      let d = 0;
      for (let c = 0; c < 3; c += 1) d = Math.max(d, b.data[i + c] - a.data[i + c]);
      let e = 0;
      for (let c = 0; c < 3; c += 1) e = Math.max(e, a.data[i + c] - b.data[i + c]);
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

  // UI を隠して canvas だけ測る（vita_shot.js / bloom_panel_check.js と同じ手法）。
  // visibility:hidden にしてもボタンは element.click() で叩ける。
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise(r => setTimeout(r, 500));

  // ノイズ床: 何も変えずに2枚撮る。vita は無音でもアイドル揺らぎ・星の瞬きで
  // 形が動くので、この値を超えた差でなければ「効いた」とは言えない。
  const noiseA = await shot();
  await new Promise(r => setTimeout(r, 700));
  const noiseB = await shot();
  console.log('ノイズ床（変更なしで2枚）:', JSON.stringify(diff(noiseA, noiseB)));

  // 既定値のまま ON / OFF
  const on = await shot(outPrefix ? `${outPrefix}-on.png` : null);
  await p.evaluate(() => document.querySelector('#toggle-env')?.click());
  await new Promise(r => setTimeout(r, 700));
  const off = await shot(outPrefix ? `${outPrefix}-off.png` : null);
  await p.evaluate(() => document.querySelector('#toggle-env')?.click());
  await new Promise(r => setTimeout(r, 700));
  console.log('既定値 OFF → ON:', JSON.stringify(diff(off, on)));
  console.log('白飛び: ON', blownOut(on), '/ OFF', blownOut(off));

  // スライダーの配線確認（0 → 最大）
  await p.evaluate(setIntensity, 0);
  await new Promise(r => setTimeout(r, 700));
  const zero = await shot();
  const applied = await p.evaluate(setIntensity, 1.5);
  await new Promise(r => setTimeout(r, 700));
  const max = await shot();
  console.log('intensity slider applied value:', applied);
  console.log('intensity 0 → 1.5:', JSON.stringify(diff(zero, max)));
  console.log('intensity 1.5 の白飛び:', blownOut(max));

  // 完成後は呼吸で形が動き続けるため、1組の A/B ではノイズ床に埋もれる
  // （実測: 完成状態のノイズ床は平均輝度差 1.3/255 で、既定値の効果より大きい）。
  // ON/OFF を交互に何度も切り替えて平均を取れば、動きぶんは打ち消える。
  const meanLuma = (img) => {
    let sum = 0, px = 0;
    for (let i = 0; i < img.data.length; i += img.bpp) {
      px += 1;
      sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    }
    return sum / px;
  };
  await p.evaluate(() => document.querySelector('#reset-env')?.click());
  await new Promise(r => setTimeout(r, 700));
  const rounds = 5;
  const onMeans = [], offMeans = [];
  for (let i = 0; i < rounds; i += 1) {
    onMeans.push(meanLuma(await shot()));
    await p.evaluate(() => document.querySelector('#toggle-env')?.click());
    await new Promise(r => setTimeout(r, 400));
    offMeans.push(meanLuma(await shot()));
    await p.evaluate(() => document.querySelector('#toggle-env')?.click());
    await new Promise(r => setTimeout(r, 400));
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  // 各ラウンド内の ON−OFF（0.4秒差の2枚）。呼吸のゆっくりした動きは対で打ち消えるので、
  // 全ラウンドで符号が揃っていれば「効いている」と言える。
  const paired = onMeans.map((v, i) => v - offMeans[i]);
  console.log(
    `ON/OFF を${rounds}回交互に測った平均輝度: ON ${avg(onMeans).toFixed(3)} / OFF ${avg(offMeans).toFixed(3)}`
    + ` → 差 ${(avg(onMeans) - avg(offMeans)).toFixed(3)}/255`
    + `（各状態内のばらつき ON ${spread(onMeans).toFixed(3)} / OFF ${spread(offMeans).toFixed(3)}）`,
  );
  console.log(
    'ラウンドごとの ON−OFF:', paired.map(v => v.toFixed(3)).join(', '),
    `→ 平均 ${avg(paired).toFixed(3)}/255・正の回数 ${paired.filter(v => v > 0).length}/${rounds}`,
  );

  const reset = await p.evaluate(() => {
    document.querySelector('#reset-env')?.click();
    const input = document.querySelector('#env-sliders input[type="range"]');
    const after = input ? Number(input.value) : null;
    document.querySelector('#toggle-env')?.click();
    const offLabel = document.querySelector('#toggle-env')?.textContent?.trim();
    document.querySelector('#toggle-env')?.click();
    const onLabel = document.querySelector('#toggle-env')?.textContent?.trim();
    return { afterReset: after, offLabel, onLabel };
  });
  console.log('reset/toggle:', JSON.stringify(reset));

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'console errors: 0');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
