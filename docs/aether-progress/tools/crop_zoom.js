// 画像の一部を切り出して拡大した比較画像を作る。
//
// なぜ要るか: シルエットの多角形っぽさ・肌理の粗さは、全体像を並べても分からない。
// 輪郭のごく一部を等倍以上で見ないと判断できない。
// `compose.js` は全体を 520px へ縮めてしまうので、そちらでは代用できない。
//
// 使い方: node crop_zoom.js <出力.png> <倍率> "<見出し>=<画像>#<x>,<y>,<w>" ...
//   x,y,w は元画像のピクセル座標（切り出しは正方形）
//   例) node crop_zoom.js out.png 4 "現状=a.png#120,300,150"
const puppeteer = require('/Users/kuritashinnosuke/Desktop/private/works/sound-sculpture/git/sound-sculpture/node_modules/puppeteer-core');
const os = require('os'), path = require('path'), fs = require('fs');
const CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

(async () => {
  const out = process.argv[2];
  const zoom = Number(process.argv[3] || 3);
  const items = process.argv.slice(4).map((arg) => {
    const at = arg.indexOf('=');
    const label = arg.slice(0, at);
    const rest = arg.slice(at + 1);
    const hash = rest.lastIndexOf('#');
    const file = rest.slice(0, hash);
    const [x, y, w] = rest.slice(hash + 1).split(',').map(Number);
    return { label, x, y, w, src: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` };
  });
  if (!out || !items.length) {
    console.error('usage: node crop_zoom.js <out.png> <zoom> "<label>=<file>#<x>,<y>,<w>" ...');
    process.exit(1);
  }

  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #12161c; color: #e8eef5;
           font: 15px/1.4 -apple-system, "Hiragino Sans", sans-serif; }
    .grid { display: flex; gap: 18px; padding: 18px; align-items: flex-start; }
    figure { margin: 0; }
    .win { overflow: hidden; border-radius: 6px; }
    figcaption { padding: 8px 2px 0; }
  </style><div class="grid">${items
    .map((i) => {
      const size = Math.round(i.w * zoom);
      return `<figure>
        <div class="win" style="width:${size}px;height:${size}px">
          <img src="${i.src}" style="
            image-rendering: pixelated;
            transform-origin: 0 0;
            transform: scale(${zoom}) translate(${-i.x}px, ${-i.y}px);
            display:block;">
        </div>
        <figcaption>${i.label}</figcaption>
      </figure>`;
    })
    .join('')}</div>`;

  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars'] });
  const p = await b.newPage();
  await p.setViewport({ width: 2400, height: 1400 });
  await p.setContent(html, { waitUntil: 'networkidle0' });
  const el = await p.$('.grid');
  await el.screenshot({ path: out });
  console.log('saved', out);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
