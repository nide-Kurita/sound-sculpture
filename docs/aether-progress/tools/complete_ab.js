// 「完成処理で形がどれだけ単純になるか」を短時間で測る。
//
// なぜ要るか: volume は演奏中は複雑な形をしているのに、完成した瞬間に単純になる。
// 実測で I'm Yours は輪郭の複雑度 10.30 → **4.24**（真円が 3.54）、破片 13 → 1。
// 原因は完成処理の3段階（破片除去 / 48³→72³ の載せ替え / mc.blur(0.6)）のどれか。
//
// 曲を最後まで通すと1回 4〜7 分かかって切り分けにならないので、
// **60 秒だけ聴かせてから Complete を押す**。完成前後を同じ個体で撮るので、
// 「完成処理が何を削っているか」だけが差として出る。
//
// 使い方: node complete_ab.js <URL> <トラック名の一部> <出力ディレクトリ> [形成秒数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const url = process.argv[2];
  const trackHint = process.argv[3];
  const outDir = process.argv[4];
  const formSec = Number(process.argv[5] || 60);
  if (!url || !trackHint || !outDir) {
    console.error('usage: node complete_ab.js <url> <trackHint> <outDir> [formSec]');
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
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  console.log(`[${picked}] ${formSec} 秒だけ形成する`);
  await new Promise(r => setTimeout(r, formSec * 1000));

  const tagNew = async (tag) => {
    await new Promise(r => setTimeout(r, 3500));
    for (const f of fs.readdirSync(outDir)) {
      if (!f.endsWith('.png') || f.startsWith('t')) continue;
      fs.renameSync(path.join(outDir, f), path.join(outDir, `t${tag}_${f}`));
    }
  };

  await p.evaluate(() => document.querySelector('#capture-verify')?.click());
  await tagNew('form');
  console.log(`[${picked}] 形成中を撮影`);

  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise(r => setTimeout(r, 12000)); // 完成アニメーション6秒 + 余裕
  await p.evaluate(() => document.querySelector('#capture-verify')?.click());
  await tagNew('done');
  console.log(`[${picked}] 完成後を撮影`);

  console.log(`[${picked}] console errors:`, errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})();
