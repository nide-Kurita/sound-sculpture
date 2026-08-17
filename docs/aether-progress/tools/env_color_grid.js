// 天気・時刻による色変化を「画像で」並べて見せるためのキャプチャ。
//
// なぜ要るか: `weather_color_check.js` は色相の広がりを数で出すが、
// 「その広がりが強すぎるか弱すぎるか」は数では決まらない。
// 「見た目の判断は主観で報告しない。参考と現状を並べた画像を作って見せる」
// （ユーザーとの合意事項）を満たすため、同じ画角で天気・時刻を振って撮る。
//
// **待機状態で撮ってはいけない。** 待機の粒は画面の 6% ほどしか無く、
// 並べても色の差が読めない（2026-08-11 に一度やって失敗した）。
// 曲を聴かせて Complete まで進め、**形が凍った完成後**に環境だけ振る。
// こうすると形は全カット共通なので、差は色だけになる。
//
// 使い方: node env_color_grid.js <出力ディレクトリ> <接頭辞> <トラック名の一部> [URL] [形成秒数]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const HOURS = [3, 9, 15, 21];
const WEATHERS = ['clear', 'overcast', 'rain', 'snow', 'thunderstorm'];

(async () => {
  const outDir = process.argv[2];
  const prefix = process.argv[3];
  const trackHint = process.argv[4] || 's04';
  const url = process.argv[5] || 'http://localhost:5173/?style=volume';
  const formSec = Number(process.argv[6] || 60);
  if (!outDir || !prefix) {
    console.error('usage: node env_color_grid.js <outDir> <prefix> <trackHint> [url] [formSec]');
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

  await p.evaluate(() => {
    const btn = document.querySelector('#complete-sculpture');
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await new Promise(r => setTimeout(r, 12000)); // 完成アニメーション6秒 + 余裕
  console.log('完成。ここから環境だけ振る');

  const setPreset = (id) => p.evaluate((v) => {
    const sel = document.querySelector('#weather-preview-preset');
    if (!sel) return 'no-select';
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value;
  }, id);
  const setHour = (h) => p.evaluate((v) => {
    const input = document.querySelector('#daytime-preview-hour');
    if (!input) return 'no-input';
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  }, h);

  // 検証用キャプチャは向き・画角・解像度が固定なので、カットどうしを直接比べられる。
  // **クリック前後の差分だけを触る。** 出力ディレクトリを使い回すことがあるので、
  // 「接頭辞が違うファイルは捨てる」ようなやり方をすると別水準の結果を消す
  // （2026-08-11 に実際に A と B を全部消した）。
  const shoot = async (name) => {
    // 完成後の色は lerp で追従するが、`update()` が dt を 0.05 に制限しているので
    // 1フレームあたり最大 4.5% しか進まない。swiftshader は 10fps 前後なので
    // **2.5秒では6割しか到達していなかった**（2026-08-11、これで測定を丸ごと誤診した）。
    // 10秒待つ。ここを縮めるなら、縮めたぶん結論も疑うこと。
    await new Promise(r => setTimeout(r, 10000));
    const before = new Set(fs.readdirSync(outDir));
    await p.evaluate(() => document.querySelector('#capture-verify')?.click());
    await new Promise(r => setTimeout(r, 3500));
    const fresh = fs.readdirSync(outDir).filter(f => f.endsWith('.png') && !before.has(f));
    let n = 0;
    for (const f of fresh) {
      // 検証用キャプチャは3方向出るので、正面（yaw0）だけ残して他は捨てる
      if (f.includes('yaw0')) {
        fs.renameSync(path.join(outDir, f), path.join(outDir, `${prefix}-${name}.png`));
        n++;
      } else {
        fs.unlinkSync(path.join(outDir, f));
      }
    }
    console.log('saved', `${prefix}-${name}.png`, n ? '' : '(!! 取りこぼし)');
  };

  await setPreset('clear');
  for (const h of HOURS) {
    await setHour(h);
    await shoot(`hour-${h}`);
  }
  await setHour(12);
  for (const w of WEATHERS) {
    await setPreset(w);
    await shoot(`weather-${w}`);
  }

  console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
