// 彫り込みの閃光が本当に出ているかを確かめる。
//
// なぜ要るか: 閃光は 0.55 秒で消えるうえ、彫り込みのクールダウンが 1.6〜2.4 秒あるので、
// **1枚撮っただけでは写らない。** 「出ていない」と誤診しやすい。
// 連射して、最も明るい画素を持つコマを残す。
//
// 「再生中に検証する」（待機だけ見て直ったと報告して過去に何度も外している）ための道具。
//
// 使い方: node flash_check.js <出力ディレクトリ> <トラック名の一部> [URL] [開始秒] [コマ数]
//   開始秒: ここまで再生してから連射を始める。既定 70（充填率の上限を過ぎた後を見たい）
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const outDir = process.argv[2];
  const trackHint = process.argv[3] || 's04';
  const url = process.argv[4] || 'http://localhost:5173/?style=volume';
  const startSec = Number(process.argv[5] || 70);
  const frames = Number(process.argv[6] || 24);
  if (!outDir) {
    console.error('usage: node flash_check.js <outDir> <trackHint> [url] [startSec] [frames]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((hint) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    const opt = [...sel.options].find(o => o.textContent.includes(hint));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, trackHint);
  if (!picked) { console.error(`[${trackHint}] トラックが見つからない`); await b.close(); process.exit(1); }
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  console.log(`[${picked}] ${startSec} 秒まで形成する`);
  await new Promise(r => setTimeout(r, startSec * 1000));

  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });

  // 連射して、加算合成の光がいちばん出ているコマを探す。
  // 指標は「ほぼ白飛びした画素の数」。等値面はクリーム色なので、
  // 3チャンネルとも 250 以上まで抜けるのは閃光だけ。
  let best = { n: -1, file: null };
  const counts = [];
  for (let i = 0; i < frames; i += 1) {
    const f = path.join(outDir, `flash-${String(i).padStart(2, '0')}.png`);
    await p.screenshot({ path: f });
    const img = decode(f);
    const stride = img.width * img.bpp;
    let n = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const j = y * stride + x * img.bpp;
        if (img.data[j] >= 250 && img.data[j + 1] >= 250 && img.data[j + 2] >= 250) n++;
      }
    }
    counts.push(n);
    if (n > best.n) best = { n, file: f };
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('白飛び画素数（コマごと）:', counts.join(' '));
  console.log('最大:', best.n, best.file);
  console.log('閃光が出たコマ数:', counts.filter(n => n > 40).length, '/', frames);
  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
