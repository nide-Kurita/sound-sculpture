// 完成形シルエットの差を数値にする。
// 要求 A（曲ごとの個性がシルエットに出る）の物差し。色・質感は見ない。
//
// 使い方:
//   node silhouette.js a.png b.png [bgR,bgG,bgB] [crop=x0,y0,x1,y1]
//   node silhouette.js --matrix bgR,bgG,bgB img1.png img2.png img3.png ...
//
// 既定の背景:
//   引数省略時は aether の淡ミント 212,232,225
//   **vita は `auto` を渡すこと。** vita の背景は単色ではなく上下グラデーションの
//   ドームで、`8,40,56`（VITA.env.background の設定値）を渡すと画面全体が本体判定になり
//   cover 100% になる。実測は上端 88,124,168 / 下端 48,74,104 で設定値とは全く違う。
//   `auto` は画像の左右端 8px を行ごとの背景として推定するので、グラデーションでも通る。
//
// 出す数:
//   IoU           体マスクの交差 / 和。1=同じ形、0=重ならない
//   xor/union     1 - IoU。差の面積
//   aspect        bbox の幅/高さ。伸び方の差
//   cover         crop 内で本体が占める割合
//   aligned IoU   重心を合わせてから測った IoU（位置ずれを除いた形の差）
//
// 判定の使い方（COMMON の提案）:
//   同じ曲を2回聴かせた xor/union ＝ 再現性の床
//   別の曲どうしの xor/union がそれを十分超えていれば「遠目で別の形」
//
// 注意:
//   - シードはロードごとに変わる。同じ曲でもファイルハッシュ由来の
//     morphologySeed が無いと比較にならない
//   - aether は無音でもモーフするので、同一ロードで数秒ずらした2枚が床になる
//   - headless の Chrome for Testing は m4a/mp3 を再生できない。
//     曲を通した完成形は実機で撮って、このスクリプトに渡す

const { decode } = require('./png');

const AETHER_BG = [212, 232, 225];
const DIST_THRESH = 24;

function parseBg(s) {
  if (!s) return AETHER_BG;
  // 'auto' = 画像の左右端から行ごとに背景色を推定する（グラデーション背景用）
  if (s === 'auto') return 'auto';
  const n = s.split(',').map(Number);
  if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) {
    throw new Error(`bad bg: ${s}`);
  }
  return n;
}

function parseCrop(s, w, h) {
  const [x0f, y0f, x1f, y1f] = (s || '0.12,0.12,0.88,0.92').split(',').map(Number);
  return {
    x0: Math.floor(w * x0f),
    y0: Math.floor(h * y0f),
    x1: Math.floor(w * x1f),
    y1: Math.floor(h * y1f),
  };
}

/**
 * 行ごとの背景色を画像の左右端から推定する。
 * vita の背景は上下グラデーションのドームなので、1色では分離できない。
 * 本体が左右端まで届いていないことが前提（検証用キャプチャはその画角になっている）。
 */
function estimateRowBackgrounds(img, edge = 8) {
  const { width: w, height: h, bpp, data } = img;
  const rows = new Array(h);
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 0; x < edge; x++) {
      for (const xx of [x, w - 1 - x]) {
        const i = y * w * bpp + xx * bpp;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    rows[y] = [r / n, g / n, b / n];
  }
  return rows;
}

/** 孤立点（星・粒子のきらめき）を落とす。3x3 で過半数が本体でなければ本体としない */
function despeckle(mask, w, h) {
  const out = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          if (mask[yy * w + xx]) n++;
        }
      }
      if (n >= 5) out[y * w + x] = 1;
    }
  }
  return out;
}

function bodyMask(file, bg, cropArg) {
  const img = decode(file);
  const { width: w, height: h, bpp, data } = img;
  const crop = parseCrop(cropArg, w, h);
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const rowBg = bg === 'auto' ? estimateRowBackgrounds(img) : null;
  let mask = Buffer.alloc(cw * ch);
  for (let y = crop.y0; y < crop.y1; y++) {
    const ref = rowBg ? rowBg[y] : bg;
    for (let x = crop.x0; x < crop.x1; x++) {
      const i = y * w * bpp + x * bpp;
      const dist = Math.abs(data[i] - ref[0]) + Math.abs(data[i + 1] - ref[1]) + Math.abs(data[i + 2] - ref[2]);
      if (dist < DIST_THRESH) continue;
      mask[(y - crop.y0) * cw + (x - crop.x0)] = 1;
    }
  }
  // 星は背景側に散る1〜2px の輝点。落とさないと本体マスクに混ざる
  if (rowBg) mask = despeckle(mask, cw, ch);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = cw;
  let minY = ch;
  let maxX = -1;
  let maxY = -1;
  for (let ly = 0; ly < ch; ly++) {
    for (let lx = 0; lx < cw; lx++) {
      if (!mask[ly * cw + lx]) continue;
      count++;
      sumX += lx;
      sumY += ly;
      if (lx < minX) minX = lx;
      if (ly < minY) minY = ly;
      if (lx > maxX) maxX = lx;
      if (ly > maxY) maxY = ly;
    }
  }
  const cx = count ? sumX / count : 0;
  const cy = count ? sumY / count : 0;
  const bw = maxX >= 0 ? maxX - minX + 1 : 0;
  const bh = maxY >= 0 ? maxY - minY + 1 : 0;
  return {
    file,
    w: cw,
    h: ch,
    mask,
    count,
    cx,
    cy,
    aspect: bh > 0 ? bw / bh : 0,
    cover: count / (cw * ch),
    bbox: { w: bw, h: bh },
  };
}

/**
 * bbox を N×N へリサンプルして「大きさを揃えた形」を作る。
 *
 * 素の aligned xor は**大きさの違いも一緒に数えている**。曲どうしを比べたとき
 * 「別の形だから違う」のか「同じ形で大きさが違うだけ」なのかを切り分けるために、
 * bbox を正方形へ正規化したマスクでも測る。
 * 大きさの違いは遠目の印象として立派に効くので、どちらが正しいという話ではない。
 * 2つ並べて見るためのもの。
 */
function normalizedMask(body, size = 256) {
  const out = Buffer.alloc(size * size);
  const { mask, w, h } = body;
  // bbox を測り直す（body には bbox の幅高さしか無い）
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { mask: out, w: size, h: size, count: 0, cx: 0, cy: 0 };
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  let count = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < size; y++) {
    const sy = minY + Math.floor((y * bh) / size);
    for (let x = 0; x < size; x++) {
      const sx = minX + Math.floor((x * bw) / size);
      if (!mask[sy * w + sx]) continue;
      out[y * size + x] = 1;
      count++;
      sumX += x;
      sumY += y;
    }
  }
  return {
    mask: out,
    w: size,
    h: size,
    count,
    cx: count ? sumX / count : 0,
    cy: count ? sumY / count : 0,
  };
}

function overlap(a, b, dx, dy) {
  let inter = 0;
  let union = 0;
  const w = a.w;
  const h = a.h;
  for (let y = 0; y < h; y++) {
    const by = y - dy;
    for (let x = 0; x < w; x++) {
      const av = a.mask[y * w + x];
      const bx = x - dx;
      const bv = by >= 0 && by < b.h && bx >= 0 && bx < b.w ? b.mask[by * b.w + bx] : 0;
      if (av || bv) union++;
      if (av && bv) inter++;
    }
  }
  return { inter, union };
}

function pairMetrics(a, b) {
  const raw = overlap(a, b, 0, 0);
  const dx = Math.round(b.cx - a.cx);
  const dy = Math.round(b.cy - a.cy);
  const aligned = overlap(a, b, dx, dy);
  const iou = raw.union ? raw.inter / raw.union : 0;
  const iouA = aligned.union ? aligned.inter / aligned.union : 0;
  return {
    iou,
    xorUnion: 1 - iou,
    alignedIou: iouA,
    alignedXor: 1 - iouA,
    aspectA: a.aspect,
    aspectB: b.aspect,
    dAspect: Math.abs(a.aspect - b.aspect),
    coverA: a.cover,
    coverB: b.cover,
    dCover: Math.abs(a.cover - b.cover),
    bodyA: a.count,
    bodyB: b.count,
  };
}

function fmt(n, d = 3) {
  return n.toFixed(d);
}

function printPair(aPath, bPath, m) {
  console.log(`${aPath}  vs  ${bPath}`);
  console.log(`  body px          ${m.bodyA} / ${m.bodyB}`);
  console.log(`  IoU              ${fmt(m.iou)}   xor/union ${fmt(m.xorUnion)}`);
  console.log(`  aligned IoU      ${fmt(m.alignedIou)}   xor/union ${fmt(m.alignedXor)}  (重心合わせ)`);
  console.log(`  aspect (w/h)     ${fmt(m.aspectA, 3)} / ${fmt(m.aspectB, 3)}   |Δ| ${fmt(m.dAspect, 3)}`);
  console.log(`  cover            ${fmt(m.coverA * 100, 1)}% / ${fmt(m.coverB * 100, 1)}%   |Δ| ${fmt(m.dCover * 100, 1)}pt`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--matrix') {
    const bg = parseBg(args[1]);
    const files = args.slice(2);
    if (files.length < 2) {
      console.error('usage: node silhouette.js --matrix bgR,bgG,bgB img1.png img2.png ...');
      process.exit(1);
    }
    const bodies = files.map((f) => bodyMask(f, bg));
    console.log('aligned xor/union matrix (lower = more similar silhouette)');
    console.log(['', ...files.map((f) => f.split('/').pop())].join('\t'));
    for (let i = 0; i < bodies.length; i++) {
      const row = [files[i].split('/').pop()];
      for (let j = 0; j < bodies.length; j++) {
        if (i === j) {
          row.push('0');
          continue;
        }
        row.push(fmt(pairMetrics(bodies[i], bodies[j]).alignedXor));
      }
      console.log(row.join('\t'));
    }
    console.log('');
    console.log('大きさを揃えた（bbox を 256x256 へ正規化した）xor/union');
    console.log('  素の表との差が小さければ「大きさではなく形が違う」と言える');
    const normed = bodies.map((b) => normalizedMask(b));
    console.log(['', ...files.map((f) => f.split('/').pop())].join('\t'));
    for (let i = 0; i < normed.length; i++) {
      const row = [files[i].split('/').pop()];
      for (let j = 0; j < normed.length; j++) {
        if (i === j) {
          row.push('0');
          continue;
        }
        const dx = Math.round(normed[j].cx - normed[i].cx);
        const dy = Math.round(normed[j].cy - normed[i].cy);
        const o = overlap(normed[i], normed[j], dx, dy);
        row.push(fmt(o.union ? 1 - o.inter / o.union : 0));
      }
      console.log(row.join('\t'));
    }
    console.log('');
    console.log('aspect (w/h):');
    for (const b of bodies) {
      console.log(`  ${b.file.split('/').pop()}: ${fmt(b.aspect, 3)}  cover ${fmt(b.cover * 100, 1)}%`);
    }
    return;
  }

  const aPath = args[0];
  const bPath = args[1];
  if (!aPath || !bPath) {
    console.error('usage: node silhouette.js a.png b.png [bgR,bgG,bgB] [crop]');
    console.error('       node silhouette.js --matrix bgR,bgG,bgB img1.png img2.png ...');
    process.exit(1);
  }
  const bg = parseBg(args[2]);
  const crop = args[3];
  const a = bodyMask(aPath, bg, crop);
  const b = bodyMask(bPath, bg, crop);
  printPair(aPath, bPath, pairMetrics(a, b));
}

main();
