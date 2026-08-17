// 「LIVE の最終フレーム」と「完成後」の見た目の飛び幅を**平均**で測る。
//
// なぜ要るか（2026-08-12）: ユーザー指摘「complete と LIVE の見た目が全く違う。
// LIVE から完成へ向かう軌跡を見せたい」。まず**飛び幅の before 値**が無いと、
// 寄せる作業をしても効いたか判定できない。
//
// 形は毎フレーム動くので 1 枚では判定できない → 各フェーズで N 枚撮って平均する。
// フェーズ: live（完成直前）/ mid（Complete 押下 +2 秒＝完成アニメーション中）/ done（+12 秒）
//
// **形成秒に 0 を渡すと「曲を最後まで聴いてから」測る**（熟成度が上がりきった状態で比べる）。
// 途中で Complete を押すと熟成度がまだ低いので、飛びが縮んだかの判定にならない
// （2026-08-13 に 60 秒で測って一度誤った。Fury の 60 秒地点は熟成度 0.44）。
//
// 使い方: node completion_gap_stats.js <outDir> <形成秒|0=最後まで> <曲名の一部> [枚数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

// 本体画素を「veil（白い薄膜）／hot（稜・鏡面）」に分け、面積・輝度・彩度・局所コントラストを出す。
// 背景はその行の左端画素（深海のグラデがあるので行ごとに取る）。
const stats = (file) => {
  const img = decode(file);
  const { width: w, height: h, bpp } = img;
  const px = img.data;
  const L = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  let body = 0, hot = 0, veil = 0, sumL = 0, sumS = 0;
  for (let y = 0; y < h; y += 1) {
    const j = (y * w) * bpp;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * bpp;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      L[y * w + x] = l;
      if (Math.abs(r - px[j]) + Math.abs(g - px[j + 1]) + Math.abs(b - px[j + 2]) <= 26) continue;
      mask[y * w + x] = 1;
      body += 1;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx > 0 ? (mx - mn) / mx : 0;
      sumL += l; sumS += s;
      if (l > 0.80) hot += 1;
      if (l > 0.62 && s < 0.22) veil += 1;
    }
  }
  let grad = 0, gradN = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (!mask[y * w + x]) continue;
      grad += Math.hypot(L[y * w + x + 1] - L[y * w + x - 1], L[(y + 1) * w + x] - L[(y - 1) * w + x]);
      gradN += 1;
    }
  }
  return {
    area: body / (w * h), hot: hot / Math.max(1, body), veil: veil / Math.max(1, body),
    meanL: sumL / Math.max(1, body), meanS: sumS / Math.max(1, body), grad: grad / Math.max(1, gradN),
  };
};

const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 250));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }));
};

(async () => {
  const outDir = process.argv[2] || 'gap';
  const formSec = Number(process.argv[3] || 60);
  const hint = process.argv[4] || 'Fury';
  const shots = Number(process.argv[5] || 5);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 800, height: 800 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.bringToFront();
  await new Promise((r) => setTimeout(r, 7000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    const norm = (s) => s.normalize('NFC');
    const opt = sel && [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await b.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  if (formSec > 0) {
    await new Promise((r) => setTimeout(r, formSec * 1000));
  } else {
    // 曲の終わり際まで待つ（熟成度が上がりきった LIVE を撮るため）。曲の実時間ぶんかかる
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const d = await p.evaluate(() => (window.__maturity ? { ...window.__maturity } : null));
      if (!d) continue;
      if (d.completed) { console.log('  自動で完成した（LIVE 側を撮り逃した可能性あり）'); break; }
      if (d.progress >= 0.93) break;
      if (i % 15 === 0) {
        console.log(`  進行度 ${d.progress.toFixed(2)} / 熟成度 ${(d.maturity ?? 0).toFixed(2)}`);
      }
    }
  }

  const phase = async (tag) => {
    const acc = [];
    for (let k = 0; k < shots; k += 1) {
      const f = path.join(outDir, `${tag}_${k}.png`);
      await shoot(p, f);
      acc.push(stats(f));
      await new Promise((r) => setTimeout(r, 700));
    }
    const avg = (key) => acc.reduce((s, v) => s + v[key], 0) / acc.length;
    console.log(`${tag.padEnd(5)} hot=${(avg('hot') * 100).toFixed(2)}%  veil=${(avg('veil') * 100).toFixed(1)}%  ` +
      `meanL=${avg('meanL').toFixed(3)}  meanSat=${avg('meanS').toFixed(3)}  |grad|=${avg('grad').toFixed(4)}  ` +
      `面積=${(avg('area') * 100).toFixed(1)}%`);
  };

  console.log(`[${picked.trim()}] axis=${(await p.evaluate(() => window.__mineralAxis?.axis ?? -1)).toFixed(3)}`);
  await phase('live');
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise((r) => setTimeout(r, 2000));
  await phase('mid');   // 完成アニメーション中（vita は completion.seconds = 6）
  await new Promise((r) => setTimeout(r, 9000));
  await phase('done');
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
