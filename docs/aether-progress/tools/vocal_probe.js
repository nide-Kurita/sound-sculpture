// **段A0 診断: 歌モノで「声が見えない」のは検出の欠落か表示の欠落か。**
//
// メロ帯域（500–1800Hz）の持続レベルを「声の代理信号」として、
// 句頭オンセット（melodyOnset）→ 句イベント（melodyPhraseImpulse）→
// 中音の視覚（chatter / 膜 uLive）まで、同じ時間軸で記録する。
//
// **記録はアプリ内のリングバッファ（`__live.dumpVocal()`）から1回だけ回収する。**
// headless では描画 rAF が大きく絞られ、外からのポーリングは 40 秒で 12 サンプル
// しか取れなかった（2026-08-24 実測）。シミュレーションは音声クロック駆動なので、
// `recordLiveProbe` が書く長窓バッファだけが正しい周期を持つ。
//
// 出すもの（曲ごと）:
//   - 波形 PNG（メロ帯域 / melodyOnset / phrase / chatter / kick）
//   - 句イベントの発火回数 / 分、各段の平均
//   - chatter とメロ帯域・打点(kick/snare)の相関（中音チャンネルを誰が支配しているか）
//   - rows JSON（後から別の集計をやり直せるように）
//
// 使い方: node vocal_probe.js <outDir> <開始秒> <窓秒> <曲名の一部>...
//   node vocal_probe.js /tmp/vocal 40 40 "I'm Yours" ロビンソン 修羅場 "Donna Lee"
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

// dumpVocal() の列（先頭は dt）
const KEYS = ['melodyBand', 'melodyFocus', 'melodyOnset', 'phrase', 'flash', 'chatter',
  'kick', 'snare', 'membraneLive', 'melodyPresence', 'melodyHead', 'melodyContour'];

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, c) => a + c, 0) / n, my = ys.reduce((a, c) => a + c, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}
function risingEdges(v, thr, rearm) {
  let armed = true, count = 0;
  for (const x of v) {
    if (armed && x >= thr) { count += 1; armed = false; }
    else if (!armed && x <= rearm) armed = true;
  }
  return count;
}
const mean = (v) => v.reduce((a, c) => a + c, 0) / Math.max(1, v.length);

async function measureSong(browser, hint, startSec, windowSec) {
  const p = await browser.newPage();
  await p.setViewport({ width: 640, height: 640 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
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
    return opt.textContent.trim();
  }, hint);
  if (!picked) { await p.close(); throw new Error(`[${hint}] 曲が見つからない`); }
  await new Promise((r) => setTimeout(r, 6000)); // 大きい WAV の decode 待ち
  await p.evaluate(() => { if (window.__liveProbe) window.__liveProbe.on = true; });
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, (startSec + windowSec) * 1000));
  const raw = await p.evaluate(() => window.__live?.dumpVocal() ?? []);
  await p.close();
  // dt を累積時刻へ。窓の末尾 windowSec 秒だけ残す
  let t = 0;
  const rows = raw.map((r) => { t += r[0]; return [t, ...r.slice(1)]; });
  const tEnd = t;
  return { picked, rows: rows.filter((r) => r[0] >= tEnd - windowSec), errs };
}

function analyze(rows) {
  const col = (name) => { const i = KEYS.indexOf(name) + 1; return rows.map((r) => r[i]); };
  const melody = col('melodyBand'), focus = col('melodyFocus'), onset = col('melodyOnset');
  const phrase = col('phrase'), flash = col('flash'), chatter = col('chatter');
  const kick = col('kick'), snare = col('snare'), memLive = col('membraneLive');
  const presence = col('melodyPresence'), head = col('melodyHead');
  const seconds = rows.length ? rows[rows.length - 1][0] - rows[0][0] : 0;
  const perMin = (n) => (seconds > 0 ? (n / seconds) * 60 : 0);
  const drums = kick.map((v, i) => Math.max(v, snare[i]));
  return {
    samples: rows.length,
    seconds: +seconds.toFixed(1),
    melodyBandMean: +mean(melody).toFixed(3),
    melodyFocusMean: +mean(focus).toFixed(3),
    onsetMean: +mean(onset).toFixed(4),
    onsetEventsPerMin: +perMin(risingEdges(onset, 0.06, 0.02)).toFixed(1),
    phraseEventsPerMin: +perMin(risingEdges(phrase, 0.25, 0.1)).toFixed(1),
    phraseMean: +mean(phrase).toFixed(3),
    flashMean: +mean(flash).toFixed(3),
    chatterMean: +mean(chatter).toFixed(3),
    // 段A1 検出（主旋律の線）
    presenceMean: +mean(presence).toFixed(3),
    presenceDuty: +(presence.filter((v) => v > 0.3).length / Math.max(1, presence.length)).toFixed(2),
    headEventsPerMin: +perMin(risingEdges(head, 0.45, 0.2)).toFixed(1),
    // 中音の視覚（chatter）を誰が支配しているか
    corrChatterMelody: +pearson(chatter, melody).toFixed(2),
    corrChatterDrums: +pearson(chatter, drums).toFixed(2),
    corrChatterPhrase: +pearson(chatter, phrase).toFixed(2),
    // 声の持続が膜に出ているか
    corrMembraneMelody: +pearson(memLive, melody).toFixed(2),
    corrPresenceMelody: +pearson(presence, melody).toFixed(2),
  };
}

function chartHtml(title, sub, rows) {
  const W = 1180, H = 210;
  const series = [
    { key: 'melodyBand', label: 'メロ帯域 500–1800Hz（声の代理・持続）', color: '#ff9cc7' },
    { key: 'melodyPresence', label: '★melodyLine.presence（主旋律の持続。段A1 新検出）', color: '#ff6ba9' },
    { key: 'melodyHead', label: '★melodyLine.head（句頭。段A1 新検出）', color: '#ffa94d' },
    { key: 'melodyOnset', label: 'melodyOnset（旧・句頭の検出）', color: '#ffd479' },
    { key: 'phrase', label: 'melodyPhraseImpulse（旧・句イベント）', color: '#b6ff9c' },
    { key: 'chatter', label: 'chatter（中音の視覚ドライブ＝膜）', color: '#7fd4ff' },
    { key: 'kick', label: 'kickImpulse（低音・参考）', color: '#9aa5ff' },
  ];
  const poly = (key) => {
    const i = KEYS.indexOf(key) + 1;
    return rows.map((r, j) =>
      `${(j / (rows.length - 1) * (W - 70) + 60).toFixed(1)},${(H - 30 - Math.min(1, r[i]) * (H - 52)).toFixed(1)}`).join(' ');
  };
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12161c;color:#e8eef5;font:13px/1.5 -apple-system,"Hiragino Sans",sans-serif}
    h1{font-size:15px;margin:16px 18px 4px;font-weight:600}
    .sub{margin:0 18px 10px;opacity:.7;font-size:12px;white-space:pre-line}
    .chart{margin:0 18px 12px}.cap{margin:0 0 3px}
  </style><h1>${title}</h1><div class="sub">${sub}</div>
  ${series.map((s) => `<div class="chart"><div class="cap" style="color:${s.color}">${s.label}</div>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect x="60" y="20" width="${W - 70}" height="${H - 52}" fill="#0b0e13" stroke="#2a323d"/>
      <line x1="60" y1="20" x2="${W - 10}" y2="20" stroke="#5a6472" stroke-dasharray="4 4"/>
      <text x="20" y="24" fill="#8b96a5" font-size="11">1.0</text>
      <text x="20" y="${H - 28}" fill="#8b96a5" font-size="11">0</text>
      <polyline points="${poly(s.key)}" fill="none" stroke="${s.color}" stroke-width="1.3"/>
    </svg></div>`).join('')}`;
}

(async () => {
  const outDir = process.argv[2];
  const startSec = Number(process.argv[3] || 40);
  const windowSec = Number(process.argv[4] || 40);
  const hints = process.argv.slice(5);
  if (!outDir || !hints.length) {
    console.error('usage: node vocal_probe.js <outDir> <開始秒> <窓秒> <曲名の一部>...');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const results = [];
  const charts = [];
  for (const hint of hints) {
    const { picked, rows, errs } = await measureSong(browser, hint, startSec, windowSec);
    const stats = analyze(rows);
    const safe = picked.replace(/[^\w\u3040-\u30ff\u4e00-\u9fff'-]+/g, '_');
    fs.writeFileSync(path.join(outDir, `${safe}.json`), JSON.stringify({ picked, startSec, windowSec, stats, keys: KEYS, rows }, null, 1));
    const sub = `再生 ${startSec}s から ${stats.seconds}s（${stats.samples} フレーム）。` +
      `★新検出: presence 平均 ${stats.presenceMean} / duty ${stats.presenceDuty} / 句頭 ${stats.headEventsPerMin}/分` +
      `　（旧: 句イベント ${stats.phraseEventsPerMin}/分・onset ${stats.onsetEventsPerMin}/分）` +
      `\nchatter の相関 — メロ帯域 ${stats.corrChatterMelody} / ドラム ${stats.corrChatterDrums} / 句イベント ${stats.corrChatterPhrase}` +
      `　膜 uLive×メロ ${stats.corrMembraneMelody}　presence×メロ ${stats.corrPresenceMelody}`;
    charts.push({ file: path.join(outDir, `${safe}.png`), html: chartHtml(picked, sub, rows) });
    results.push({ picked, stats, errors: errs.length });
    console.log(`[${picked}] ${JSON.stringify(stats)}${errs.length ? ` ERRORS ${errs.length}` : ''}`);
  }
  // 図は計測が全部終わってから描く（計測ページと同居させない）
  const chart = await browser.newPage();
  await chart.setViewport({ width: 1220, height: 7 * 234 + 110 });
  for (const c of charts) {
    await chart.setContent(c.html, { waitUntil: 'networkidle0' });
    await chart.screenshot({ path: c.file, fullPage: true });
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(results, null, 2));
  console.log(`saved -> ${outDir}`);
})().catch((e) => { console.error(e); process.exit(1); });
