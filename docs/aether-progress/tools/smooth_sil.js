// 同一ロード・同一個体で「表示の平滑」だけを切り替えて検証用キャプチャを撮る。
// 別 run どうしを比べるとシードが違って形が変わるので、平滑の影響が測れない。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async () => {
  const outDir = process.argv[2];
  const hint = process.argv[3] || 'Fury';
  const formSec = Number(process.argv[4] || 60);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars','--mute-audio','--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const client = await p.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
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
  await p.evaluate(() => { const x = document.querySelector('#complete-sculpture'); if (x) { x.disabled = false; x.click(); } });
  await new Promise(r => setTimeout(r, 13000));
  const shoot = async (tag, v) => {
    await p.evaluate((x) => {
      const i = [...document.querySelectorAll('#smooth-sliders input[type=range]')][0];
      i.value = String(x); i.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await new Promise(r => setTimeout(r, 1500));
    const before = new Set(fs.readdirSync(outDir));
    await p.evaluate(() => document.querySelector('#capture-verify')?.click());
    await new Promise(r => setTimeout(r, 3500));
    for (const f of fs.readdirSync(outDir)) {
      if (f.endsWith('.png') && !before.has(f) && f.includes('yaw0')) {
        fs.renameSync(path.join(outDir, f), path.join(outDir, `${tag}.png`));
      } else if (f.endsWith('.png') && !before.has(f)) {
        fs.unlinkSync(path.join(outDir, f));
      }
    }
  };
  // 0 → 0.55 → 0（3枚目でノイズ床＝同じ設定を2回撮った差が出る）
  await shoot('s0a', 0);
  await shoot('s55', Number(process.env.LV || 0.55));
  await shoot('s0b', 0);
  await b.close();
  console.log(`[${picked.trim()}] saved`);
})();
