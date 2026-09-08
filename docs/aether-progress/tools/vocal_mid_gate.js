// **歌が出ている間、melodyOnset が中音打点へ流れていないか（段A1 Phase 0）。**
//
// `voicedMidBlocked=1` のとき melodyOnset → guitarFlash / spawnStrike(1) は遮断される。
// presence が高いのに blocked=0 が多い → ゲートが弱い。blocked=1 なのに flash が上がる → 別経路。
//
// 使い方: PORT=5174 node vocal_mid_gate.js 40 60 ロビンソン "I'm Yours"
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const PORT = process.env.PORT || '5173';
const URL = `http://localhost:${PORT}/?style=vita&surface=dev`;

const I_DT = 0, I_ONSET = 3, I_PHRASE = 4, I_FLASH = 5, I_PRES = 10, I_BLOCKED = 19;

async function measure(browser, hint, startSec, windowSec) {
  const p = await browser.newPage();
  await p.setViewport({ width: 640, height: 640 });
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
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
  let acc = 0;
  const rows = [];
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    rows.unshift(raw[i]);
    acc += raw[i][I_DT];
    if (acc >= windowSec) break;
  }
  return { picked, rows };
}

function analyse(rows) {
  let total = 0, singing = 0, blockedWhileSing = 0, collision = 0;
  let onsetWhileSing = 0, phraseWhileSing = 0;
  for (const r of rows) {
    const dt = r[I_DT];
    total += dt;
    const pres = r[I_PRES];
    const on = r[I_ONSET];
    const ph = r[I_PHRASE];
    const fl = r[I_FLASH];
    const blk = r[I_BLOCKED];
    if (pres > 0.25) {
      singing += dt;
      if (blk > 0.5) blockedWhileSing += dt;
      else collision += dt;
      if (on > 0.04) onsetWhileSing += dt;
      if (ph > 0.08) phraseWhileSing += dt;
    }
  }
  return {
    seconds: total,
    singingDuty: singing / Math.max(1e-6, total),
    blockedWhileSing: blockedWhileSing / Math.max(1e-6, singing || 1),
    collisionDuty: collision / Math.max(1e-6, total),
    onsetWhileSing: onsetWhileSing / Math.max(1e-6, singing || 1),
    phraseWhileSing: phraseWhileSing / Math.max(1e-6, singing || 1),
  };
}

(async () => {
  const startSec = Number(process.argv[2] || 40);
  const windowSec = Number(process.argv[3] || 60);
  const hints = process.argv.slice(4);
  if (!hints.length) hints.push('ロビンソン', "I'm Yours");
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  console.log(`URL ${URL}\n`);
  for (const h of hints) {
    const { picked, rows } = await measure(b, h, startSec, windowSec);
    const a = analyse(rows);
    console.log(`=== ${picked} ===`);
    console.log(JSON.stringify(a, null, 2));
    console.log(
      `  歌唱 presence>0.25: ${(a.singingDuty * 100).toFixed(0)}%` +
      ` / その間 mid遮断: ${(a.blockedWhileSing * 100).toFixed(0)}%` +
      ` / 衝突(遮断なし): ${(a.collisionDuty * 100).toFixed(1)}%` +
      ` / phrase残存: ${(a.phraseWhileSing * 100).toFixed(0)}%\n`,
    );
  }
  await b.close();
})();
