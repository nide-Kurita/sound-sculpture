// 撮った PNG の**本体画素**の色相・彩度・明度を出す。
//
// `weather_color_check.js` はブラウザを立ち上げて測るが、こちらは
// **既に撮ってある画像**を測る。`env_color_grid.js` で水準ごとに撮った画像を
// あとから並べて数で比べたいときに使う。
//
// 背景は左右端8pxから行ごとに推定して除外する（背景が天気で変わっても追従する）。
//
// 使い方: node png_hue.js <ディレクトリ>
const { decode } = require('./png.js');
const fs = require('fs'), path = require('path');

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
};

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node png_hue.js <dir>');
  process.exit(1);
}

for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.png')).sort()) {
  const img = decode(path.join(dir, f));
  const stride = img.width * img.bpp;
  let sx = 0, sy = 0, ss = 0, sl = 0, c = 0;
  for (let y = 0; y < img.height; y++) {
    let br = 0, bg = 0, bb = 0, k = 0;
    for (let x = 0; x < 8; x++) {
      for (const xx of [x, img.width - 1 - x]) {
        const i = y * stride + xx * img.bpp;
        br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; k++;
      }
    }
    br /= k; bg /= k; bb /= k;
    for (let x = 0; x < img.width; x++) {
      const i = y * stride + x * img.bpp;
      const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
      if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(bl - bb) < 40) continue;
      const [h, s, l] = rgbToHsl(r, g, bl);
      sx += Math.cos(h * 2 * Math.PI); sy += Math.sin(h * 2 * Math.PI);
      ss += s; sl += l; c++;
    }
  }
  if (!c) { console.log(f.padEnd(28), '本体画素なし'); continue; }
  let h = Math.atan2(sy / c, sx / c) / (2 * Math.PI);
  if (h < 0) h += 1;
  console.log(
    f.padEnd(28),
    'hue', h.toFixed(3),
    'sat', (ss / c).toFixed(3),
    'light', (sl / c).toFixed(3),
    'px', c,
  );
}
