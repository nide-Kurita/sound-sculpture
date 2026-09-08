// **声の駆動信号は「句」になっているか（段A1・2026-08-28）。**
//
// 3 巡目の実機判定が決定的だった: 伸び・撓みは「分からない」のに「**常時うねって見える**」。
// ＝動きは知覚されている。つまり残る問題は可視性でも出力チャンネルでもなく、
// **駆動信号そのものが句の構造（始まり／持続／終わり／休み）を持っていない**疑い。
//
// ここで測るのは振幅ではなく**時間構造**:
//   - duty        : 信号が出ている時間の割合。**高いほど「常時うねり」に近い**
//   - 休みの割合  : ほぼ 0 の時間の割合。視覚的な休符がないと句として読めない
//   - イベント/分 : 立ち上がり回数（休みを挟んで数える）
//   - 1 イベントの長さ / 休みの長さ の中央値
//
// 使い方: node phrase_shape.js <開始秒> <窓秒> <曲名の一部>...
//   node phrase_shape.js 40 60 ロビンソン
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita&surface=dev';

const I_DT = 0, I_PRESENCE = 10, I_HEAD = 11, I_STRETCH = 17, I_PHRASE_AMP = 18;

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// 連続して閾値を超えている区間を「イベント」として切り出す
function segments(vals, dts, onThr, offThr) {
  const evs = [], rests = [];
  let on = false, acc = 0;
  for (let i = 0; i < vals.length; i += 1) {
    const v = vals[i], dt = dts[i];
    if (!on && v >= onThr) { if (acc > 0) rests.push(acc); on = true; acc = 0; }
    else if (on && v <= offThr) { if (acc > 0) evs.push(acc); on = false; acc = 0; }
    acc += dt;
  }
  if (acc > 0) (on ? evs : rests).push(acc);
  return { evs, rests };
}

async function measure(browser, hint, startSec, windowSec) {
  const p = await browser.newPage();
  await p.setViewport({ width: 640, height: 640 });
  const errs = [];
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
  if (!picked) { await p.close(); throw new Error(`[${hint}] 曲が見つからない`); }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => { if (window.__liveProbe) window.__liveProbe.on = true; });
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, (startSec + windowSec) * 1000));
  const raw = await p.evaluate(() => window.__live?.dumpVocal() ?? []);
  await p.close();
  // 末尾 windowSec 秒
  const rows = [];
  let acc = 0;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    rows.unshift(raw[i]);
    acc += raw[i][I_DT];
    if (acc >= windowSec) break;
  }
  return { picked, rows, errs };
}

function analyse(rows) {
  const dts = rows.map((r) => r[I_DT]);
  const total = dts.reduce((a, b) => a + b, 0);
  const drive = rows.map((r) => r[I_PHRASE_AMP]);
  const presence = rows.map((r) => r[I_PRESENCE]);
  const head = rows.map((r) => r[I_HEAD]);
  const dutyAbove = (v, thr) => {
    let t = 0;
    for (let i = 0; i < v.length; i += 1) if (v[i] > thr) t += dts[i];
    return t / Math.max(1e-6, total);
  };
  const { evs, rests } = segments(drive, dts, 0.20, 0.05);
  let headEvents = 0, armed = true;
  for (const h of head) { if (armed && h >= 0.45) { headEvents += 1; armed = false; } else if (!armed && h <= 0.2) armed = true; }
  return {
    seconds: +total.toFixed(1),
    driveMean: +(drive.reduce((a, b) => a + b, 0) / drive.length).toFixed(3),
    // **ここが本題**
    duty005: +dutyAbove(drive, 0.05).toFixed(2),
    duty020: +dutyAbove(drive, 0.20).toFixed(2),
    duty040: +dutyAbove(drive, 0.40).toFixed(2),
    restFraction: +(1 - dutyAbove(drive, 0.05)).toFixed(2),
    eventsPerMin: +((evs.length / total) * 60).toFixed(1),
    eventSecMedian: +median(evs).toFixed(2),
    restSecMedian: +median(rests).toFixed(2),
    restLongest: +(rests.length ? Math.max(...rests) : 0).toFixed(2),
    presenceDuty: +dutyAbove(presence, 0.3).toFixed(2),
    // **形が恒等に戻っている時間の割合。** 「句が切れたら元に戻るか」の数値版
    stretchRestFraction: +(1 - dutyAbove(rows.map((r) => r[I_STRETCH]), 0.001)).toFixed(2),
    stretchDuty: +dutyAbove(rows.map((r) => r[I_STRETCH]), 0.05).toFixed(2),
    headEventsPerMin: +((headEvents / total) * 60).toFixed(1),
  };
}

(async () => {
  const [a, b, ...hints] = process.argv.slice(2);
  const startSec = Number(a) || 40, windowSec = Number(b) || 60;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const out = [];
  for (const h of hints) {
    const { picked, rows, errs } = await measure(browser, h, startSec, windowSec);
    const r = analyse(rows);
    out.push({ song: picked, ...r });
    console.log(`\n=== ${picked} ===`);
    console.log(JSON.stringify(r, null, 2));
    if (errs.length) console.log('errors:', errs.slice(0, 3));
  }
  await browser.close();
  console.log('\n=== 声の駆動信号は句になっているか ===');
  console.log('曲'.padEnd(20), 'duty>0.05', 'duty>0.2', '休みの割合', 'イベント/分', '1回の長さ', '休みの長さ', '最長の休み');
  for (const r of out) {
    console.log(String(r.song).padEnd(20),
      String(r.duty005).padEnd(10), String(r.duty020).padEnd(9),
      String(r.restFraction).padEnd(11), String(r.eventsPerMin).padEnd(12),
      String(r.eventSecMedian).padEnd(10), String(r.restSecMedian).padEnd(11), r.restLongest);
  }
})();
