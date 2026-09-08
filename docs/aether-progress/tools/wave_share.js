// **段A1 判定の切り分け: 主旋律の波は「別の種類の動き」になっているか。**
//
// 2026-08-25 の実機判定で「波が I'm Yours でギリギリ / ロビンソンでほぼ / 修羅場で全く見えない」。
// コードを読むと phraseWave は打点の pulse と**同じ liveOffset へ足し算**で入っている
// （main.ts `updateCoreGeometry`: `liveTarget = pulse + phraseWave`）。
// ＝別チャンネルではなく「同じ種類の動きの弱いぶん」ではないか、を数値で確定する。
//
// 測るもの（頂点平均の絶対変位。`liveDebug.pulseDisp` / `waveDisp` を
// シミュレーション周期でリングバッファへ書き、最後に1回だけ回収する）:
//   - 打点の変位 / 波の変位 の平均
//   - **句が出ている間**（presence > 0.3）に絞った同じ比 ← これが「声が見えるか」の本体
//   - 波が打点と並ぶのに必要な waveAmp 倍率（線形なので比の逆数）
//
// 使い方: node wave_share.js <開始秒> <窓秒> <曲名の一部>...
//   node wave_share.js 40 40 "I'm Yours" ロビンソン 修羅場
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

// dumpVocal() の列（先頭は dt）
const KEYS = ['melodyBand', 'melodyFocus', 'melodyOnset', 'phrase', 'flash', 'chatter',
  'kick', 'snare', 'membraneLive', 'melodyPresence', 'melodyHead', 'melodyContour',
  'pulseDisp', 'waveDisp', 'flowDisp', 'flowPeak'];
const mean = (v) => (v.length ? v.reduce((a, c) => a + c, 0) / v.length : 0);

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
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => { if (window.__liveProbe) window.__liveProbe.on = true; });
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, (startSec + windowSec) * 1000));
  const raw = await p.evaluate(() => window.__live?.dumpVocal() ?? []);
  await p.close();
  let t = 0;
  const rows = raw.map((r) => { t += r[0]; return [t, ...r.slice(1)]; });
  const tEnd = t;
  return { picked, rows: rows.filter((r) => r[0] >= tEnd - windowSec), errs };
}

function analyze(rows) {
  const col = (name) => { const i = KEYS.indexOf(name) + 1; return rows.map((r) => r[i]); };
  const pulse = col('pulseDisp'), wave = col('waveDisp'), presence = col('melodyPresence');
  const flow = col('flowDisp'), flowPk = col('flowPeak');
  const sung = rows.map((_, i) => presence[i] > 0.3);
  const pick = (v, mask) => v.filter((_, i) => mask[i]);
  const pAll = mean(pulse), wAll = mean(wave);
  const pS = mean(pick(pulse, sung)), wS = mean(pick(wave, sung));
  const fS = mean(pick(flow, sung));
  const fPk = Math.max(0, ...flowPk);
  const ratioAll = pAll > 0 ? wAll / pAll : 0;
  const ratioSung = pS > 0 ? wS / pS : 0;
  return {
    samples: rows.length,
    seconds: +(rows.length ? rows[rows.length - 1][0] - rows[0][0] : 0).toFixed(1),
    sungDuty: +(pick(presence, sung).length / Math.max(1, rows.length)).toFixed(2),
    pulseDisp: +pAll.toFixed(5),
    waveDisp: +wAll.toFixed(5),
    waveSharePct: +(ratioAll / (1 + ratioAll) * 100).toFixed(1),
    pulseDispSung: +pS.toFixed(5),
    waveDispSung: +wS.toFixed(5),
    ratioSung: +ratioSung.toFixed(3),
    // 接線流（2026-08-25 の本線）。打点と直交するので「奪い合い」ではないが、
    // 大きさの目安として同じ分母で出す。
    flowDispSung: +fS.toFixed(5),
    flowRatioSung: pS > 0 ? +(fS / pS).toFixed(3) : 0,
    // 頂点1つあたりの最大接線変位。辺長 0.115 の 40%（=0.046）を超えたら三角形が潰れる懸念
    flowPeak: +fPk.toFixed(4),
    // 波が打点と同じ大きさになるのに必要な waveAmp（phraseWave は waveAmp に線形）
    waveAmpForParity: ratioSung > 0 ? +(1 / ratioSung).toFixed(1) : Infinity,
  };
}

(async () => {
  const [startSec, windowSec, ...hints] = process.argv.slice(2);
  const s0 = Number(startSec) || 40, w0 = Number(windowSec) || 40;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const out = [];
  for (const h of hints) {
    const { picked, rows, errs } = await measureSong(browser, h, s0, w0);
    const a = analyze(rows);
    out.push({ song: picked, ...a, errors: errs.length });
    console.log(`\n=== ${picked} ===`);
    console.log(JSON.stringify(a, null, 2));
    if (errs.length) console.log('console errors:', errs.slice(0, 3));
  }
  await browser.close();
  console.log('\n=== まとめ（句が出ている間）===');
  console.log('曲'.padEnd(22), '打点変位', '接線流', '流/打点', '径の波', '波/打点');
  for (const r of out) {
    console.log(String(r.song).padEnd(22), String(r.pulseDispSung).padEnd(9),
      String(r.flowDispSung).padEnd(8), String(r.flowRatioSung).padEnd(8),
      String(r.waveDispSung).padEnd(8), r.ratioSung);
  }
})();
