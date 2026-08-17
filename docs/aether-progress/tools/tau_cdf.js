// 診断ショット（R=tau/1.5, B=1 で塗った画素だけが本体）から tau の CDF を出す。
// 使い方: node tau_cdf.js diag.png [absorption]
const { decode } = require('./png');

const img = decode(process.argv[2] || 'diag.png');
const k = Number(process.argv[3] || 1.5);
const { width: w, height: h, bpp, data } = img;

const x0 = Math.floor(w * 0.15), x1 = Math.floor(w * 0.85);
const y0 = Math.floor(h * 0.18), y1 = Math.floor(h * 0.90);

const taus = [];
let aura = 0;
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) {
    const i = y * w * bpp + x * bpp;
    // 診断塗りは B=255・G=0。背景（淡ミント）は G が高いので弾ける
    if (data[i + 2] !== 255 || data[i + 1] !== 0) continue;
    const tau = (data[i] / 255) * 1.5;
    // tau < 0.06 は解析オーラの裾で、色としてはほぼ背景。本体の分布から除く
    if (tau < 0.06) { aura++; continue; }
    taus.push(tau);
  }
}
taus.sort((a, b) => a - b);
const n = taus.length;
console.log(`body px = ${n}  (aura tail px = ${aura})`);
if (!n) process.exit(0);

const q = (p) => taus[Math.min(n - 1, Math.floor(n * p))];
console.log('percentile -> tau -> depth(1-exp(-tau*k)), k=' + k);
for (const p of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99, 1]) {
  const t = q(p);
  const d = 1 - Math.exp(-t * k);
  console.log(`  ${String(Math.round(p * 100)).padStart(3)}%  tau=${t.toFixed(3)}  depth=${d.toFixed(3)}`);
}
