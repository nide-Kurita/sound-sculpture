// **接線流（段A1 作り直し・2026-08-25）の見た目 A/B。**
//
// 「打点と別チャンネルにしたから見えるはず」は仮説なので、**同一ロード内**で
// 接線流 OFF / ON を交互に切り替えて、連続フレームのストリップと
// 隣接フレーム差（＝画面が実際にどれだけ変化したか）を並べる。
//
// 交互にするのは、OFF 区間と ON 区間で曲の中身が変わってしまうため。
// 数サイクル繰り返して平均すれば音楽的な差はならされる。
// 切り替えは **#voice-panel のスライダーを実際に動かす**（ユーザーと同じ経路）。
//
// 使い方: node flow_ab.js <出力.png> <曲名の一部> [開始秒=45] [サイクル=3] [枚数/相=4] [間隔ms=150]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';
const FLOW_INDEX = 1; // #voice-sliders の並び: sense, flowAmp, bandOpen, waveAmp, waveSpeed, bandGain

(async () => {
  const out = process.argv[2];
  const hint = process.argv[3] || 'ロビンソン';
  const startSec = Number(process.argv[4] || 45);
  const cycles = Number(process.argv[5] || 3);
  const shots = Number(process.argv[6] || 4);
  const gapMs = Number(process.argv[7] || 150);
  // ON 側の値。既定 1（＝DEFAULT のまま）。「ゲインを上げれば見えるのか」を測るとき用
  const onVal = Number(process.argv[8] || 1);
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 620, height: 620 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent.trim();
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await b.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, startSec * 1000));

  const setFlow = (v) => p.evaluate((idx, val) => {
    const input = document.querySelectorAll('#voice-sliders input[type=range]')[idx];
    if (!input) throw new Error('#voice-sliders が空');
    input.value = String(val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, FLOW_INDEX, v);

  // UI を隠す（面積最大の canvas を残す）。スライダーは hidden でも操作できる。
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 300));

  const phases = { off: [], on: [] };
  // --- 制御実験: 音楽の進行ぶんを差し引いて「接線流だけ」の視覚寄与を出す ---
  //
  // OFF 区間と ON 区間を別々に撮って比べると、**画面の変化は打点フラッシュと粒子が支配的**で、
  // 音楽の内容差に完全に埋もれる（2026-08-25 に交互 3 サイクルで -35% という逆符号が出た）。
  // そこで 1 トライアルで 3 枚を連続で撮る:
  //   S1(流 ON) → S2(流 OFF) → S3(流 ON)   ※間隔はスクリーンショット遅延 δ で一定
  //   d12, d23 = 音楽(δ) + 接線流の効果 ／ d13 = 音楽(2δ) のみ（両方 ON）
  // 音楽の寄与が時間に概ね比例するとすれば 音楽(δ) ≈ d13/2 なので、
  //   接線流の効果 ≈ (d12+d23)/2 − d13/2
  // 切り替えは positions への直接の倍率なので**追従の遅れが無く即時**に効く。
  //
  // **同じ方法で「径方向の波」も測る。** ユーザーが 2026-08-25 の実機で
  // 「ロビンソンではほぼ分からない」と判定したのが径の波なので、これが
  // **「見えない」側の基準線**になる。接線流がこれを大きく上回るかどうかが本題。
  const setSlider = (idx, val) => p.evaluate((i, v) => {
    const input = document.querySelectorAll('#voice-sliders input[type=range]')[i];
    if (!input) throw new Error('#voice-sliders が空');
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, idx, val);
  const CHANNELS = [
    { name: '接線流（2026-08-25 の新チャンネル）', idx: FLOW_INDEX },
    { name: '径の波（実機で「ほぼ分からない」と判定された側）', idx: 3 },
  ];
  const trialsByChannel = {};
  for (const ch of CHANNELS) {
    const t = [];
    for (let c = 0; c < cycles * 3; c += 1) {
      await setSlider(ch.idx, onVal);
      const s1 = await p.screenshot({ encoding: 'base64' });
      await setSlider(ch.idx, 0);
      const s2 = await p.screenshot({ encoding: 'base64' });
      await setSlider(ch.idx, onVal);
      const s3 = await p.screenshot({ encoding: 'base64' });
      t.push([s1, s2, s3]);
      await new Promise((r) => setTimeout(r, 250));
    }
    trialsByChannel[ch.name] = t;
  }
  const trials = trialsByChannel[CHANNELS[0].name];

  // --- 見た目のストリップ（OFF / ON を交互に撮る。数値ではなく目視用）---
  for (let c = 0; c < cycles; c += 1) {
    for (const [name, val] of [['off', 0], ['on', 1]]) {
      await setFlow(val);
      await new Promise((r) => setTimeout(r, 500));
      const frames = [];
      for (let i = 0; i < shots; i += 1) {
        frames.push(await p.screenshot({ encoding: 'base64' }));
        if (i < shots - 1) await new Promise((r) => setTimeout(r, gapMs));
      }
      phases[name].push(frames);
    }
  }
  await setFlow(1);
  await b.close();

  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  const q = await b2.newPage();
  await q.setViewport({ width: 700, height: 700 });

  const lumDiff = (all) => q.evaluate(async (groups) => {
    const load = (b64) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b64;
    });
    const cv = document.createElement('canvas');
    const outs = [];
    for (const g of groups) {
      const imgs = []; for (const f of g) imgs.push(await load(f));
      cv.width = imgs[0].width; cv.height = imgs[0].height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const grab = (im) => { ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0);
        return ctx.getImageData(0, 0, cv.width, cv.height).data; };
      const px = imgs.map(grab);
      const diff = (a, b) => {
        let sum = 0, n = 0;
        for (let k = 0; k < a.length; k += 4) {
          const x = a[k] * 0.299 + a[k + 1] * 0.587 + a[k + 2] * 0.114;
          const y = b[k] * 0.299 + b[k + 1] * 0.587 + b[k + 2] * 0.114;
          sum += Math.abs(x - y); n += 1;
        }
        return sum / n / 255;
      };
      outs.push(px.length === 3
        ? { d12: diff(px[0], px[1]), d23: diff(px[1], px[2]), d13: diff(px[0], px[2]) }
        : px.slice(1).map((_, i) => diff(px[i], px[i + 1])));
    }
    return outs;
  }, all);

  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const results = [];
  for (const ch of CHANNELS) {
    const c = await lumDiff(trialsByChannel[ch.name]);
    const sw = avg(c.map((t) => (t.d12 + t.d23) / 2));
    const mu = avg(c.map((t) => t.d13 / 2));
    results.push({ name: ch.name, sw, mu, effect: sw - mu });
  }
  const mSwitch = results[0].sw, mMusic = results[0].mu, flowEffect = results[0].effect;

  const dOffG = await lumDiff(phases.off);
  const dOnG = await lumDiff(phases.on);
  const dOff = dOffG.flat(), dOn = dOnG.flat();
  const mOff = avg(dOff), mOn = avg(dOn);

  const cell = 280;
  const row = (frames, diffs, label, color) => `
    <h2 style="color:${color}">${label}</h2>
    <div class="row">${frames.map((f, i) => `<figure><img src="data:image/png;base64,${f}">
      <figcaption>${i === 0 ? '基準' : `+${i * gapMs}ms / 差 ${(diffs[i - 1] * 100).toFixed(2)}%`}</figcaption></figure>`).join('')}</div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12161c;color:#e8eef5;font:14px/1.4 -apple-system,"Hiragino Sans",sans-serif}
    .row{display:grid;grid-template-columns:repeat(${shots},${cell}px);gap:8px;padding:6px 14px 14px}
    img{width:${cell}px;height:${cell}px;display:block;border-radius:4px}
    figcaption{padding:6px 2px 0;font-size:12px;opacity:.85}
    h1{font-size:16px;margin:14px 14px 2px;font-weight:600}
    h2{font-size:13px;margin:10px 14px 0;font-weight:600}
    .sub{margin:2px 14px 8px;opacity:.75;font-size:12px;line-height:1.6}
  </style>
  <h1>${picked} — 接線流 OFF / ON=${onVal}（同一ロード・${startSec}s から）</h1>
  <div class="sub">
   <b>制御実験（各 ${trials.length} トライアル）:</b> 同じ瞬間にそのチャンネルだけ切り替えて撮り、
   音楽の進行ぶんを差し引いた視覚寄与（画面輝度の平均絶対差）。<br>
   ${results.map((r) => `・${r.name}: 切替差 ${(r.sw * 100).toFixed(3)}% − 音楽 ${(r.mu * 100).toFixed(3)}%
     = <b>${(r.effect * 100).toFixed(3)}%</b>`).join('<br>')}<br>
   <b>接線流 ÷ 径の波 = ${(results[0].effect / Math.max(1e-9, results[1].effect)).toFixed(2)} 倍</b><br>
   参考: 隣接フレーム差の平均 OFF ${(mOff * 100).toFixed(2)}% / ON ${(mOn * 100).toFixed(2)}%
   （これは打点フラッシュと粒子が支配的で、流の判定には使えない）。
  </div>
  ${row(phases.off[0], dOffG[0], '接線流 OFF（2026-08-25 以前＝径方向の波だけ）', '#9aa5ff')}
  ${row(phases.on[0], dOnG[0], '接線流 ON（既定）', '#7fd4ff')}`;
  const q2 = await b2.newPage();
  await q2.setViewport({ width: shots * (cell + 8) + 28, height: (cell + 90) * 2 + 120 });
  await q2.setContent(html, { waitUntil: 'networkidle0' });
  await q2.screenshot({ path: out, fullPage: true });
  await b2.close();
  console.log(`saved ${out}`);
  for (const r of results) {
    console.log(`制御実験 [${r.name}]: 切替差 ${(r.sw * 100).toFixed(3)}% − 音楽 ${(r.mu * 100).toFixed(3)}%` +
      ` = 視覚寄与 ${(r.effect * 100).toFixed(3)}%`);
  }
  console.log(`接線流 ÷ 径の波 = ${(results[0].effect / Math.max(1e-9, results[1].effect)).toFixed(2)} 倍`);
  console.log(`参考(埋もれる指標): 隣接フレーム差 OFF ${(mOff * 100).toFixed(2)}% / ON ${(mOn * 100).toFixed(2)}%`);
  console.log(`console errors: ${errs.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
