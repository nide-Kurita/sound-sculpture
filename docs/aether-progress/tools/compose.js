// 複数の PNG を見出し付きで並べた1枚の比較画像を作る。
//
// 「見た目の判断は主観で報告しない。参考と現状を並べた画像を作って見せる」
// （ユーザーとの合意事項）を満たすための道具。ImageMagick を入れずに済ませるため、
// puppeteer で HTML を描いてスクリーンショットしている。
//
// 使い方: node compose.js <出力.png> <列数> "<見出し>=<画像>" ["<見出し>=<画像>" ...]
//   例) node compose.js out.png 2 "映り込み OFF=a.png" "映り込み ON=b.png"
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const out = process.argv[2];
  const columns = Number(process.argv[3] || 2);
  const items = process.argv.slice(4).map((arg) => {
    const at = arg.indexOf('=');
    const label = arg.slice(0, at);
    const file = arg.slice(at + 1);
    return { label, src: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` };
  });
  if (!out || !items.length) {
    console.error('usage: node compose.js <out.png> <columns> "<label>=<file>" ...');
    process.exit(1);
  }

  const cell = 520;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #12161c; color: #e8eef5;
           font: 15px/1.4 -apple-system, "Hiragino Sans", sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, ${cell}px); gap: 18px; padding: 18px; }
    figure { margin: 0; }
    img { width: ${cell}px; height: ${cell}px; display: block; border-radius: 6px; }
    figcaption { padding: 8px 2px 0; letter-spacing: 0.02em; }
  </style><div class="grid">${items
    .map((i) => `<figure><img src="${i.src}"><figcaption>${i.label}</figcaption></figure>`)
    .join('')}</div>`;

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--hide-scrollbars'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: columns * cell + (columns + 1) * 18, height: 200 });
  await p.setContent(html, { waitUntil: 'load' });
  const box = await p.evaluate(() => {
    const g = document.querySelector('.grid');
    return { w: Math.ceil(g.scrollWidth), h: Math.ceil(g.scrollHeight) };
  });
  await p.setViewport({ width: box.w + 18, height: box.h + 18 });
  await p.screenshot({ path: out });
  console.log('saved', out, `${box.w + 18}x${box.h + 18}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
