// Self-contained 2D simplex noise — no external dependencies.
// All state lives in closures; no module-level mutable variables.

/**
 * Returns a deterministic pseudo-random number generator seeded by `seed`.
 * Uses a linear congruential generator (LCG) — fast and good enough for
 * procedural generation. Output is in [0, 1).
 */
export function seededRandom(seed) {
  let s = seed | 0;
  if (s === 0) s = 1; // LCG produces a degenerate sequence from 0
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Creates a 2D simplex noise function seeded by `seed`.
 * Returns a pure function (x, y) → [-1, 1].
 * Two calls with different seeds produce independent, non-interfering results.
 */
export function createNoise2D(seed) {
  const rand = seededRandom(seed);

  // Build a shuffled 256-entry permutation table (Fisher-Yates)
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }

  // Double the table to 512 entries — avoids modulo in hot path
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  // 8 unit gradients for 2D simplex
  const G = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1],  [0, -1],
  ];

  // Skew/unskew factors for 2D simplex grid
  const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
  const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

  /**
   * Evaluate 2D simplex noise at (xin, yin).
   * Result is in approximately [-1, 1].
   */
  return function noise2D(xin, yin) {
    // Skew input to find which simplex cell we're in
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;

    // Unskew back to (x, y) space — corner 0
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // Determine which simplex triangle (lower-left or upper-right)
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    // Offsets for corners 1 and 2
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    // Gradient index for each corner
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = p[ii +      p[jj     ]] & 7;
    const gi1 = p[ii + i1 + p[jj + j1]] & 7;
    const gi2 = p[ii + 1  + p[jj + 1 ]] & 7;

    // Contribution from corner 0
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    let n0 = 0;
    if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (G[gi0][0] * x0 + G[gi0][1] * y0); }

    // Contribution from corner 1
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    let n1 = 0;
    if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (G[gi1][0] * x1 + G[gi1][1] * y1); }

    // Contribution from corner 2
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    let n2 = 0;
    if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (G[gi2][0] * x2 + G[gi2][1] * y2); }

    // Scale to [-1, 1] — factor 70 is the standard normalisation for 2D simplex
    return 70.0 * (n0 + n1 + n2);
  };
}
