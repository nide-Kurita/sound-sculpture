// 粘土の肌理（clay-grain.ts）の強さを同一ロード内で振って、彫刻を等倍で切り出す。
//
// なぜ切り出すか: 肌理は高周波なので、900x900 を比較画像の 520px セルへ縮小すると
// 消えてしまい「差が無い」と誤読する。中央を等倍でクリップして撮る。
// なぜ同一ロードか: シードはロードごとにランダムで、別々に起動すると形自体が変わる
// （docs/handoff/VITA.md 6章）。
//
// 使い方: node grain_sweep_shot.js <出力接頭辞> <URL> <待ちms> <complete:0|1> <strength[@scale]...>
//   例) node grain_sweep_shot.js /tmp/grain "http://localhost:5174/?style=vita&surface=dev" 9000 0 0 0.55 1.2
//   → /tmp/grain-0.png /tmp/grain-0.55.png /tmp/grain-1.2.png
//   scale も振るなら "2@80" のように書く（省略時はパネルの既定のまま）。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const setGrain = (strength, scale) => {
  const inputs = [...document.querySelectorAll('#grain-sliders input[type="range"]')];
  const apply = (input, value) => {
    if (!input || value === null) return null;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return Number(input.value);
  };
  return [apply(inputs[0], strength), apply(inputs[1], scale)];
};

(async () => {
  const outPrefix = process.argv[2];
  const url = process.argv[3] || 'http://localhost:5174/?style=vita&surface=dev';
  const wait = Number(process.argv[4] || 9000);
  const doComplete = process.argv[5] === '1';
  const values = process.argv.slice(6).map((arg) => {
    const [strength, scale] = arg.split('@');
    return { label: arg, strength: Number(strength), scale: scale === undefined ? null : Number(scale) };
  });
  if (!outPrefix || !values.length) {
    console.error('usage: node grain_sweep_shot.js <outPrefix> <url> <waitMs> <complete:0|1> <strength...>');
    process.exit(1);
  }

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, wait));

  if (doComplete) {
    await p.evaluate(() => {
      const btn = document.querySelector('#complete-sculpture');
      if (btn) { btn.disabled = false; btn.click(); }
    });
    await new Promise(r => setTimeout(r, 9000)); // 完成アニメーション6秒 + 余裕
  }

  // UI を隠して canvas だけにする
  await p.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    if (!cs.length) return;
    const c = cs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const keep = new Set();
    for (let e = c; e; e = e.parentElement) keep.add(e);
    document.querySelectorAll('body *').forEach(e => { if (!keep.has(e)) e.style.visibility = 'hidden'; });
  });
  await new Promise(r => setTimeout(r, 500));

  for (const value of values) {
    const applied = await p.evaluate(setGrain, value.strength, value.scale);
    await new Promise(r => setTimeout(r, 900));
    const file = `${outPrefix}-${value.label.replace('@', 'x')}.png`;
    await p.screenshot({ path: file, clip: { x: 225, y: 225, width: 450, height: 450 } });
    console.log(`strength/scale ${JSON.stringify(applied)} → ${file}`);
  }

  console.log('console errors:', errs.length ? errs : 'none');
  await b.close();
})();
