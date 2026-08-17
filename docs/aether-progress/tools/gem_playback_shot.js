// **再生中**の見た目を撮る（vita の宝石＝結晶の面／生物の面）。
//
// handoff の鉄則: 待機・無音で見た目を判断しない。宝石は再生中に軸が上がってから出るので、
// 完成後だけ撮っても意味がない。この道具は「曲を鳴らしたまま」撮る。
//
// 使い方: node gem_playback_shot.js <outDir> <再生秒> <曲名の一部...>
//   node gem_playback_shot.js /tmp/gem 90 Fury "I'm Yours"
// 軸を固定したいとき（材質の isolate 用）: AXIS=1 node gem_playback_shot.js ...
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = 'http://localhost:5173/?style=vita';
const AXIS = process.env.AXIS ? Number(process.env.AXIS) : null;

const shoot = async (p, out) => {
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach((e) => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise((r) => setTimeout(r, 450));
  await p.screenshot({ path: out });
  await p.evaluate(() => document.querySelectorAll('body *').forEach((e) => { e.style.visibility = ''; }));
};

const runOne = async (b, hint, seconds, outPng) => {
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 1000 });
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
    if (!sel) return null;
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find((o) => norm(o.textContent).includes(norm(h)));
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, hint);
  if (!picked) { console.error(`[${hint}] 曲が見つからない`); await p.close(); return; }
  // 大きい WAV はデコードに数秒かかる。待たずに押すと再生されない
  await new Promise((r) => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  if (AXIS !== null) {
    // 軸=固定（材質だけを見たいとき）。slider[0]=軸, [1]=形のファセット強度, [2]=宝石強度
    await p.evaluate((v) => {
      const inputs = document.querySelectorAll('#mineral-sliders input');
      if (inputs[0]) { inputs[0].value = String(v); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
      const tgl = document.querySelector('#toggle-mineral-override');
      if (tgl && tgl.textContent.includes('自動')) tgl.click();
    }, AXIS);
  }
  await new Promise((r) => setTimeout(r, seconds * 1000));
  // **再生を止めずに**撮る
  const dbg = await p.evaluate(() => (window.__mineralAxis ? { ...window.__mineralAxis } : null));
  await shoot(p, outPng);
  console.log(
    `[${picked.trim()}] -> ${path.basename(outPng)}  axis=${dbg ? dbg.axis.toFixed(3) : '?'}  ` +
    `grit=${dbg ? dbg.gritAvg.toFixed(3) : '?'}  errors=${errs.length ? errs.slice(0, 2) : 0}`,
  );
  await p.close();
};

(async () => {
  const outDir = process.argv[2] || 'gemplay';
  const seconds = Number(process.argv[3] || 90);
  const songs = process.argv.slice(4);
  if (!songs.length) { console.error('曲を指定する'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  // **逐次**。並列にすると背景タブの rAF が止まってシミュレーションが進まない
  for (const hint of songs) {
    const safe = hint.replace(/[^\w]/g, '_');
    await runOne(b, hint, seconds, path.join(outDir, `${safe}.png`));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
