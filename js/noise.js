// 表面の質感を起動時に 1 枚のテクスチャへ焼く。チャンネルごとに材質を作り分ける。
//   R = 木目 / G = 石目 / B = 細かい起伏 (バンプ用) / A = 風化のむら
// どれも周期的なので繰り返しても継ぎ目が出ない。

import { makeRng } from './math.js';

export const NOISE_SIZE = 512;

const fade = t => t * t * (3 - 2 * t);

// 格子に値を撒いて補間。x と y で格子数を変えると、縦へ流れる筋のような異方性が作れる
function grid(cx, cy, rnd) {
  const g = new Float32Array(cx * cy);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (u, v) => {
    const fx = u * cx, fy = v * cy;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fade(fx - ix), ty = fade(fy - iy);
    const at = (x, y) => g[(((y % cy) + cy) % cy) * cx + (((x % cx) + cx) % cx)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

// fBm
function fbm(layers) {
  return (u, v) => {
    let s = 0, w = 0;
    for (const [f, amp] of layers) { s += f(u, v) * amp; w += amp; }
    return s / w;
  };
}

export function noiseTexture() {
  const N = NOISE_SIZE, data = new Uint8Array(N * N * 4);
  const rnd = makeRng(1337);

  // --- 木目 ---
  // 年輪: v 方向に整数回の縞。縞の位置を fBm で歪ませると、まっすぐでない自然な木目になる
  const warp = fbm([[grid(3, 3, rnd), 1], [grid(7, 7, rnd), 0.5], [grid(17, 17, rnd), 0.25]]);
  // 繊維: 横に細かく縦に粗い格子 = 縦へ長く伸びる筋
  const fiber1 = grid(220, 12, rnd), fiber2 = grid(90, 7, rnd), fiber3 = grid(420, 26, rnd);
  // --- 石目 ---
  const spec1 = grid(180, 180, rnd), spec2 = grid(64, 64, rnd), spec3 = grid(360, 360, rnd);
  const blot = fbm([[grid(5, 5, rnd), 1], [grid(11, 11, rnd), 0.55]]);
  const crackN = fbm([[grid(9, 9, rnd), 1], [grid(23, 23, rnd), 0.5]]);
  // --- 細部と風化 ---
  const fine = fbm([[grid(120, 120, rnd), 1], [grid(300, 300, rnd), 0.6], [grid(48, 48, rnd), 0.4]]);
  const weather = fbm([[grid(4, 4, rnd), 1], [grid(9, 9, rnd), 0.5], [grid(21, 21, rnd), 0.25]]);

  const RINGS = 9;   // タイルあたりの年輪の数 (整数なので上下でつながる)
  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N, i = (y * N + x) * 4;

      // 年輪は急に濃くなって緩く薄れる
      const ring = Math.abs(((v * RINGS + (warp(u, v) - 0.5) * 1.6) % 1 + 1) % 1 - 0.5) * 2;
      const ringDark = Math.pow(1 - ring, 2.6);
      const fiber = fiber1(u, v) * 0.5 + fiber2(u, v) * 0.3 + fiber3(u, v) * 0.2;
      const wood = 1 - ringDark * 0.75 - (0.5 - fiber) * 0.34;

      // 石
      const s1 = spec1(u, v), s2 = spec2(u, v), s3 = spec3(u, v);
      const coarse = s2 < 0.42 ? 0.72 : s2 > 0.74 ? 1.14 : 1;      // 大きめの結晶
      const mid = s1 < 0.3 ? 0.78 : s1 > 0.8 ? 1.12 : 1;
      const crack = Math.pow(1 - Math.abs(crackN(u, v) * 2 - 1), 9) * 0.55;
      const stone = coarse * mid * (0.88 + s3 * 0.24) * (1 - crack) * (0.85 + blot(u, v) * 0.3);

      data[i] = Math.max(0, Math.min(255, Math.round(wood * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(stone * 190)));
      data[i + 2] = Math.round(fine(u, v) * 255);
      data[i + 3] = Math.round(weather(u, v) * 255);
    }
  }
  return data;
}
