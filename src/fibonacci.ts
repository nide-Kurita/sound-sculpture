/** フィボナッチ数列 — チューニング定数の基準 */
export const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233] as const;

/**
 * 配列インデックスで F(n) を参照（n=7 → 21, n=8 → 34 …）。
 * fibUnit(8, 9) は F₈/F₉ = 34/55 の意味。インデックス 12 超は 233 にクランプ。
 */
export const fib = (index: number): number => FIB[Math.min(Math.max(0, index), FIB.length - 1)];

/** F(a) / F(b) — 0〜1 付近の比率定数 */
export const fibRatio = (a: number, b: number) => fib(a) / fib(b);

/** 黄金比近似 F(10) / F(9) */
export const PHI = fib(10) / fib(9);

/** 秒・フレームレート等の整数スケール */
export const fibSeconds = (index: number) => fib(index);

/** 0〜1 に正規化したフィボナッチ比率 */
export const fibUnit = (numeratorIndex: number, denominatorIndex: number) =>
  fib(numeratorIndex) / fib(denominatorIndex);
