// 熟成度（maturity）の候補入力を**全曲・曲の最後まで**実測する（worklist [P1] step 0）。
//
// なぜ要るか: 「LIVE から完成へ向かう軌跡」の駆動を**蓄積量だけ**にするとユーザーが決めた。
// 蓄積量は候補ごとに伸び方がまったく違う（`formDevelopment` は序盤で 1.0 に張り付く）ので、
// **正規化を推測で置くと必ず外す**。まず 9 曲でカーブを測ってから正規化を決める。
//
// 読むのは `window.__maturity`（main.ts の maturityDebug。`?surface=dev` が要る）。
// 絵は撮らない。曲を最後まで流すので **1 曲で曲の実時間ぶんかかる**（9 曲で約 45 分）。
//
// 出力: stdout の要約と <outDir>/<曲>.json（5 秒ごとの時系列）
//
// 使い方: node maturity_probe.js <outDir> [曲名の一部...]
//   node maturity_probe.js /tmp/mat            # 全 9 曲
//   node maturity_probe.js /tmp/mat Fury "Donna Lee"
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

// Dev Audio のカタログ表示名に含まれる文字列（NFC で照合する。macOS のファイル名は NFD）
const ALL_SONGS = ['Fury', '6_00', 'Fly Away', 'Peaches', '修羅場', 'ロビンソン', 'AIR', 'Donna Lee', "I'm Yours"];
const KEYS = ['formDev', 'vecMean', 'scalarMean', 'exposure'];

// 各候補について「終端値の 90% に達した時刻が曲の何 % か」＝ 飽和の速さ。
// これが小さいほど早期飽和（＝軌跡が序盤で終わる）。
const saturationRatio = (series, key) => {
  if (series.length < 2) return NaN;
  const last = series[series.length - 1][key];
  if (!(last > 1e-9)) return NaN;
  const hit = series.find((s) => s[key] >= last * 0.9);
  return hit ? hit.t / series[series.length - 1].t : NaN;
};

const runOne = async (b, hint, outDir) => {
  const p = await b.newPage();
  await p.setViewport({ width: 640, height: 640 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.bringToFront();
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await p.close(); return null; }
  // 大きい WAV（Fury 71MB / 6:00 58MB）は fetch + decodeAudioData に数秒かかる
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  // 実際に走り出したか確認して、動いていなければ押し直す
  for (let t = 0; t < 20; t += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await p.evaluate(() => (window.__maturity?.activeSeconds ?? 0) > 0.5)) break;
    if (t === 9) await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  }

  const series = [];
  let t = 0;
  let done = false;
  // 曲の終わりで自動的に完成する。保険として 12 分で打ち切る
  while (t < 720 && !done) {
    await new Promise((r) => setTimeout(r, 5000));
    t += 5;
    const d = await p.evaluate(() => (window.__maturity ? { ...window.__maturity } : null));
    if (!d) continue;
    series.push({ t, ...d });
    done = d.completed;
    if (t % 30 === 0 || done) {
      console.log(`  [${picked.trim()}] t=${t}s maturity=${(d.maturity ?? 0).toFixed(3)} ` +
        `(蓄積 ${(d.fromAccum ?? 0).toFixed(3)} / 進行度 ${(d.progress ?? -1).toFixed(3)}) ` +
        `formDev=${d.formDev.toFixed(3)} scalar=${d.scalarMean.toFixed(4)} ` +
        `exposure=${d.exposure.toFixed(1)} active=${d.activeSeconds.toFixed(0)}s${done ? ' [完成]' : ''}`);
    }
  }
  const last = series[series.length - 1] || {};
  const at20 = series.find((s) => s.t >= (last.t || 1) * 0.2) || {};
  const row = {
    song: picked.trim(), seconds: last.t ?? 0, completed: !!done, errors: errs.length,
    final: Object.fromEntries(KEYS.map((k) => [k, last[k] ?? 0])),
    at20pct: Object.fromEntries(KEYS.map((k) => [k, at20[k] ?? 0])),
    saturateAt: Object.fromEntries(KEYS.map((k) => [k, saturationRatio(series, k)])),
  };
  fs.writeFileSync(path.join(outDir, `${hint.replace(/[^\w]/g, '_')}.json`), JSON.stringify({ ...row, series }, null, 1));
  await p.close();
  return row;
};

(async () => {
  const outDir = process.argv[2] || 'maturity';
  const songs = process.argv.length > 3 ? process.argv.slice(3) : ALL_SONGS;
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const rows = [];
  // **逐次**。並列にすると背景タブの rAF が止まってシミュレーションが進まない
  for (const hint of songs) {
    const row = await runOne(b, hint, outDir);
    if (row) rows.push(row);
  }
  await b.close();

  console.log('\n=== 終端値（曲の最後）===');
  console.log('曲                        秒   formDev   vecMean  scalarMean  exposure  完成 err');
  for (const r of rows) {
    console.log(`${r.song.slice(0, 24).padEnd(24)} ${String(r.seconds).padStart(4)}  ` +
      `${r.final.formDev.toFixed(3)}  ${r.final.vecMean.toFixed(4)}  ${r.final.scalarMean.toFixed(4)}  ` +
      `${r.final.exposure.toFixed(1).padStart(7)}  ${r.completed ? 'yes' : 'NO '} ${r.errors}`);
  }
  console.log('\n=== 終端値の 90% に達した時点（曲の何 %。小さいほど早期飽和＝軌跡が序盤で終わる）===');
  console.log('曲                       formDev  vecMean  scalarMean  exposure');
  for (const r of rows) {
    const f = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%`.padStart(7) : '     --');
    console.log(`${r.song.slice(0, 24).padEnd(24)}${f(r.saturateAt.formDev)}  ${f(r.saturateAt.vecMean)}  ` +
      `${f(r.saturateAt.scalarMean)}  ${f(r.saturateAt.exposure)}`);
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(rows, null, 1));
  console.log(`\n${path.join(outDir, 'summary.json')} に保存した`);
})().catch((e) => { console.error(e); process.exit(1); });
