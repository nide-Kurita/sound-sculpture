// 表示の平滑（[P1]）の A/B。**完成後（形が凍る）に同一個体で撮る**ので、差は平滑だけ。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  const out = process.argv[2];
  const hint = process.argv[3] || 'Fury';
  const formSec = Number(process.argv[4] || 60);
  const levels = [0, 0.55, 0.8];
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars','--mute-audio','--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  await p.goto('http://localhost:5173/?style=vita&surface=dev', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((h) => {
    const sel = document.querySelector('#dev-audio-track');
    const norm = (s) => s.normalize('NFC');
    const opt = [...sel.options].find(o => norm(o.textContent).includes(norm(h)));
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opt.textContent;
  }, hint);
  await new Promise(r => setTimeout(r, 6000));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise(r => setTimeout(r, formSec * 1000));
  await p.evaluate(() => { const b = document.querySelector('#complete-sculpture'); if (b) { b.disabled = false; b.click(); } });
  await new Promise(r => setTimeout(r, 13000));
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  const shots = [];
  for (const v of levels) {
    await p.evaluate((x) => {
      const i = [...document.querySelectorAll('#smooth-sliders input[type=range]')][0];
      i.value = String(x); i.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await new Promise(r => setTimeout(r, 1200));
    shots.push([v, await p.screenshot({ encoding: 'base64' })]);
  }
  await b.close();
  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars'] });
  const q = await b2.newPage();
  const cell = 430;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d1117;color:#e8eef5;font:13px -apple-system,"Hiragino Sans",sans-serif}
    .row{display:grid;grid-template-columns:repeat(${shots.length},${cell}px);gap:10px;padding:12px}
    .zoom{width:${cell}px;height:${cell}px;overflow:hidden;border-radius:4px;position:relative}
    .zoom img{position:absolute;left:-235px;top:-235px;width:900px;height:900px}
    h1{font-size:15px;margin:12px 12px 0}
  </style><h1>${picked.trim()} — 完成後・同一個体・等倍で中央 430px を切り出し（差は「表示の平滑」だけ）</h1>
  <div class="row">${shots.map(([v, s]) => `<figure style="margin:0"><div class="zoom"><img src="data:image/png;base64,${s}"></div>
    <figcaption style="padding-top:6px">平滑 ${v}${v === 0 ? '（従来）' : ''}</figcaption></figure>`).join('')}</div>`;
  await q.setViewport({ width: shots.length * (cell + 10) + 30, height: cell + 80 });
  await q.setContent(html, { waitUntil: 'networkidle0' });
  await q.screenshot({ path: out, fullPage: true });
  await b2.close();
  console.log('saved', out, '| console errors:', errs.length);
})();
