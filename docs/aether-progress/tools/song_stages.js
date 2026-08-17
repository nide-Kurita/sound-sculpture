// 曲の途中で段階的にキャプチャし、「後半に形が変わっているか」を測る。
//
// なぜ要るか: volume は充填率の上限に達すると成長が止まる（実測で約60秒）。
// ユーザーには「曲中に生成がされなくなる」と見える。
// ただし彫り込み（穴あけ）にはブレーキが掛かっていないので、
// **止まって見えるだけで彫刻は進んでいる**可能性がある。
// 60秒時点と曲の終わりで穴の数・輪郭の複雑度を比べれば、どちらなのか決着が付く。
//
// 成長を復活させる方向の修正は2回とも失敗している（docs/handoff/VOLUME.md 5章）ので、
// **推測で直す前にここを測ること。**
//
// 使い方: node song_stages.js <URL> <トラック名の一部> <出力ディレクトリ> <秒,秒,...> [タイムアウト秒]
//   例) node song_stages.js "http://localhost:5173/?style=volume&surface=dev" "Fury" /tmp/out 60,150,240
//   完成時のキャプチャは指定しなくても必ず撮る。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const url = process.argv[2];
  const trackHint = process.argv[3];
  const outDir = process.argv[4];
  const stages = (process.argv[5] || '60,150,240').split(',').map(Number).sort((a, b) => a - b);
  const timeoutSec = Number(process.argv[6] || 900);
  if (!url || !trackHint || !outDir) {
    console.error('usage: node song_stages.js <url> <trackHint> <outDir> <sec,sec,...> [timeoutSec]');
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
  await p.setViewport({ width: 1200, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const client = await p.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
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
  console.log(`[${picked}] 再生開始`);
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  const started = Date.now();

  // 落ちてきたファイルに段階名を付ける（あとで topology.js の出力が読めるように）
  const tagNew = async (tag) => {
    await new Promise(r => setTimeout(r, 3500));
    for (const f of fs.readdirSync(outDir)) {
      if (!f.endsWith('.png') || f.startsWith('t')) continue;
      fs.renameSync(path.join(outDir, f), path.join(outDir, `t${tag}_${f}`));
    }
  };

  const capture = async (tag) => {
    await p.evaluate(() => document.querySelector('#capture-verify')?.click());
    await tagNew(tag);
    console.log(`[${picked}] ${tag} で撮影`);
  };

  for (const sec of stages) {
    const waitMs = started + sec * 1000 - Date.now();
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    // 曲が先に終わっていたら段階撮影は打ち切る
    const st = await p.evaluate(() => document.querySelector('#hud-status')?.textContent ?? '');
    if (st.toUpperCase().includes('COMPLETE')) break;
    await capture(`${sec}s`);
  }

  while ((Date.now() - started) / 1000 < timeoutSec) {
    await new Promise(r => setTimeout(r, 10000));
    const st = await p.evaluate(() => document.querySelector('#hud-status')?.textContent ?? '');
    if (st.toUpperCase().includes('COMPLETE')) break;
  }
  await new Promise(r => setTimeout(r, 12000)); // 完成アニメーション6秒 + 余裕
  await capture('final');

  console.log(`[${picked}] console errors:`, errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})();
