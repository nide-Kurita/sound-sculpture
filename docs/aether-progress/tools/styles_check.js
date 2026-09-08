// 全スタイルを短く再生して console error と読み出しの有無を確認する（[P0] の巻き込み確認）。
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const STYLES = ['vita', 'aether', 'volume', 'monolith', 'metamorphosis', 'lumen', 'dither'];
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  for (const style of STYLES) {
    const p = await b.newPage();
    await p.setViewport({ width: 700, height: 700 });
    const errs = [];
    p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !t.includes('404')) errs.push(t); });
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await p.goto(`http://localhost:5173/?style=${style}&surface=dev`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 5000));
    await p.evaluate(() => document.querySelector('#start-dev-audio')?.click());
    await new Promise((r) => setTimeout(r, 700));
    await p.evaluate(() => {
      const sel = document.querySelector('#dev-audio-track');
      if (!sel) return;
      const opt = [...sel.options].find((o) => o.textContent.normalize('NFC').includes('Fury'));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await new Promise((r) => setTimeout(r, 6000));
    await p.evaluate(() => document.querySelector('#begin-recording')?.click());
    await new Promise((r) => setTimeout(r, 25000));
    const info = await p.evaluate(() => ({
      maturityPanel: !document.querySelector('#maturity-panel')?.hidden,
      hasLive: typeof window.__live !== 'undefined',
      maturity: window.__maturity?.maturity ?? null,
    }));
    console.log(`${style.padEnd(14)} errors=${errs.length} 熟成度パネル=${info.maturityPanel} __live=${info.hasLive}` +
      (errs.length ? '\n   ' + errs.slice(0, 3).join('\n   ') : ''));
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
