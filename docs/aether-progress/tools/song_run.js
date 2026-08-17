// 曲を1曲まるごと headless で通し、完成形を3方向キャプチャする。
//
// **これが可能だと 2026-08-10 に判明した。** 長らく「headless では m4a / mp3 を
// 再生できないので実機セッションが必要」としていたが、制約は proprietary codec だけで、
// **WAV は再生できる**（`play_probe.js` で確認）。
// afconvert で WAV に変換しておけば、比較のたびにユーザーへ20〜30分の再生を頼まずに済む。
//
// 注意: **形態シードはファイルのバイト列から作られる**ので、
// WAV 版と元の m4a / mp3 版では同じ曲でも別の個体になる。
// WAV どうしの比較（スタイル間・設定間の A/B）には使えるが、
// ユーザーが実機で m4a から撮ったものとは直接突き合わせられない。
//
// 使い方: node song_run.js <URL> <トラック名の一部> <出力ディレクトリ> [タイムアウト秒]
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const url = process.argv[2];
  const trackHint = process.argv[3];
  const outDir = process.argv[4];
  const timeoutSec = Number(process.argv[5] || 900);
  if (!url || !trackHint || !outDir) {
    console.error('usage: node song_run.js <url> <trackHint> <outDir> [timeoutSec]');
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
  if (!picked) {
    console.error(`[${trackHint}] トラックが見つからない`);
    await b.close();
    process.exit(1);
  }
  console.log(`[${picked}] 再生開始`);
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate(() => document.querySelector('#begin-recording')?.click());

  // 曲が終わると PLAYBACK_END_SECONDS_TO_COMPLETE 後に自動で完成する。
  // STATUS が COMPLETE になるまで待つ（曲の長さは知らなくてよい）。
  const started = Date.now();
  let completed = false;
  while ((Date.now() - started) / 1000 < timeoutSec) {
    await new Promise(r => setTimeout(r, 10000));
    const st = await p.evaluate(() => ({
      status: document.querySelector('#hud-status')?.textContent ?? '',
      tc: document.querySelector('#hud-timecode')?.textContent ?? '',
    }));
    if (st.status.toUpperCase().includes('COMPLETE')) { completed = true; break; }
    if (((Date.now() - started) / 1000) % 60 < 10) {
      console.log(`  [${picked}] ${st.status} ${st.tc}`);
    }
  }
  if (!completed) {
    console.error(`[${picked}] タイムアウト。完成しなかった`);
    await b.close();
    process.exit(1);
  }
  console.log(`[${picked}] 完成。落ち着くまで待って撮影`);
  await new Promise(r => setTimeout(r, 12000)); // 完成アニメーション6秒 + 余裕

  await p.evaluate(() => document.querySelector('#capture-verify')?.click());
  await new Promise(r => setTimeout(r, 4000));
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
  console.log(`[${picked}] 保存 ${files.length} 枚`);
  console.log(`[${picked}] console errors:`, errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})();
