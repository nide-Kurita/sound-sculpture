// headless の Chrome for Testing で Dev Audio を実際に再生できるかを確かめる。
//
// なぜ要るか: 「headless では m4a / mp3 を再生できない」ため実機セッションが必要、
// というのが長らくの前提だった（proprietary codec が入っていない）。
// **しかし WAV は proprietary ではない。** afconvert で WAV に変換すれば、
// 曲を通した完成形を headless で作れる可能性がある。
// それが通れば、比較のたびにユーザーへ 20〜30 分の再生を頼まずに済む。
//
// ここで確かめるのは3つ:
//   1. AudioContext が resume できるか（autoplay policy に阻まれないか）
//   2. 音の解析が進んでいるか（HUD の LOW/MID/HIGH が動くか）
//   3. 彫刻が育っているか（本体の面積が増えるか）
//
// 使い方: node play_probe.js [URL] [トラック名の一部] [再生秒数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const { decode } = require('./png.js');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?style=vita&surface=dev';
  const trackHint = process.argv[3] || 's04';
  const seconds = Number(process.argv[4] || 20);
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio',
      // ユーザー操作なしでも AudioContext を動かす（headless に人はいない）
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 900 });
  const errs = [];
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  // Dev Audio を選ぶ → トラックを選ぶ → 録音開始
  await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
  await new Promise(r => setTimeout(r, 800));
  const picked = await p.evaluate((hint) => {
    const sel = document.querySelector('#dev-audio-track');
    if (!sel) return null;
    const opt = [...sel.options].find(o => o.textContent.includes(hint));
    if (!opt) return { error: 'track not found', options: [...sel.options].map(o => o.textContent) };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, trackHint);
  console.log('track:', JSON.stringify(picked));
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());
  await new Promise(r => setTimeout(r, 3000));

  const readState = () => p.evaluate(() => ({
    status: document.querySelector('#hud-status')?.textContent ?? '',
    low: document.querySelector('#hud-low')?.textContent ?? '',
    mid: document.querySelector('#hud-mid')?.textContent ?? '',
    high: document.querySelector('#hud-high')?.textContent ?? '',
    timecode: document.querySelector('#hud-timecode')?.textContent ?? '',
    ctx: window.__probeCtxState ?? 'n/a',
  }));

  const bodyArea = async () => {
    const f = path.join(os.tmpdir(), `probe-${Date.now()}.png`);
    await p.screenshot({ path: f });
    const img = decode(f);
    // 背景（左右端8px）から行ごとの背景を推定して本体画素を数える
    const stride = img.width * img.bpp;
    let n = 0;
    for (let y = 0; y < img.height; y++) {
      let r = 0, g = 0, bb = 0, c = 0;
      for (let x = 0; x < 8; x++) {
        for (const xx of [x, img.width - 1 - x]) {
          const i = y * stride + xx * img.bpp;
          r += img.data[i]; g += img.data[i + 1]; bb += img.data[i + 2]; c++;
        }
      }
      r /= c; g /= c; bb /= c;
      for (let x = 0; x < img.width; x++) {
        const i = y * stride + x * img.bpp;
        if (Math.abs(img.data[i] - r) + Math.abs(img.data[i + 1] - g) + Math.abs(img.data[i + 2] - bb) > 24) n++;
      }
    }
    return ((n / (img.width * img.height)) * 100).toFixed(2) + '%';
  };

  console.log('開始直後:', JSON.stringify(await readState()), '本体面積', await bodyArea());
  const step = Math.max(5, Math.floor(seconds / 4));
  for (let t = step; t <= seconds; t += step) {
    await new Promise(r => setTimeout(r, step * 1000));
    console.log(`${t}秒:`, JSON.stringify(await readState()), '本体面積', await bodyArea());
  }

  console.log('console errors:', errs.length ? errs : 'none');
  await b.close();
})();
