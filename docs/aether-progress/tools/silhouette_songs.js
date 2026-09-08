// 曲ごとに **60 秒形成 → Complete → 検証用キャプチャ（0°/120°/240°）** を撮る。
// `silhouette.js --matrix auto` に渡して「曲が変われば別の形になっているか」を確かめる用。
//
// なぜ要るか: LIVE の反応は `bleedLiveIntoSculpture` で永久層へ転写されるので、
// **LIVE の作り方を変えると完成形も変わる。** 変えたあとに曲間の差が保たれているかを
// 必ず測る（全曲が同じ形へ収束したら失敗）。ノイズ床（同一曲2回）は 0.022〜0.027。
//
// 使い方: node silhouette_songs.js <outDir> [形成秒=60] [曲名の一部...]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = `http://localhost:${process.env.PORT || 5173}/?style=vita&surface=dev`;

const runOne = async (b, hint, formSec, outDir) => {
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'silsong-'));
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const client = await p.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
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
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await p.close(); return null; }
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise((r) => setTimeout(r, formSec * 1000));
  const axis = await p.evaluate(() => window.__mineralAxis?.axis ?? -1);
  const maturity = await p.evaluate(() => window.__maturity?.maturity ?? -1);
  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise((r) => setTimeout(r, 12000)); // 完成アニメ6秒＋余裕
  await p.evaluate(() => document.querySelector('#capture-verify')?.click());
  await new Promise((r) => setTimeout(r, 4000));
  const files = fs.readdirSync(dlDir).filter((f) => f.endsWith('.png')).sort();
  const slug = hint.replace(/[^\w]/g, '_');
  files.forEach((f, i) => fs.copyFileSync(path.join(dlDir, f), path.join(outDir, `${slug}_${i}.png`)));
  console.log(`[${picked.trim()}] 軸 ${axis.toFixed(3)} / 熟成度 ${maturity.toFixed(2)} / ${files.length} 枚` +
    ` | console errors: ${errs.length}`);
  await p.close();
  return { song: picked.trim(), axis, maturity, files: files.length, errors: errs.length };
};

(async () => {
  const outDir = process.argv[2] || 'silsongs';
  const formSec = Number(process.argv[3] || 60);
  const songs = process.argv.length > 4 ? process.argv.slice(4) : ['Fury', 'Fly Away', "I'm Yours"];
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  for (const hint of songs) {
    await runOne(b, hint, formSec, outDir);
  }
  await b.close();
  console.log(`\n次: node silhouette.js --matrix auto ${songs.map((s) => path.join(outDir, s.replace(/[^\w]/g, '_') + '_0.png')).join(' ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
