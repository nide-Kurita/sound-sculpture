// 完成形の「曲による色の振れ幅」を測る。
//
// なぜ要るか: 2026-08-10、ユーザーが「色が前に出過ぎている。色は脇役」と明言した。
// 色を脇役へ戻す作業の前後で、**曲による色相のばらつきがどれだけ縮んだか**を数値で見る。
// ただし縮めすぎて曲ごとの色差が消えるのも誤り（「曲ごとに色の違いが出るのは面白い」）。
// 気候・時間・環境による変化のほうが主役になっていればよい。
//
// 出す数:
//   本体画素の平均色相（円周平均）と彩度・明度
//   曲間の色相の広がり（最大の角度差。0.5 = 補色まで開いている）
//
// 使い方: node hue_spread.js img1.png img2.png ...
const path = require('path');
const { decode } = require('./png.js');

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
};

// 本体だけを取る。背景は左右端8pxから行ごとに推定（vita は上下グラデーション）
const bodyStats = (file) => {
  const img = decode(file);
  const stride = img.width * img.bpp;
  let sx = 0, sy = 0, ssat = 0, slig = 0, n = 0;
  for (let y = 0; y < img.height; y++) {
    let br = 0, bg = 0, bb = 0, c = 0;
    for (let x = 0; x < 8; x++) {
      for (const xx of [x, img.width - 1 - x]) {
        const i = y * stride + xx * img.bpp;
        br += img.data[i]; bg += img.data[i + 1]; bb += img.data[i + 2]; c++;
      }
    }
    br /= c; bg /= c; bb /= c;
    for (let x = 0; x < img.width; x++) {
      const i = y * stride + x * img.bpp;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < 34) continue;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (s < 0.08) continue; // 無彩色は色相が定義できない
      // 色相は角度なので円周平均を取る（0.99 と 0.01 の平均は 0 であって 0.5 ではない）
      sx += Math.cos(h * 2 * Math.PI);
      sy += Math.sin(h * 2 * Math.PI);
      ssat += s; slig += l; n++;
    }
  }
  if (!n) return null;
  let h = Math.atan2(sy / n, sx / n) / (2 * Math.PI);
  if (h < 0) h += 1;
  return { hue: h, sat: ssat / n, light: slig / n, px: n };
};

const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node hue_spread.js img1.png img2.png ...');
  process.exit(1);
}
const stats = files.map((f) => ({ f, ...(bodyStats(f) || {}) }));
for (const s of stats) {
  console.log(`  ${path.basename(s.f)}  hue ${s.hue.toFixed(3)}  sat ${s.sat.toFixed(3)}  light ${s.light.toFixed(3)}`);
}
let maxD = 0, pair = null;
for (let i = 0; i < stats.length; i++) {
  for (let j = i + 1; j < stats.length; j++) {
    const d = hueDist(stats[i].hue, stats[j].hue);
    if (d > maxD) { maxD = d; pair = [stats[i].f, stats[j].f]; }
  }
}
const sats = stats.map((s) => s.sat);
console.log(`曲間の色相の広がり（最大）: ${maxD.toFixed(3)}  (0.5 = 補色まで開いている)`);
if (pair) console.log(`  最も遠い組: ${path.basename(pair[0])} ↔ ${path.basename(pair[1])}`);
console.log(`彩度の幅: ${Math.min(...sats).toFixed(3)} 〜 ${Math.max(...sats).toFixed(3)}  (幅 ${(Math.max(...sats) - Math.min(...sats)).toFixed(3)})`);
