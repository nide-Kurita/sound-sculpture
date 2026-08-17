// 完成形の「造形の種類」を数える。シルエットの差の**量**ではなく**種類**の指標。
//
// なぜ要るか: 2026-08-10、シルエット差は床の12〜25倍出ているのにユーザーの評価は
// 「トゲトゲしているだけの違いしかない」「ワクワクしない」だった。
// つまり xor/union をいくら大きくしても足りない。足りないのは
// **穴が開く・枝が分かれる・塊が割れる**といった位相の語彙。
// vita（球の半径変形）は原理的にこれが 0 のままで、volume（密度場＋等値面）は出せる。
// その差を目視ではなく数で示すための道具。
//
// 出す数:
//   holes      本体に囲まれた背景領域の数（＝シルエット上の貫通穴）と、その面積比
//   parts      本体の連結成分の数（2以上 = 破片が浮いている）
//   perimeter  周囲長 / sqrt(面積)。輪郭の入り組み具合。円で約 3.54、複雑なほど大きい
//
// 使い方: node topology.js img1.png img2.png ...
const path = require('path');
const { decode } = require('./png.js');

// 背景は左右端8pxから行ごとに推定（vita/volume とも上下グラデーションのドーム）
const bodyMask = (img) => {
  const { width: w, height: h, bpp, data } = img;
  const stride = w * bpp;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let br = 0, bg = 0, bb = 0, c = 0;
    for (let x = 0; x < 8; x++) {
      for (const xx of [x, w - 1 - x]) {
        const i = y * stride + xx * bpp;
        br += data[i]; bg += data[i + 1]; bb += data[i + 2]; c++;
      }
    }
    br /= c; bg /= c; bb /= c;
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * bpp;
      const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
      if (d > 34) mask[y * w + x] = 1;
    }
  }
  return mask;
};

// 星（背景の1〜2px の輝点）を落とす。落とさないと「破片」として数えてしまう
const despeckle = (mask, w, h) => {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (mask[(y + dy) * w + (x + dx)]) n++;
      if (n >= 6) out[y * w + x] = 1;
    }
  }
  return out;
};

// 4近傍の連結成分。value と一致する画素だけを辿る
const components = (mask, w, h, value) => {
  const seen = new Uint8Array(w * h);
  const sizes = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || mask[s] !== value) continue;
    let top = 0, size = 0;
    stack[top++] = s;
    seen[s] = 1;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const px = p % w, py = (p / w) | 0;
      if (px > 0 && !seen[p - 1] && mask[p - 1] === value) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (px < w - 1 && !seen[p + 1] && mask[p + 1] === value) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (py > 0 && !seen[p - w] && mask[p - w] === value) { seen[p - w] = 1; stack[top++] = p - w; }
      if (py < h - 1 && !seen[p + w] && mask[p + w] === value) { seen[p + w] = 1; stack[top++] = p + w; }
    }
    sizes.push({ size, seed: s });
  }
  return sizes;
};

// 画像の縁に触れていない背景の連結成分 = 本体に囲まれた穴
const holes = (mask, w, h) => {
  const bg = components(mask, w, h, 0);
  const touchesBorder = (seed) => {
    // seed から辿り直すより、成分ごとに縁の画素を持つかを別途調べるほうが速い。
    // ここでは縁の背景画素から塗った「外側」を作り、それに含まれない成分を穴とする。
    return false;
  };
  void touchesBorder;
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (p) => { if (!outside[p] && mask[p] === 0) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top > 0) {
    const p = stack[--top];
    const px = p % w, py = (p / w) | 0;
    if (px > 0) push(p - 1);
    if (px < w - 1) push(p + 1);
    if (py > 0) push(p - w);
    if (py < h - 1) push(p + w);
  }
  return bg.filter((c) => !outside[c.seed]);
};

const perimeter = (mask, w, h) => {
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) { n++; continue; }
      if (!mask[y * w + x - 1] || !mask[y * w + x + 1] || !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x]) n++;
    }
  }
  return n;
};

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node topology.js img1.png img2.png ...');
  process.exit(1);
}
console.log('file                                   穴  穴の面積比  破片  周囲長/√面積  本体面積');
for (const f of files) {
  const img = decode(f);
  const raw = bodyMask(img);
  const mask = despeckle(raw, img.width, img.height);
  const area = mask.reduce((a, b) => a + b, 0);
  // 面積 20px 未満は数えない（アンチエイリアスの穴・ノイズ）
  const hs = holes(mask, img.width, img.height).filter((c) => c.size >= 20);
  const parts = components(mask, img.width, img.height, 1).filter((c) => c.size >= 40);
  const holeArea = hs.reduce((a, c) => a + c.size, 0);
  const per = perimeter(mask, img.width, img.height);
  console.log(
    `${path.basename(f).replace(/-2026.*yaw/, ' yaw').replace('.png', '').padEnd(38)}` +
    `${String(hs.length).padStart(3)}  ${((holeArea / Math.max(1, area)) * 100).toFixed(2).padStart(8)}%  ` +
    `${String(parts.length).padStart(4)}  ${(per / Math.sqrt(Math.max(1, area))).toFixed(2).padStart(11)}  ` +
    `${((area / (img.width * img.height)) * 100).toFixed(1).padStart(6)}%`,
  );
}
console.log('（円なら 周囲長/√面積 ≈ 3.54。穴・破片が 0 のままなら位相の語彙が無い）');
