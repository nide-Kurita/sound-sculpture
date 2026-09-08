// **主旋律の伸び・撓み（段A1 3 巡目・2026-08-26）が「輪郭を変えているか」を測る。**
//
// 2 巡目（接線流）は画面の輝度差では 0.76%（径の波の 12 倍）出ていたのに、実機では
// 「全くわからない」だった。**輝度差は動きの読みやすさを測っていない。**
// 3 巡目の狙いはシルエットを変えることなので、測るのもシルエットにする。
//
// 手順は flow_ab.js と同じ制御実験（同じ瞬間に切り替える）:
//   S1(伸び ON) → S2(伸び OFF) → S3(伸び ON)
//   d12・d23 = 音楽(δ) + 伸び ／ d13 = 音楽(2δ) のみ
// 指標はシルエットの xor/union と bbox のアスペクト比。
// 背景は上下グラデーションのドームなので**行ごとに左右端から推定する**（silhouette.js と同じ）。
//
// 使い方: node voice_shape_ab.js <出力.png> <曲名の一部> [開始秒=45] [トライアル=9] [ON値=1]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';
// **スライダーは番号ではなくラベルで引く。**
// ノブを 1 つ挿すたびに並びがずれる。2026-08-28 に「撓み」のつもりで「句の長さ」を
// 0 に落としてエンベロープごと潰し、伸びが立ち上がらない状態を測っていた（観測最大 0.03）。
const TARGET_LABELS = ['句頭スナップ（全体伸び）', '局所隆起（声の本線・句中）'];

(async () => {
  const out = process.argv[2];
  const hint = process.argv[3] || 'ロビンソン';
  const startSec = Number(process.argv[4] || 45);
  const trialCount = Number(process.argv[5] || 9);
  const onVal = Number(process.argv[6] || 1);
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

  const setPair = (v) => p.evaluate((labels, val) => {
    const rows = [...document.querySelectorAll('#voice-sliders .tuning-slider')];
    let hit = 0;
    for (const row of rows) {
      const label = row.querySelector('.tuning-slider__label')?.textContent ?? '';
      if (!labels.some((l) => label.includes(l))) continue;
      const input = row.querySelector('input[type=range]');
      if (!input) continue;
      input.value = String(val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      hit += 1;
    }
    if (hit !== labels.length) {
      throw new Error(`スライダーが見つからない (${hit}/${labels.length})`);
    }
  }, TARGET_LABELS, v);

  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 300));

  const trials = [];
  const trialStretch = [];
  let stretchSeen = 0;
  let missed = 0;
  // **句が立ち上がるのを待ってから撮る（2026-08-28）。**
  // 句にエンベロープを入れて duty が 0.3 まで下がったので、一定間隔で撮ると
  // ループ周期と句の周期でエイリアシングして 1 回も捉えられないことがある
  // （18 回中 0 回を実際に踏んだ）。**句が出ている瞬間の輪郭**が知りたいので同期させる。
  const waitForPhrase = async (thr, timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = await p.evaluate(() => window.__live?.voiceStretch ?? 0);
      if (v > thr) return v;
      await new Promise((r) => setTimeout(r, 40));
    }
    return 0;
  };
  for (let c = 0; c < trialCount; c += 1) {
    await setPair(onVal);
    const waited = await waitForPhrase(0.08, 12000);
    if (waited <= 0) missed += 1;
    const s1 = await p.screenshot({ encoding: 'base64' });
    // **句が出ている瞬間かどうかを記録する（2026-08-28）。**
    // 句にエンベロープを入れて休みが 70〜82% になったので、無作為に撮ると
    // 大半が休み中＝伸び 0 のフレームになり、効果が薄まって見える。
    // 「句が出ているときに輪郭がどれだけ変わるか」を測るのが本題なので条件付きで集計する。
    const nowStretch = Math.max(waited, await p.evaluate(() => window.__live?.voiceStretch ?? 0));
    trialStretch.push(nowStretch);
    stretchSeen = Math.max(stretchSeen, nowStretch);
    await setPair(0);
    const s2 = await p.screenshot({ encoding: 'base64' });
    await setPair(onVal);
    const s3 = await p.screenshot({ encoding: 'base64' });
    trials.push([s1, s2, s3]);
    await new Promise((r) => setTimeout(r, 400));
  }
  // 見た目用: 伸びが乗っている瞬間の ON/OFF 一組（ここも句を待つ）
  await setPair(onVal);
  await waitForPhrase(0.12, 12000);
  const showOn = await p.screenshot({ encoding: 'base64' });
  await setPair(0);
  const showOff = await p.screenshot({ encoding: 'base64' });
  await setPair(onVal);
  await b.close();

  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  const q = await b2.newPage();
  await q.setViewport({ width: 700, height: 700 });

  const analyse = (groups) => q.evaluate(async (all) => {
    const load = (b64) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b64;
    });
    const cv = document.createElement('canvas');
    // 行ごとに左右端 8px から背景を推定して本体マスクを作る（グラデーション背景対応）
    const maskOf = (im) => {
      cv.width = im.width; cv.height = im.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const W = cv.width, H = cv.height;
      const mask = new Uint8Array(W * H);
      for (let y = 0; y < H; y += 1) {
        let br = 0, bg = 0, bb = 0, n = 0;
        for (const x of [0, 1, 2, 3, 4, 5, 6, 7, W - 8, W - 7, W - 6, W - 5, W - 4, W - 3, W - 2, W - 1]) {
          const k = (y * W + x) * 4; br += d[k]; bg += d[k + 1]; bb += d[k + 2]; n += 1;
        }
        br /= n; bg /= n; bb /= n;
        for (let x = 0; x < W; x += 1) {
          const k = (y * W + x) * 4;
          const dist = Math.abs(d[k] - br) + Math.abs(d[k + 1] - bg) + Math.abs(d[k + 2] - bb);
          mask[y * W + x] = dist > 38 ? 1 : 0;
        }
      }
      // **星・浮遊粒子を落とす。** vita の背景には星があり、そのままだと bbox が毎回
      // 全画面になってアスペクト比の差が 0.000 に張り付く（2026-08-26 に踏んだ）。
      // 最大の連結成分＝彫刻本体だけを残す。
      const label = new Int32Array(W * H).fill(-1);
      const stack = new Int32Array(W * H);
      let best = -1, bestSize = 0, cur = 0;
      for (let i = 0; i < W * H; i += 1) {
        if (!mask[i] || label[i] >= 0) continue;
        let sp = 0, size = 0;
        stack[sp++] = i;
        label[i] = cur;
        while (sp > 0) {
          const v = stack[--sp];
          size += 1;
          const x = v % W, y = (v / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx2 = x + dx, ny2 = y + dy;
            if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
            const j = ny2 * W + nx2;
            if (!mask[j] || label[j] >= 0) continue;
            label[j] = cur;
            stack[sp++] = j;
          }
        }
        if (size > bestSize) { bestSize = size; best = cur; }
        cur += 1;
      }
      const body = new Uint8Array(W * H);
      if (best >= 0) for (let i = 0; i < W * H; i += 1) if (label[i] === best) body[i] = 1;
      return { mask: body, W, H };
    };
    const stats = (m) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, area = 0;
      for (let y = 0; y < m.H; y += 1) for (let x = 0; x < m.W; x += 1) {
        if (!m.mask[y * m.W + x]) continue;
        area += 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      return { area, aspect: h > 0 ? w / h : 0, w, h };
    };
    const xorUnion = (a, b) => {
      let inter = 0, uni = 0;
      for (let i = 0; i < a.mask.length; i += 1) {
        const p = a.mask[i], q = b.mask[i];
        if (p || q) uni += 1;
        if (p && q) inter += 1;
      }
      return uni > 0 ? 1 - inter / uni : 0;
    };
    const outs = [];
    for (const g of all) {
      const ms = []; for (const f of g) ms.push(maskOf(await load(f)));
      outs.push({
        d12: xorUnion(ms[0], ms[1]),
        d23: xorUnion(ms[1], ms[2]),
        d13: xorUnion(ms[0], ms[2]),
        aspectOn: stats(ms[0]).aspect,
        aspectOff: stats(ms[1]).aspect,
        areaOn: stats(ms[0]).area,
        areaOff: stats(ms[1]).area,
      });
    }
    return outs;
  }, groups);

  const resAll = await analyse(trials);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  // 句が出ている瞬間だけで集計する（伸び > 0.05）
  const activeIdx = trialStretch.map((v, i) => (v > 0.06 ? i : -1)).filter((i) => i >= 0);
  const res = activeIdx.length >= 3 ? activeIdx.map((i) => resAll[i]) : resAll;
  const conditioned = activeIdx.length >= 3;
  const sw = avg(res.map((t) => (t.d12 + t.d23) / 2));
  const mu = avg(res.map((t) => t.d13 / 2));
  const effect = sw - mu;
  const aspectDelta = avg(res.map((t) => Math.abs(t.aspectOn - t.aspectOff)));
  const areaDelta = avg(res.map((t) => Math.abs(t.areaOn - t.areaOff) / Math.max(1, t.areaOff)));

  const cell = 420;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12161c;color:#e8eef5;font:14px/1.6 -apple-system,"Hiragino Sans",sans-serif}
    .row{display:grid;grid-template-columns:repeat(2,${cell}px);gap:12px;padding:8px 16px 16px}
    img{width:${cell}px;height:${cell}px;display:block;border-radius:6px}
    figcaption{padding:6px 2px 0;font-size:13px}
    h1{font-size:16px;margin:14px 16px 2px;font-weight:600}
    .sub{margin:2px 16px 8px;opacity:.8;font-size:12.5px}
  </style>
  <h1>${picked} — 主旋律の伸び・撓み OFF / ON（同一ロード・同じ瞬間に切替・${startSec}s から）</h1>
  <div class="sub">
   <b>制御実験（${res.length}/${trials.length} トライアル${conditioned ? '・**句が出ている瞬間のみ**' : ''}・シルエットの xor/union）:</b>
   切替差 <b>${(sw * 100).toFixed(2)}%</b> − 音楽の進行だけ <b>${(mu * 100).toFixed(2)}%</b>
   = <b>伸び・撓みによる輪郭の変化 ${(effect * 100).toFixed(2)}%</b><br>
   bbox アスペクト比の差 <b>${aspectDelta.toFixed(3)}</b> ／ 面積の差 <b>${(areaDelta * 100).toFixed(1)}%</b>
   ／ 観測した伸びの最大 <b>${stretchSeen.toFixed(2)}</b><br>
   参考: 曲間シルエット差のノイズ床は 0.022〜0.027（＝2.2〜2.7%）。
   マスクは**最大連結成分のみ**（星・粒子を除外）。
  </div>
  <div class="row">
    <figure><img src="data:image/png;base64,${showOff}"><figcaption style="color:#9aa5ff">伸び・撓み OFF</figcaption></figure>
    <figure><img src="data:image/png;base64,${showOn}"><figcaption style="color:#7fd4ff">伸び・撓み ON（既定）</figcaption></figure>
  </div>`;
  const q2 = await b2.newPage();
  await q2.setViewport({ width: cell * 2 + 44, height: cell + 190 });
  await q2.setContent(html, { waitUntil: 'networkidle0' });
  await q2.screenshot({ path: out, fullPage: true });
  await b2.close();
  console.log(`saved ${out}`);
  console.log(`集計: ${res.length}/${trials.length} トライアル${conditioned ? '（句が出ている瞬間のみ）' : '（条件なし）'}` +
    ` / 句を待てなかった回数 ${missed}`);
  console.log(`シルエット xor/union: 切替 ${(sw * 100).toFixed(2)}% − 音楽 ${(mu * 100).toFixed(2)}%` +
    ` = 伸びの寄与 ${(effect * 100).toFixed(2)}%（ノイズ床 2.2〜2.7%）`);
  console.log(`アスペクト比の差 ${aspectDelta.toFixed(3)} / 面積の差 ${(areaDelta * 100).toFixed(1)}%` +
    ` / 観測した伸び最大 ${stretchSeen.toFixed(2)}`);
  console.log(`console errors: ${errs.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
