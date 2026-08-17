// `maturity_probe.js` が記録した 9 曲の時系列から、**熟成度の正規化を決める**（worklist [P1] step 0）。
//
// 「徐々に完成へ向かう」を数式にすると **maturity が曲の進行度に比例して上がること**
// （曲の 50% 地点で 0.45、終端で 0.9）。終端値だけを条件にすると、曲の 2% で 0.75 まで
// 跳ね上がる解が「最良」になってしまう（2026-08-13 に実際そうなった）。したがって
// **目的関数は「進行度との差の平均」**にする。
//
// 変換は maturity = clamp01((x / K)^p) * CEILING。
//   - 蓄積量は序盤で急に伸びる（前のめり）ので、**p > 1 の凸変換**で直線へ近づける。
//   - K は「その値で天井」。曲ごとに終端値が 2.6〜8.5 倍ちがうので、K を大きくすると
//     静かな曲が終端で低くなり、小さくすると激しい曲が序盤で天井に張り付く。
//     このトレードオフが「蓄積量だけ」の限界そのもの。数字で出す。
//
// 使い方: node maturity_fit.js <maturity_probe の outDir> [指標名]
const fs = require('fs'), path = require('path');

const dir = process.argv[2];
const key = process.argv[3] || 'scalarMean';
const CEILING = 0.9;

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'summary.json');
const songs = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const maturityOf = (x, K, p) => clamp01(Math.pow(Math.max(0, x) / K, p)) * CEILING;

const evaluate = (K, p) => {
  let sum = 0, n = 0, worst = 0, minFinal = 1;
  for (const s of songs) {
    const total = s.series[s.series.length - 1].t;
    for (const pt of s.series) {
      const ideal = (pt.t / total) * CEILING;
      const d = Math.abs(maturityOf(pt[key], K, p) - ideal);
      sum += d; n += 1;
      if (d > worst) worst = d;
    }
    minFinal = Math.min(minFinal, maturityOf(s.series[s.series.length - 1][key], K, p));
  }
  return { mean: sum / n, worst, minFinal };
};

let best = null;
for (let K = 0.05; K <= 6.0; K += 0.05) {
  for (let p = 0.5; p <= 4.0; p += 0.05) {
    const e = evaluate(K, p);
    if (!best || e.mean < best.e.mean) best = { K, p, e };
  }
}

const { K, p, e } = best;
console.log(`指標 ${key} / maturity = clamp01((x/${K.toFixed(2)})^${p.toFixed(2)}) * ${CEILING}`);
console.log(`進行度との差: 平均 ${e.mean.toFixed(3)} / 最大 ${e.worst.toFixed(3)} / 終端の最小 ${e.minFinal.toFixed(3)}\n`);
console.log('曲                        秒    25%地点  50%地点  75%地点   終端   （理想 0.225 / 0.45 / 0.675 / 0.9）');
const at = (s, frac) => {
  const total = s.series[s.series.length - 1].t;
  const pt = s.series.find((q) => q.t >= total * frac) || s.series[s.series.length - 1];
  return maturityOf(pt[key], K, p);
};
for (const s of songs.sort((a, b) => a.series[a.series.length - 1][key] - b.series[b.series.length - 1][key])) {
  const last = s.series[s.series.length - 1];
  console.log(`${s.song.slice(0, 24).padEnd(24)}${String(last.t).padStart(4)}  ` +
    `${at(s, 0.25).toFixed(3).padStart(8)} ${at(s, 0.5).toFixed(3).padStart(8)} ` +
    `${at(s, 0.75).toFixed(3).padStart(8)} ${at(s, 1).toFixed(3).padStart(6)}`);
}
