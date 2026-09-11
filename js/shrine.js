// 境内の構成。モデルデータは持たず、寸法から全部組む。
//
// sway (頂点シェーダーでの変形の種類):
//   0 静止 / 1 紙垂 (風) / 2 鈴緒 / 3,4 本殿の扉 / 5 水面 / 6 流水
//   7 狛犬 (見ていない間に向きが変わる) / 8 濡れた足跡 / 9 藁人形 (途中から現れる)
//   12 絵馬 1 枚 (無風で鳴る) / 13 柄杓 1 本 (後で伏せる) / 14 御鏡 (反射)
//   20.0〜20.5 五寸釘 (見ていない間に増える。小数部が本数の添字)
// 座標系: x 左右, y 上, z 手前が正。本殿が奥 (z<0)、参道は +z 方向へ伸びる。

import { MeshBuilder } from './geometry.js';
import { M, chain, makeRng, FloatList } from './math.js';

export const COLORS = {
  ground: [0.10, 0.13, 0.09],
  path: [0.40, 0.39, 0.37],
  stone: [0.44, 0.43, 0.41],
  vermilion: [0.74, 0.17, 0.10],
  black: [0.07, 0.06, 0.06],
  wood: [0.48, 0.32, 0.19],
  darkwood: [0.30, 0.20, 0.12],
  roof: [0.16, 0.15, 0.15],
  white: [0.93, 0.91, 0.86],
  shoji: [0.96, 0.92, 0.82],
  rope: [0.72, 0.60, 0.36],
  paper: [1.0, 0.38, 0.14],
  fire: [1.0, 0.72, 0.36],
  leaf: [0.07, 0.11, 0.08],
  trunk: [0.22, 0.16, 0.12],
  sakuraTrunk: [0.26, 0.20, 0.17],
  water: [0.08, 0.11, 0.16],
  gold: [0.90, 0.74, 0.32],
};

export const LAYOUT = {
  torii: 36,
  chozuya: { x: -8.0, z: 21 },
  ema: { x: 7.8, z: 14 },
  haiden: { z: 2, floor: 1.3, halfX: 7.2, halfZ: 5.2 },
  corridor: { z0: -21.2, z1: -3.2, halfX: 1.6 },
  honden: { z: -27, doorZ: -21.55, hingeX: 1.3, floor: 2.0, halfX: 5.2, halfZ: 5.5 },
  // 御鏡の面。法線は +Z。Worker でシーンを組むので、位置は定数として持たせる
  mirror: { x: 0, y: 3.5, z: -29.42 },
  // 立て札の位置と向き [x, z, yaw]。巻物 (content.js) の判定位置もここを参照する
  fuda: {
    torii:   [3.4, 37.2, -0.12],
    chochin: [4.2, 26.5, -0.38],
    chozuya: [-5.3, 22.6, 0.95],
    seichu:  [3.4, 17.4, -0.42],
    ema:     [4.6, 16.2, -0.55],
    haiden:  [3.6, 11.4, -0.5],
  },
  bell: [0, 5.6, 9.2],
  bounds: { x: 10.5, zMin: -31.5, zMax: 50 },
};

// 高欄の線上に立つ柱。ここには束柱を立てない
const railPillars = [];

export function buildScene(seed = 7, density = 1) {
  railPillars.length = 0;
  const rnd = makeRng(seed);
  const b = new MeshBuilder();
  const lights = [], blockers = [];
  const blossoms = new FloatList(1 << 22), petals = new FloatList(1 << 14);

  ground(b, rnd);
  torii(b, LAYOUT.torii);
  for (const s of [-1, 1]) { lights.push(toro(b, s * 3.6, 10.5)); lights.push(toro(b, s * 3.6, 39.5)); lights.push(toro(b, s * 5.6, -10.5)); }
  for (let z = 13; z <= 33; z += 4) for (const s of [-1, 1]) lights.push(chochinPost(b, s * 3.1, z));
  for (const [x, z, a] of Object.values(LAYOUT.fuda)) lights.push(tatefuda(b, x, z, a, blockers));
  for (const s of [-1, 1]) komainu(b, s * 4.6, 12.0, s, blockers);
  chozuya(b, LAYOUT.chozuya.x, LAYOUT.chozuya.z, blockers);
  emakake(b, LAYOUT.ema.x, LAYOUT.ema.z, blockers);
  haiden(b, lights, blockers);
  corridor(b, lights, blockers);
  honden(b, lights, blockers);
  railings(b);
  footprints(b);
  shinboku(b, blockers);
  sakura(b, rnd, blossoms, blockers, density);
  cedars(b, rnd);
  for (let i = 0; i < 320; i++) pushBlossom(petals, [-9 + rnd() * 18, rnd() * 9, -6 + rnd() * 50], [0, 1, 0], 0.05 + rnd() * 0.03, rnd(), 1);
  // 一本の桜のまわりだけ、花びらが上へ昇る (k を負にすると頂点シェーダーが向きを反転する)
  for (let i = 0; i < 70; i++) pushBlossom(petals, [7.0 + rnd() * 2.4 - 1.2, rnd() * 8, 21 + rnd() * 3 - 1.5], [0, 1, 0], 0.05 + rnd() * 0.03, rnd(), -1);

  return {
    vertices: b.build(),
    lights,
    blockers,
    blossoms: blossoms.toArray(),
    petals: petals.toArray(),
  };
}

// 花 1 輪 = 4 頂点の板。中心(3) 法線(3) 角(2) 大きさ(1) 乱数(1) 深さ(1)
export const BLOSSOM_STRIDE = 11;
function pushBlossom(out, c, n, size, r, k) {
  const i0 = out.reserve(BLOSSOM_STRIDE * 4), a = out.a;
  for (let q = 0; q < 4; q++) {
    const i = i0 + q * BLOSSOM_STRIDE;
    a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = n[0]; a[i + 4] = n[1]; a[i + 5] = n[2];
    a[i + 6] = q === 0 || q === 3 ? -0.5 : 0.5; a[i + 7] = q < 2 ? -0.5 : 0.5; a[i + 8] = size; a[i + 9] = r; a[i + 10] = k;
  }
}
export function blossomIndices(count) {
  const idx = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) { const b = i * 4, o = i * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
  return idx;
}

// ---------- 地面・参道 ----------
function ground(b, rnd) {
  const C = COLORS;
  const nx = 36, nz = 30, x0 = -90, x1 = 90, z0 = -50, z1 = 90;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ax = x0 + (x1 - x0) * i / nx, bx = x0 + (x1 - x0) * (i + 1) / nx;
      const az = z0 + (z1 - z0) * j / nz, bz = z0 + (z1 - z0) * (j + 1) / nz;
      const k = 0.85 + rnd() * 0.3;
      b.quad([ax, 0, az], [bx, 0, az], [bx, 0, bz], [ax, 0, bz], C.ground.map(c => c * k), [0, 1, 0]);
    }
  }
  // 石畳。暗い下地の上に敷石を互い違いに並べる
  b.box(0, 0.02, 24, 5.2, 0.04, 76, [0.16, 0.16, 0.15]);
  const TW = 0.86, TL = 0.62, GAP = 0.04;
  for (let row = 0, z = -14; z < 62; z += TL, row++) {
    const off = (row % 2) * TW / 2;
    for (let x = -2.6 + off; x < 2.6; x += TW) {
      const x0 = Math.max(-2.55, x + GAP / 2), x1 = Math.min(2.55, x + TW - GAP / 2);
      if (x1 - x0 < 0.15) continue;
      const k = 0.92 + rnd() * 0.16;
      b.box((x0 + x1) / 2, 0.065, z + TL / 2, x1 - x0, 0.05, TL - GAP, C.path.map(c => c * k));
    }
  }
  for (const s of [-1, 1]) b.box(s * 2.72, 0.09, 24, 0.34, 0.18, 76, C.stone);
}

// ---------- 鳥居 (明神鳥居) ----------
// 島木と笠木は同じ反り曲線で組む。笠木の両端は跳ね上げて斜めに切る。
function torii(b, z) {
  const C = COLORS, H = 6.0, X = 3.0, N = 40, L = 5.2;
  for (const s of [-1, 1]) {
    b.frustum(s * X, 0, z, 0.22, 0.62, 0.62, 0.50, 0.50, C.black);                     // 亀腹 (礎石)
    b.cylinder(s * X, 0.22, z, 0.40, 0.33, H - 0.22, C.vermilion, { seg: 28, mat: M.rz(s * 0.025) });
    b.cylinder(s * X, 0.22, z, 0.45, 0.43, 0.45, C.black, { seg: 28 });               // 根巻
    b.cylinder(s * X - Math.sin(s * 0.025) * (H - 0.5), H - 0.5, z, 0.40, 0.42, 0.42, C.black, { seg: 28 }); // 台輪
  }
  b.box(0, 4.45, z, 8.6, 0.40, 0.30, C.vermilion);                                      // 貫
  for (const s of [-1, 1]) b.box(s * 4.3, 4.45, z, 0.02, 0.40, 0.30, C.black);
  b.box(0, 5.3, z, 0.55, 1.3, 0.28, C.vermilion);                                       // 額束
  b.box(0, 5.28, z + 0.18, 0.72, 1.0, 0.06, C.black);                                   // 扁額
  b.box(0, 5.28, z + 0.22, 0.6, 0.86, 0.02, C.gold);
  // 反り: 中央は平らで端へ向かって急に持ち上がる
  const curve = x => 0.75 * Math.pow(Math.abs(x) / L, 3.0);
  const beam = (yb, h, hd, col, cut) => {
    for (let i = 0; i < N; i++) {
      const x0 = -L + (2 * L) * i / N, x1 = -L + (2 * L) * (i + 1) / N;
      const y0 = yb + curve(x0), y1 = yb + curve(x1);
      // 端の切り口: 上が外へ出る斜め
      const e0 = Math.max(0, Math.abs(x0) - L + 0.5) / 0.5, e1 = Math.max(0, Math.abs(x1) - L + 0.5) / 0.5;
      const ox0 = cut * e0 * Math.sign(x0), ox1 = cut * e1 * Math.sign(x1);
      b.hexa([
        [x0, y0, z - hd], [x1, y1, z - hd], [x0 + ox0, y0 + h, z - hd], [x1 + ox1, y1 + h, z - hd],
        [x0, y0, z + hd], [x1, y1, z + hd], [x0 + ox0, y0 + h, z + hd], [x1 + ox1, y1 + h, z + hd],
      ], col);
    }
  };
  beam(H - 0.08, 0.38, 0.26, C.vermilion, 0.0);   // 島木
  beam(H + 0.30, 0.55, 0.36, C.black, 0.25);      // 笠木
}

// ---------- 石灯籠 ----------
function toro(b, x, z) {
  const C = COLORS;
  b.frustum(x, 0, z, 0.45, 0.62, 0.62, 0.52, 0.52, C.stone);
  b.cylinder(x, 0.45, z, 0.16, 0.14, 1.55, C.stone, { seg: 8 });
  b.frustum(x, 2.0, z, 2.3, 0.28, 0.28, 0.48, 0.48, C.stone);
  b.box(x, 2.68, z, 0.66, 0.72, 0.66, C.fire, { em: 1.0 });
  b.frustum(x, 3.04, z, 3.55, 0.78, 0.78, 0.22, 0.22, C.stone);
  b.frustum(x, 3.55, z, 3.85, 0.14, 0.14, 0.04, 0.04, C.stone);
  return { pos: [x, 2.68, z], col: [1.0, 0.62, 0.28], k: 1.5 };
}

// ---------- 提灯を吊るした朱の柱 ----------
function chochinPost(b, x, z) {
  const C = COLORS;
  b.box(x, 1.4, z, 0.16, 2.8, 0.16, C.vermilion);
  b.box(x, 2.85, z, 0.9, 0.12, 0.12, C.vermilion);
  b.box(x, 2.6, z, 0.14, 0.4, 0.14, C.black);
  b.cylinder(x, 1.85, z, 0.24, 0.30, 0.38, C.paper, { seg: 10, em: 0.9 });
  b.cylinder(x, 2.23, z, 0.30, 0.24, 0.3, C.paper, { seg: 10, em: 0.9 });
  b.cylinder(x, 1.78, z, 0.2, 0.24, 0.07, C.black, { seg: 10 });
  b.cylinder(x, 2.53, z, 0.24, 0.2, 0.07, C.black, { seg: 10 });
  return { pos: [x, 2.2, z], col: [1.0, 0.42, 0.18], k: 2.0 };
}

// ---------- 駒札 ----------
// 一本柱に小さな板。柱頭に小さな灯りを付けて、夜でも位置が分かるようにする
function tatefuda(b, x, z, yaw, blockers) {
  const C = COLORS, m0 = chain(M.tr(x, 0, z), M.ry(yaw));
  const at = (...ms) => chain(m0, ...ms);
  const W = 0.62, H = 0.44, PY = 1.18;

  b.box(0, 0, 0, 0.11, 0.1, 0.11, C.black, { mat: at(M.tr(0, -0.04, 0)) });
  b.box(0, 0, 0, 0.075, PY, 0.075, C.darkwood, { mat: at(M.tr(0, PY / 2, 0)) });

  const bm = at(M.tr(0, PY - 0.06, 0.05), M.rx(-0.16));
  b.box(0, 0, 0, W, H, 0.035, C.darkwood, { mat: bm });
  b.box(0, 0, 0, W - 0.07, H - 0.07, 0.015, [0.80, 0.74, 0.60], { mat: chain(bm, M.tr(0, 0, 0.022)) });
  for (let col = 0; col < 2; col++) {
    const cx = 0.12 - col * 0.24, n = 3 - col;
    for (let i = 0; i < n; i++) {
      b.box(0, 0, 0, 0.03, 0.045, 0.003, [0.13, 0.11, 0.10],
        { mat: chain(bm, M.tr(cx, H / 2 - 0.1 - i * 0.085, 0.032)) });
    }
  }

  const ly = PY + 0.16;
  b.cylinder(0, 0, 0, 0.055, 0.06, 0.09, C.paper, { seg: 10, em: 0.8, mat: at(M.tr(0, ly, 0)) });
  b.cylinder(0, 0, 0, 0.06, 0.05, 0.08, C.paper, { seg: 10, em: 0.8, mat: at(M.tr(0, ly + 0.09, 0)) });
  b.cylinder(0, 0, 0, 0.045, 0.055, 0.02, C.black, { seg: 10, mat: at(M.tr(0, ly - 0.02, 0)) });

  blockers.push({ cx: x, cz: z, r: 0.3 });
  return { pos: M.pt(m0, [0, ly + 0.08, 0]), col: [1.0, 0.66, 0.34], k: 0.7 };
}

// ---------- 狛犬 ----------
// 向かって右が阿形 (口を開く)、左が吽形 (口を閉じ、角がある)。side = +1 で右
function komainu(b, x, z, side, blockers) {
  const C = COLORS, st = C.stone, dk = st.map(c => c * 0.78), PY = 1.05;
  // 台座: 二段の石。上段は少しすぼまる
  b.box(x, 0.12, z, 1.5, 0.24, 1.2, dk);
  b.frustum(x, 0.24, z, PY - 0.1, 0.62, 0.5, 0.52, 0.42, st);
  b.box(x, PY - 0.05, z, 1.16, 0.1, 0.96, st.map(c => c * 1.05));
  // 以下は局所座標で組む: +Z が参道側 (向かい合うので side で回す)
  const m = chain(M.tr(x, PY, z), M.ry(-side * Math.PI / 2));
  const at = (...ms) => chain(m, ...ms);
  const B = 0.62;                                                       // 座高の目安
  // 胴: 後ろに重心を置いて胸を張る
  b.box(0, 0, 0, 0.46, 0.5, 0.34, st, { sway: 7, mat: at(M.tr(0, 0.3, -0.12), M.rx(0.22)) });     // 腰
  b.box(0, 0, 0, 0.4, 0.52, 0.32, st, { sway: 7, mat: at(M.tr(0, 0.62, 0.06), M.rx(-0.12)) });    // 胸
  // 前脚: まっすぐ下ろす
  for (const e of [-1, 1]) {
    b.cylinder(0, 0, 0, 0.085, 0.075, 0.52, st, { sway: 7, seg: 12, mat: at(M.tr(e * 0.15, 0.02, 0.24), M.rx(0.06)) });
    b.box(0, 0, 0, 0.19, 0.09, 0.24, st, { sway: 7, mat: at(M.tr(e * 0.15, 0.05, 0.32)) });        // 前足
    for (let k = 0; k < 3; k++) b.box(0, 0, 0, 0.045, 0.05, 0.07, dk, { sway: 7, mat: at(M.tr(e * 0.15 + (k - 1) * 0.055, 0.05, 0.43)) });
  }
  // 後脚: 畳んでいる
  for (const e of [-1, 1]) {
    b.box(0, 0, 0, 0.16, 0.34, 0.4, st, { sway: 7, mat: at(M.tr(e * 0.22, 0.24, -0.18), M.rx(0.3)) });
    b.box(0, 0, 0, 0.17, 0.1, 0.26, st, { sway: 7, mat: at(M.tr(e * 0.22, 0.05, -0.02)) });
  }
  // 頭
  const hy = B + 0.44;
  b.box(0, 0, 0, 0.38, 0.34, 0.36, st, { sway: 7, mat: at(M.tr(0, hy, 0.14)) });
  b.box(0, 0, 0, 0.22, 0.17, 0.2, st, { sway: 7, mat: at(M.tr(0, hy - 0.06, 0.34)) });             // 鼻づら
  b.box(0, 0, 0, 0.1, 0.07, 0.07, dk, { sway: 7, mat: at(M.tr(0, hy + 0.01, 0.44)) });             // 鼻
  if (side > 0) {                                                                          // 阿形: 口を開く
    b.box(0, 0, 0, 0.2, 0.1, 0.18, [0.05, 0.05, 0.05], { sway: 7, mat: at(M.tr(0, hy - 0.13, 0.34)) });
    b.box(0, 0, 0, 0.21, 0.09, 0.2, st, { sway: 7, mat: at(M.tr(0, hy - 0.22, 0.32), M.rx(-0.3)) }); // 下顎
    for (const e of [-1, 1]) b.box(0, 0, 0, 0.035, 0.06, 0.035, C.white, { sway: 7, mat: at(M.tr(e * 0.06, hy - 0.11, 0.4)) }); // 牙
  } else {                                                                                 // 吽形: 口を閉じ、角がある
    b.box(0, 0, 0, 0.21, 0.04, 0.2, dk, { sway: 7, mat: at(M.tr(0, hy - 0.13, 0.33)) });
    b.cylinder(0, 0, 0, 0.055, 0.015, 0.22, st, { sway: 7, seg: 10, mat: at(M.tr(0, hy + 0.17, 0.06), M.rx(-0.2)) });
  }
  for (const e of [-1, 1]) {                                                               // 目 (窪み)
    b.box(0, 0, 0, 0.1, 0.08, 0.04, dk, { sway: 7, mat: at(M.tr(e * 0.11, hy + 0.05, 0.31)) });
    b.box(0, 0, 0, 0.05, 0.05, 0.02, [0.05, 0.05, 0.05], { sway: 7, mat: at(M.tr(e * 0.11, hy + 0.05, 0.33)) });
    b.box(0, 0, 0, 0.08, 0.12, 0.09, st, { sway: 7, mat: at(M.tr(e * 0.17, hy + 0.18, 0.1), M.rz(e * 0.4)) });   // 耳
  }
  // 鬣: 頭から首、肩へ渦を並べる
  for (let r = 0; r < 4; r++) {
    const n2 = 5 + r, ry = hy + 0.16 - r * 0.17, rz = 0.06 - r * 0.14;
    for (let i = 0; i < n2; i++) {
      const a = (i / (n2 - 1) - 0.5) * Math.PI * 1.15;
      b.cylinder(0, 0, 0, 0.06 - r * 0.005, 0.045, 0.06, st, { sway: 7, seg: 10, mat: at(M.tr(Math.sin(a) * (0.2 + r * 0.05), ry, rz + Math.cos(a) * 0.1), M.rx(Math.PI / 2)) });
    }
  }
  // 尾: 背中で巻き上がる
  for (let i = 0; i < 7; i++) {
    const a = i * 0.52;
    b.cylinder(0, 0, 0, 0.08 - i * 0.008, 0.07 - i * 0.008, 0.13, st,
      { sway: 7, seg: 10, mat: at(M.tr(0, 0.35 + i * 0.1 - Math.sin(a) * 0.04, -0.3 - Math.sin(a) * 0.12), M.rx(0.4 + a * 0.2)) });
  }
  blockers.push({ cx: x, cz: z, r: 0.8 });
}

// ---------- 手水舎 ----------
function chozuya(b, x, z, blockers) {
  const C = COLORS, PX = 1.8, PZ = 1.5, PH = 2.9, PW = 0.22;
  b.box(x, 0.08, z, 5.6, 0.16, 4.8, C.stone.map(c => c * 0.9));                      // 敷石
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * PX, pz = z + sz * PZ;
    b.frustum(px, 0.16, pz, 0.34, 0.30, 0.30, 0.24, 0.24, C.stone);                  // 礎石
    b.box(px, 0.34 + PH / 2, pz, PW, PH, PW, C.wood);                                 // 角柱
    b.box(px, 0.34 + PH - 0.6, pz, PW + 0.06, 0.16, PW + 0.06, C.darkwood);           // 柱頭の帯
  }
  const top = 0.34 + PH;
  for (const sz of [-1, 1]) b.box(x, top + 0.12, z + sz * PZ, 2 * PX + 0.9, 0.24, 0.20, C.wood);   // 桁
  for (const sx of [-1, 1]) b.box(x + sx * PX, top + 0.36, z, 0.20, 0.24, 2 * PZ + 0.9, C.wood);   // 梁
  for (const sz of [-1, 1]) b.box(x, top + 0.6, z + sz * PZ, 2 * PX + 0.6, 0.24, 0.16, C.wood);
  b.box(x, top + 1.4, z, 0.16, 1.2, 0.16, C.wood);                                    // 束
  b.box(x, top + 2.05, z, 2.4, 0.16, 0.16, C.wood);                                   // 棟木
  // 垂木: 棟から四方の軒へ
  for (let i = -6; i <= 6; i++) {
    for (const sz of [-1, 1]) {
      const xx = x + i * 0.42, zz0 = z, zz1 = z + sz * (PZ + 0.95);
      const y0 = top + 2.0, y1 = top + 0.42, l = Math.hypot(zz1 - zz0, y1 - y0);
      b.box(xx, (y0 + y1) / 2, (zz0 + zz1) / 2, 0.08, 0.10, l, C.darkwood, { mat: M.rx(-sz * Math.atan2(y0 - y1, Math.abs(zz1 - zz0))) });
    }
  }
  b.hipRoof({ cx: x, cz: z, ridgeY: top + 2.35, eaveY: top + 0.55, ridgeHalfX: 1.3, eaveHalfX: PX + 1.0, eaveHalfZ: PZ + 1.0,
    thick: 0.16, col: C.roof, under: C.darkwood, N: 14 });
  b.box(x, top + 2.40, z, 2.7, 0.12, 0.30, C.black);                                  // 棟瓦
  // 水盤
  const BW = 1.25, BD = 0.65, RIM = 0.16, TOP = 1.18;
  b.frustum(x, 0.16, z, 0.34, BW + 0.1, BD + 0.1, BW, BD, C.stone);                          // 台
  for (const s of [-1, 1]) {                                                               // 前後の壁
    b.frustum(x, 0.34, z + s * (BD - RIM / 2), TOP, BW, RIM / 2 + 0.05, BW - 0.04, RIM / 2, C.stone.map(c => c * 1.04));
    b.frustum(x + s * (BW - RIM / 2), 0.34, z, TOP, RIM / 2 + 0.05, BD - RIM, RIM / 2, BD - RIM - 0.04, C.stone.map(c => c * 1.04));
  }
  b.box(x, 0.5, z, 2 * (BW - RIM), 0.32, 2 * (BD - RIM), C.stone.map(c => c * 0.55));      // 底
  for (const s of [-1, 1]) {                                                               // 内壁 (暗い)
    b.box(x, 0.85, z + s * (BD - RIM - 0.01), 2 * (BW - RIM), 0.7, 0.02, C.stone.map(c => c * 0.5));
    b.box(x + s * (BW - RIM - 0.01), 0.85, z, 0.02, 0.7, 2 * (BD - RIM), C.stone.map(c => c * 0.5));
  }
  // 側面は飾らない。縁の下に浅い一段の段差だけ (ノミ跡はシェーダーの石目で出す)
  b.box(x, TOP - 0.16, z, 2 * BW + 0.06, 0.05, 2 * BD + 0.06, C.stone.map(c => c * 0.92));
  // 水面 (sway 5: フラグメントで波と反射)。細かく割って波が乗るように
  { const W = BW - RIM - 0.01, D = BD - RIM - 0.01, N = 16;
    for (let i = 0; i < N; i++) for (let j = 0; j < 8; j++) {
      const x0 = x - W + 2 * W * i / N, x1 = x - W + 2 * W * (i + 1) / N, z0 = z - D + 2 * D * j / 8, z1 = z - D + 2 * D * (j + 1) / 8;
      b.quad([x0, 1.06, z0], [x1, 1.06, z0], [x1, 1.06, z1], [x0, 1.06, z1], [0.10, 0.14, 0.20], [0, 1, 0], 0, 5);
    } }
  // 竜口と水管
  b.box(x, 1.5, z - 0.62, 0.36, 1.32, 0.34, C.stone.map(c => c * 0.8));
  b.cylinder(x, 1.7, z - 0.5, 0.07, 0.07, 0.5, C.black, { seg: 12, mat: M.rx(Math.PI / 2) });
  // 落ちる水 (sway 6: 流れのアニメーション)。上は細く、下で広がって着水の泡
  b.cylinder(x, 1.06, z - 0.05, 0.05, 0.03, 0.64, [0.8, 0.9, 1.0], { seg: 14, sway: 6 });
  b.cylinder(x, 1.055, z - 0.05, 0.13, 0.05, 0.05, [0.9, 0.95, 1.0], { seg: 16, sway: 6 });
  for (const r of [0.10, 0.18]) b.cylinder(x, 1.065, z - 0.05, r, r + 0.03, 0.006, [0.6, 0.72, 0.9], { seg: 24, em: 0.1 });
  // 柄杓置き: 竹の横木 2 本に柄杓を並べる
  for (const dy of [0, 0.12]) b.cylinder(x - 1.15, 1.2 + dy, z + 0.42, 0.025, 0.025, 2.3, C.rope, { seg: 8, mat: M.rz(-Math.PI / 2) });
  for (let i = -2; i <= 2; i++) {
    const hx = x + i * 0.42, sw = i === 1 ? 13 : 0;                                         // 1 本だけ後で伏せる
    b.cylinder(hx, 1.30, z + 0.05, 0.11, 0.11, 0.12, C.wood, { sway: sw, seg: 12 });        // 杯
    b.cylinder(hx, 1.30, z + 0.05, 0.09, 0.09, 0.02, C.water, { sway: sw, seg: 12 });
    b.cylinder(hx, 1.34, z + 0.18, 0.02, 0.018, 0.7, C.wood, { sway: sw, seg: 6, mat: M.rx(Math.PI / 2 - 0.05) }); // 柄
  }
  blockers.push({ x0: x - 1.4, x1: x + 1.4, z0: z - 0.9, z1: z + 0.9 });
}

// ---------- 絵馬掛け ----------
function emakake(b, x, z, blockers) {
  const C = COLORS, W = 2.4, D = 0.9, PH = 2.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * W, pz = z + sz * D;
    b.frustum(px, 0, pz, 0.18, 0.24, 0.24, 0.2, 0.2, C.stone);                    // 礎石
    b.box(px, 0.18 + PH / 2, pz, 0.18, PH, 0.18, C.wood);
  }
  const top = 0.18 + PH;
  for (const sz of [-1, 1]) b.box(x, top + 0.1, z + sz * D, W * 2 + 0.5, 0.2, 0.18, C.wood);   // 桁
  for (const sx of [-1, 1]) b.box(x + sx * W, top + 0.3, z, 0.16, 0.2, D * 2 + 0.4, C.wood);   // 梁
  b.box(x, top + 0.95, z, 0.14, 1.0, 0.14, C.wood);                                            // 束
  b.box(x, top + 1.45, z, W * 2 + 0.4, 0.16, 0.16, C.wood);                                    // 棟木
  { const ang = 0.62, len = (D + 0.7) / Math.cos(ang), yc = top + 1.1;                         // 切妻の屋根
    for (const s of [-1, 1]) {
      const m = chain(M.tr(x, yc, z), M.rx(s * ang), M.tr(0, 0, s * len / 2));
      b.box(0, 0, 0, W * 2 + 0.9, 0.14, len, C.roof, { mat: m });
      b.box(0, -0.13, 0, W * 2 + 0.7, 0.05, len - 0.1, C.darkwood, { mat: m });
      for (let i = -6; i <= 6; i++) b.box(i * 0.38, -0.1, 0, 0.08, 0.1, len - 0.1, C.darkwood, { mat: m });   // 垂木
    }
    b.box(x, top + 1.55, z, W * 2 + 1.0, 0.16, 0.3, C.black);                                   // 棟
    for (const sx of [-1, 1]) b.tri([x + sx * (W + 0.45), top + 0.35, z - D - 0.7], [x + sx * (W + 0.45), top + 0.35, z + D + 0.7], [x + sx * (W + 0.45), top + 1.5, z], C.white); }
  // 絵馬: 五角形の板。紐で横木に吊るし、めいめい少し傾く
  const rnd = makeRng(31);
  for (let r = 0; r < 3; r++) {
    const ry = top - 0.35 - r * 0.62;
    b.cylinder(x - W + 0.1, ry, z, 0.035, 0.035, W * 2 - 0.2, C.darkwood, { seg: 10, mat: M.rz(-Math.PI / 2) });
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ex = x - W + 0.35 + i * (W * 2 - 0.7) / (n - 1);
      const ez = z + (i % 2 ? 0.1 : -0.1), tilt = (rnd() - 0.5) * 0.35;
      const hue = [[0.86, 0.80, 0.66], [0.80, 0.72, 0.58], [0.88, 0.84, 0.72], [0.72, 0.62, 0.48]][i % 4];
      const m = chain(M.tr(ex, ry - 0.28, ez), M.rz(tilt));
      const esw = (r === 1 && i === 4) ? 12 : 0;                                                     // 1 枚だけ無風で鳴る
      b.cylinder(0, 0.24, 0, 0.012, 0.012, 0.1, C.rope, { seg: 6, mat: chain(m, M.tr(0, 0, 0)) });   // 紐
      b.box(0, 0, 0, 0.34, 0.26, 0.025, hue, { sway: esw, mat: m });                                 // 板
      b.tri(...[[-0.17, 0.13, 0.0125], [0.17, 0.13, 0.0125], [0, 0.27, 0.0125]].map(q => M.pt(m, q)), hue);   // 屋根形の頭
      b.tri(...[[0.17, 0.13, -0.0125], [-0.17, 0.13, -0.0125], [0, 0.27, -0.0125]].map(q => M.pt(m, q)), hue.map(c => c * 0.9));
      for (let k = 0; k < 3; k++) b.box(-0.1 + k * 0.09, -0.02, 0.014, 0.05, 0.13, 0.004, [0.18, 0.14, 0.12], { mat: m });   // 墨書き
    }
  }
  blockers.push({ x0: x - W - 0.3, x1: x + W + 0.3, z0: z - D - 0.3, z1: z + D + 0.3 });
}

// ---------- 高欄 (全体を 1 つのルールで) ----------
// 拝殿の縁 → 渡殿 → 本殿の縁を、左右それぞれ 1 本のポリラインとして引く。階段で床の高さが変わる所だけ切る
function railings(b) {
  const H = LAYOUT.haiden, K = LAYOUT.corridor, N = LAYOUT.honden;
  const hE = 0.6, nE = 0.8, kx = K.halfX + 0.7, zs = K.z0 + 2.4;   // kx = 渡殿の柱の線
  for (const s of [-1, 1]) {
    // 拝殿の縁 (正面の階段の脇から) → 渡殿の手前側 (床 F)
    railPath(b, [
      [s * 2.4, H.z + H.halfZ + hE], [s * (H.halfX + hE), H.z + H.halfZ + hE], [s * (H.halfX + hE), H.z - H.halfZ - hE],
      [s * kx, H.z - H.halfZ - hE], [s * kx, zs + 1.2],
    ], H.floor);
    // 渡殿の奥側 (床 F2) → 本殿の縁を一周して反対側の渡殿へは戻らず、中心線で止める
    railPath(b, [
      [s * kx, zs], [s * kx, N.z + N.halfZ + nE], [s * (N.halfX + nE), N.z + N.halfZ + nE],
      [s * (N.halfX + nE), N.z - N.halfZ - nE], [0, N.z - N.halfZ - nE],
    ], N.floor);
  }
}

// ---------- 共通の部材 ----------
// 横向きの円柱 (中心指定)
function hcyl(b, cx, cy, cz, r, len, col, axis = 'x', opt = {}) {
  const m = axis === 'x' ? chain(M.tr(cx - len / 2, cy, cz), M.rz(-Math.PI / 2)) : chain(M.tr(cx, cy, cz - len / 2), M.rx(Math.PI / 2));
  b.cylinder(0, 0, 0, r, r, len, col, { seg: opt.seg || 16, mat: m, em: opt.em || 0 });
}
// 高欄。頂点に擬宝珠付きの親柱、間に子柱。角は親柱を共有するので取り合いがずれない
function railPath(b, pts, y, col = COLORS.vermilion) {
  const C = COLORS;
  const onPillar = (x, z) => railPillars.some(q => Math.hypot(q[0] - x, q[1] - z) < 0.45);
  const post = (x, z, main) => {
    if (onPillar(x, z)) return;                       // 柱が兼ねるので束柱は立てない
    b.box(x, y + 0.5, z, main ? 0.16 : 0.1, 1.0, main ? 0.16 : 0.1, col);
    if (main) { b.frustum(x, y + 1.0, z, y + 1.08, 0.12, 0.12, 0.09, 0.09, C.black); b.cylinder(x, y + 1.08, z, 0.1, 0.02, 0.2, C.black, { seg: 12 }); }
  };
  for (let i = 0; i < pts.length; i++) post(pts[i][0], pts[i][1], true);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(L / 1.1));
    for (let k = 1; k < n; k++) post(x0 + dx * k / n, z0 + dz * k / n, false);
    const m = chain(M.tr(x0 + dx / 2, 0, z0 + dz / 2), M.ry(Math.atan2(dx, dz)));
    for (const yy of [y + 0.55, y + 0.92]) b.box(0, yy, 0, 0.08, 0.08, L + 0.08, col, { mat: m });
  }
}

// 木階
function stairs(b, cx, z0, z1, y0, y1, w, n, col = COLORS.wood) {
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const y = y0 + (y1 - y0) * t1, za = z0 + (z1 - z0) * t0, zb = z0 + (z1 - z0) * t1;
    b.box(cx, (y0 + y) / 2, (za + zb) / 2, w, y - y0, Math.abs(zb - za) + 0.02, col);
  }
  for (const s of [-1, 1]) b.box(cx + s * (w / 2 + 0.06), (y0 + y1) / 2, (z0 + z1) / 2, 0.12, y1 - y0 + 0.3, Math.abs(z1 - z0) + 0.3, COLORS.darkwood);
}

// 板張りの床
function planks(b, x0, x1, z0, z1, y) {
  const C = COLORS;
  for (let x = x0; x < x1; x += 0.3) {
    const k = 0.94 + ((Math.floor(x * 10) * 7) % 5) * 0.03;
    b.box(x + 0.15, y + 0.006, (z0 + z1) / 2, 0.28, 0.012, z1 - z0, C.wood.map(c => c * k));
  }
}

// 白壁を框と長押で割る。縦框は柱と柱の中間に入れ、端には入れない (柱が兼ねる)
function wallFrame(b, { cx, cz, cy, h, d, alongX, pillars, col = COLORS.vermilion }) {
  const th = 0.08, off = d / 2 + th / 2;
  const a0 = pillars[0], a1 = pillars[pillars.length - 1], w = a1 - a0, mid = (a0 + a1) / 2;
  for (let i = 0; i + 1 < pillars.length; i++) {
    const o = (pillars[i] + pillars[i + 1]) / 2;
    for (const s of [-1, 1]) {
      if (alongX) b.box(o, cy, cz + s * off, 0.2, h, th, col);
      else b.box(cx + s * off, cy, o, th, h, 0.2, col);
    }
  }
  for (const yy of [cy - h / 2 + 0.12, cy + h / 2 - 0.12]) {   // 長押は上下 2 本、柱の内側で止める
    for (const s of [-1, 1]) {
      if (alongX) b.box(mid, yy, cz + s * off, w - d, 0.18, th, col);
      else b.box(cx + s * off, yy, mid, th, 0.18, w - d, col);
    }
  }
}

// 玉垣。角は柱を共有するので、辺ごとの書き漏らしが起きない
function fence(b, pts, y = 0, h = 1.4, col = COLORS.vermilion) {
  const C = COLORS;
  const post = (x, z, main) => {
    const w = main ? 0.2 : 0.14;
    b.box(x, y + h / 2, z, w, h, w, col);
    b.frustum(x, y + h, z, y + h + 0.1, w * 0.62, w * 0.62, w * 0.3, w * 0.3, C.black);   // 笠
  };
  for (const q of pts) post(q[0], q[1], true);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(L / 1.5));
    for (let k = 1; k < n; k++) post(x0 + dx * k / n, z0 + dz * k / n, false);
    const m = chain(M.tr(x0 + dx / 2, 0, z0 + dz / 2), M.ry(Math.atan2(dx, dz)));
    for (const yy of [y + h * 0.34, y + h * 0.76]) b.box(0, yy, 0, 0.08, 0.1, L, col, { mat: m });
  }
}

// 蟇股
function kaerumata(b, cx, cy, cz, w, h, alongX, col = COLORS.wood) {
  const C = COLORS, m0 = alongX ? M.id() : M.ry(Math.PI / 2);
  const at = (x, y, z) => chain(M.tr(cx, cy, cz), m0, M.tr(x, y, z));
  b.box(0, 0, 0, w, 0.14, 0.24, col, { mat: at(0, h - 0.07, 0) });                 // 上端
  for (const s of [-1, 1]) {
    b.box(0, 0, 0, 0.18, h * 0.95, 0.22, col, { mat: chain(at(s * w * 0.32, h / 2, 0), M.rz(-s * 0.42)) });  // 開いた脚
    b.box(0, 0, 0, 0.14, 0.14, 0.2, col, { mat: at(s * w * 0.46, 0.07, 0) });
  }
  b.box(0, 0, 0, w * 0.42, h * 0.62, 0.16, C.black, { mat: at(0, h * 0.42, 0) });   // 中の彫りの面
  b.cylinder(0, 0, 0, w * 0.16, w * 0.16, 0.05, C.gold, { seg: 20, mat: chain(at(0, h * 0.45, 0.1), M.rx(Math.PI / 2)) });
}

// 円柱と礎石、柱頭の斗栱 (大斗 + 肘木)
function pillar(b, x, y0, z, h, r) {
  const C = COLORS;
  b.frustum(x, y0 - 0.16, z, y0, r + 0.18, r + 0.18, r + 0.1, r + 0.1, C.stone);
  b.cylinder(x, y0, z, r, r * 0.9, h, C.vermilion, { seg: 20 });
  b.box(x, y0 + h + 0.15, z, r * 2.4, 0.3, r * 2.4, C.black);          // 大斗
  b.box(x, y0 + h + 0.42, z, r * 5.0, 0.24, r * 1.6, C.black);         // 肘木 (桁方向)
  b.box(x, y0 + h + 0.42, z, r * 1.6, 0.24, r * 5.0, C.black);         // 肘木 (梁方向)
  for (const s of [-1, 1]) {                                            // 巻斗 (肘木の端に載る小さな斗)
    b.box(x + s * r * 2.0, y0 + h + 0.63, z, r * 1.3, 0.18, r * 1.3, C.black);
    b.box(x, y0 + h + 0.63, z + s * r * 2.0, r * 1.3, 0.18, r * 1.3, C.black);
    // 木鼻: 肘木の端から出る彫り物
    b.frustum(x + s * r * 2.5, y0 + h + 0.3, z, y0 + h + 0.54, r * 0.5, r * 0.8, r * 0.3, r * 0.5, C.gold);
    b.frustum(x, y0 + h + 0.3, z + s * r * 2.5, y0 + h + 0.54, r * 0.8, r * 0.5, r * 0.5, r * 0.3, C.gold);
  }
  b.box(x, y0 + h + 0.72, z, r * 2.2, 0.12, r * 2.2, C.black);          // 斗の上の座
}

// 垂木
function rafters(b, cx, halfX, z0, z1, y0, y1, pitch = 0.45) {
  const n = Math.floor(halfX * 2 / pitch);
  const l = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y0 - y1, Math.abs(z1 - z0)) * Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = cx - halfX + i * pitch;
    b.box(x, (y0 + y1) / 2, (z0 + z1) / 2, 0.1, 0.12, l, COLORS.darkwood, { mat: M.rx(a) });
  }
}

// 入母屋 (下は寄棟、上に切妻)
function irimoya(b, { cx = 0, cz, eaveY, ridgeY, eaveHalfX, eaveHalfZ, upperHalfX, upperHalfZ, col, under }) {
  const C = COLORS;
  const midY = eaveY + (ridgeY - eaveY) * 0.55;
  b.hipRoof({ cx, cz, ridgeY: midY + 0.05, eaveY, ridgeHalfX: upperHalfX, eaveHalfX, eaveHalfZ, thick: 0.34, col, under, N: 14 });
  b.roof({ cx, ridgeY, ridgeZ: cz, halfX: upperHalfX + 0.5, front: upperHalfZ, back: upperHalfZ, slope: (ridgeY - midY) / upperHalfZ, flare: 0.3, thick: 0.3, col, under, N: 12 });
  for (const s of [-1, 1]) {                                            // 妻壁と破風板
    const x = cx + s * upperHalfX;
    b.tri([x, midY - 0.2, cz - upperHalfZ], [x, midY - 0.2, cz + upperHalfZ], [x, ridgeY - 0.1, cz], C.white);
    b.tri([x, midY - 0.2, cz + upperHalfZ], [x, midY - 0.2, cz - upperHalfZ], [x, ridgeY - 0.1, cz], C.white);
    for (const d of [-1, 1]) {
      const l = Math.hypot(upperHalfZ, ridgeY - midY), a = Math.atan2(ridgeY - midY, upperHalfZ);
      b.box(x + s * 0.2, (ridgeY + midY) / 2, cz + d * upperHalfZ / 2, 0.14, 0.4, l, C.black, { mat: M.rx(-d * a) });
    }
    b.box(x + s * 0.2, ridgeY - 0.4, cz, 0.16, 0.9, 0.3, C.gold);        // 懸魚
  }
  b.box(cx, ridgeY + 0.15, cz, upperHalfX * 2 + 1.2, 0.4, 0.6, C.black);  // 棟
  for (const s of [-1, 1]) b.box(cx + s * (upperHalfX + 0.55), ridgeY + 0.5, cz, 0.3, 1.0, 0.5, C.black); // 鬼瓦
}

// ---------- 拝殿: 高床、正面は開放、両脇は蔀戸。中央を通り抜けて渡殿へ ----------
function haiden(b, lights, blockers) {
  const C = COLORS, H = LAYOUT.haiden, z = H.z, F = H.floor, HX = H.halfX, HZ = H.halfZ;
  b.box(0, 0.2, z, HX * 2 + 3, 0.4, HZ * 2 + 4, C.stone);                                   // 基壇
  b.box(0, 0.45, z, HX * 2 + 2.2, 0.1, HZ * 2 + 3.2, C.stone.map(c => c * 0.9));
  b.box(0, F - 0.12, z, HX * 2 + 1.2, 0.24, HZ * 2 + 1.2, C.wood);                           // 床 (縁まで)
  for (let x = -HX - 0.4; x <= HX + 0.4; x += 1.2) for (let zz = z - HZ - 0.4; zz <= z + HZ + 0.4; zz += 1.2) b.box(x, F - 0.5, zz, 0.18, 0.55, 0.18, C.darkwood); // 床束
  // 縁の高欄 (正面の階段部分は空ける)
  const E = 0.6;
  stairs(b, 0, z + HZ + E + 2.6, z + HZ + E, 0.5, F, 4.4, 6);
  // 柱: 6 × 3
  const PH = 4.6, R = 0.26;
  const xs = [-HX + 0.4, -HX * 0.55, -1.9, 1.9, HX * 0.55, HX - 0.4], zs = [z - HZ + 0.4, z, z + HZ - 0.4];
  for (const px of xs) for (const pz of zs) if (!(pz === z && Math.abs(px) < 2)) pillar(b, px, F, pz, PH, R);
  const top = F + PH;
  for (const pz of [zs[0], zs[2]]) b.box(0, top + 0.75, pz, HX * 2 + 0.4, 0.4, 0.4, C.vermilion);   // 桁
  for (const px of xs) b.box(px, top + 0.75, z, 0.36, 0.36, HZ * 2 - 0.4, C.vermilion);            // 梁
  for (const yy of [F + 1.0, top - 0.9]) {                                                         // 長押 (下段は通り口を空ける)
    for (const pz of [zs[0], zs[2]]) {
      if (yy > F + 2) b.box(0, yy, pz, HX * 2 - 0.4, 0.22, 0.34, C.vermilion);
      else { const g = pz === zs[2] ? 1.9 : LAYOUT.corridor.halfX + 1.1; for (const s of [-1, 1]) b.box(s * (g + HX - 0.2) / 2, yy, pz, HX - 0.2 - g, 0.22, 0.34, C.vermilion); }
    }
    for (const px of [xs[0], xs[5]]) b.box(px, yy, z, 0.34, 0.22, HZ * 2 - 0.4, C.vermilion);
  }
  // 壁: 両脇は蔀戸 (格子)、背面は板壁。正面中央と背面中央は開ける
  const lattice = (cx, cz, w, h, alongX) => {
    b.box(cx, F + 1.1 + h / 2, cz, alongX ? w : 0.06, h, alongX ? 0.06 : w, C.shoji, { em: 0.15 });
    const n = Math.floor(w / 0.22);
    for (let i = 0; i <= n; i++) {
      const o = -w / 2 + i * w / n;
      b.box(alongX ? cx + o : cx, F + 1.1 + h / 2, alongX ? cz : cz + o, alongX ? 0.05 : 0.09, h, alongX ? 0.09 : 0.05, C.darkwood);
    }
    for (let j = 0; j <= Math.floor(h / 0.22); j++) b.box(cx, F + 1.1 + j * 0.22, cz, alongX ? w : 0.09, 0.05, alongX ? 0.09 : w, C.darkwood);
  };
  const WH = top - 0.9 - (F + 1.1) - 0.1;
  // 腰板: 床から長押までを板で塞ぐ (これが無いと壁の下から外が見える)
  for (const s of [-1, 1]) {
    b.box(s * (HX - 0.4), F + 0.5, z, 0.14, 1.0, HZ * 2 - 0.4, C.darkwood);
    b.box(s * (1.9 + HX - 0.4) / 2, F + 0.5, zs[2], HX - 0.4 - 1.9, 1.0, 0.14, C.darkwood);
    b.box(s * (LAYOUT.corridor.halfX + 1.1 + HX - 0.4) / 2, F + 0.5, zs[0], HX - 0.4 - LAYOUT.corridor.halfX - 0.2, 1.0, 0.14, C.darkwood);
  }
  planks(b, -HX + 0.2, HX - 0.2, z - HZ + 0.2, z + HZ - 0.2, F);
  for (const s of [-1, 1]) {
    lattice(s * (HX * 0.55 + (HX - 0.4)) / 2, zs[2], HX - 0.4 - HX * 0.55, WH, true);
    lattice(s * (HX * 0.55 + 1.9) / 2, zs[2], HX * 0.55 - 1.9, WH, true);
    lattice(s * (HX - 0.4), z - HZ * 0.5 + 0.2, HZ - 0.8, WH, false);
    lattice(s * (HX - 0.4), z + HZ * 0.5 - 0.2, HZ - 0.8, WH, false);
    for (const [c0, c1] of [[HX * 0.55, HX - 0.4], [1.9, HX * 0.55]]) {
      const cx = s * (c0 + c1) / 2, w = c1 - c0;
      b.box(cx, F + 1.1 + WH / 2, zs[0], w, WH, 0.12, C.white);
      wallFrame(b, { cx, cz: zs[0], cy: F + 1.1 + WH / 2, h: WH - 0.05, d: 0.12, alongX: true, pillars: [s * c0, s * c1].sort((p, q) => p - q) });
    }
  }
  for (const s of [-1, 1]) for (const pz of [zs[0], zs[2]]) kaerumata(b, s * 3.75, top + 0.95, pz, 1.5, 0.85, true);   // 桁の上の蟇股
  // 屋根: 入母屋。軒下に垂木
  const eaveY = top + 1.3, ridgeY = top + 5.6;
  irimoya(b, { cz: z, eaveY, ridgeY, eaveHalfX: HX + 2.6, eaveHalfZ: HZ + 2.4, upperHalfX: HX - 1.6, upperHalfZ: HZ * 0.5, col: C.roof, under: C.darkwood });
  for (const d of [-1, 1]) rafters(b, 0, HX + 2.2, z, z + d * (HZ + 2.3), eaveY + (ridgeY - eaveY) * 0.5, eaveY - 0.05);
  // 向拝: 階段の上に唐破風。海老虹梁で本体へ
  const vz = z + HZ + E + 1.6;
  for (const s of [-1, 1]) pillar(b, s * 2.4, 0.5, vz, F + PH - 0.6, 0.22);
  b.box(0, F + PH - 0.05, vz, 5.4, 0.36, 0.36, C.vermilion);
  for (const s of [-1, 1]) b.box(s * 2.4, F + PH + 0.35, (vz + zs[2]) / 2, 0.3, 0.34, vz - zs[2], C.vermilion, { mat: M.rx(0.12) });
  b.karaHafu({ y: eaveY + 0.9, z0: vz - 1.4, z1: vz + 1.5, drop: 1.0, halfX: 3.6, amp: 1.15, col: C.roof });
  // 軒下の提灯と、鈴・鈴緒・賽銭箱
  for (const s of [-1, 1]) {
    b.cylinder(s * 3.6, F + PH - 1.4, vz - 0.2, 0.3, 0.36, 0.55, C.paper, { seg: 14, em: 0.9 });
    b.cylinder(s * 3.6, F + PH - 0.85, vz - 0.2, 0.36, 0.3, 0.45, C.paper, { seg: 14, em: 0.9 });
    lights.push({ pos: [s * 3.6, F + PH - 1.0, vz - 0.2], col: [1.0, 0.45, 0.2], k: 2.0 });
  }
  const [bx, by, bz] = LAYOUT.bell;
  b.box(bx, by + 0.55, bz, 1.2, 0.2, 0.3, C.darkwood);
  b.cylinder(bx, by - 0.3, bz, 0.36, 0.32, 0.55, C.gold, { seg: 16, sway: 2 });
  b.cylinder(bx, by - 0.42, bz, 0.12, 0.36, 0.12, C.gold, { seg: 16, sway: 2 });
  b.cylinder(bx, F + 1.0, bz, 0.09, 0.07, by - 0.42 - F - 1.0, C.rope, { seg: 10, sway: 2 });
  for (let i = 0; i < 6; i++) b.box(bx, F + 1.3 + i * 0.4, bz, 0.28, 0.38, 0.28, i % 2 ? C.white : C.vermilion, { sway: 2 });
  // 賽銭箱: 黒漆の箱に鉄の帯金。天板は斜めの桟の格子で中が暗い。前面に金の神紋
  { const sx = 0, sz = bz - 1.2, W = 1.3, D = 0.7, H = 0.75, y0 = F + 0.1;
    const lacquer = [0.09, 0.07, 0.06], iron = [0.16, 0.15, 0.15];
    for (const ox of [-1, 1]) for (const oz of [-1, 1]) b.box(sx + ox * (W / 2 - 0.1), F + 0.05, sz + oz * (D / 2 - 0.1), 0.16, 0.1, 0.16, lacquer);
    b.box(sx, y0 + H / 2, sz, W, H, D, lacquer);
    b.box(sx, y0 + H - 0.06, sz, W - 0.16, 0.08, D - 0.16, [0.01, 0.01, 0.01]);             // 穴の奥
    for (let i = -5; i <= 5; i++) b.box(sx + i * 0.11, y0 + H + 0.02, sz, 0.03, 0.07, D - 0.16, lacquer, { mat: M.rz(0.7) }); // 斜めの桟
    for (const oz of [-1, 1]) b.box(sx, y0 + H + 0.02, sz + oz * (D / 2 - 0.04), W, 0.07, 0.08, lacquer);
    for (const ox of [-1, 1]) b.box(sx + ox * (W / 2 - 0.04), y0 + H + 0.02, sz, 0.08, 0.07, D, lacquer);
    for (const yy of [y0 + 0.12, y0 + H - 0.12]) {                                           // 鉄の帯金 (上下 2 本、一周)
      b.box(sx, yy, sz, W + 0.02, 0.06, D + 0.02, iron);
    }
    for (const ox of [-1, 1]) for (const oz of [-1, 1]) b.box(sx + ox * (W / 2), y0 + H / 2, sz + oz * (D / 2), 0.05, H + 0.02, 0.05, iron); // 角金
    b.cylinder(sx, y0 + H * 0.5, sz + D / 2 + 0.012, 0.13, 0.13, 0.012, C.gold, { seg: 28, mat: M.rx(-Math.PI / 2) });  // 神紋 (金の円)
    b.cylinder(sx, y0 + H * 0.5, sz + D / 2 + 0.02, 0.1, 0.1, 0.008, lacquer, { seg: 28, mat: M.rx(-Math.PI / 2) });
    for (let k = 0; k < 5; k++) { const ang = k / 5 * Math.PI * 2; b.cylinder(sx + Math.cos(ang) * 0.055, y0 + H * 0.5 + Math.sin(ang) * 0.055, sz + D / 2 + 0.026, 0.035, 0.035, 0.006, C.gold, { seg: 16, mat: M.rx(-Math.PI / 2) }); } }
  // 注連縄
  const y = F + PH - 0.3, N = 11, sag = 0.45;
  const rope = i => { const tt = i / N; return [-2.6 + 5.2 * tt, y - Math.sin(tt * Math.PI) * sag, vz + 0.3]; };
  for (let i = 0; i < N; i++) {
    const a = rope(i), c = rope(i + 1), dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy);
    const r = 0.1 + Math.sin((i + 0.5) / N * Math.PI) * 0.14;
    b.cylinder(a[0], a[1], a[2], r, r, l, C.rope, { seg: 10, mat: M.rz(-Math.atan2(dx, dy)) });
  }
  for (let i = 1; i < N; i += 2) { const p = rope(i); b.box(p[0], p[1] - 0.5, p[2] + 0.05, 0.2, 0.8, 0.02, C.white, { sway: 1 }); }
  // ---- 正面の入口: 扁額、上部に紫の幕、半分巻き上げた御簾と房、両脇に大提灯 ----
  const fz = zs[2] + 0.35, lintel = top - 0.9;
  b.box(0, lintel + 0.55, fz + 0.1, 1.3, 0.8, 0.08, C.black);                                  // 扁額
  b.box(0, lintel + 0.55, fz + 0.15, 1.1, 0.62, 0.02, C.gold);
  for (let i = 0; i < 3; i++) b.box(0, lintel + 0.75 - i * 0.2, fz + 0.17, 0.5, 0.12, 0.01, C.black);
  b.box(0, lintel - 0.55, fz + 0.06, HX * 2 - 1.0, 1.0, 0.04, [0.32, 0.16, 0.40]);               // 幕
  for (let i = -6; i <= 6; i++) { b.box(i * (HX - 0.6) / 6, lintel - 0.55, fz + 0.09, 0.05, 1.0, 0.01, [0.22, 0.10, 0.30]); }
  for (const s of [-1, 1]) b.cylinder(s * 1.4, lintel - 0.55, fz + 0.12, 0.22, 0.22, 0.02, C.white, { seg: 24, mat: M.rx(Math.PI / 2) }); // 神紋
  b.box(0, lintel - 1.35, fz + 0.04, 3.6, 0.6, 0.04, [0.55, 0.62, 0.35]);                       // 御簾 (巻き上げ)
  hcyl(b, 0, lintel - 1.7, fz + 0.04, 0.14, 3.6, [0.5, 0.55, 0.3], 'x');
  for (const s of [-1, 1]) {
    b.cylinder(s * 1.2, lintel - 1.75, fz + 0.2, 0.008, 0.008, 0.5, [0.6, 0.15, 0.2], { seg: 6, mat: M.rx(Math.PI) });   // 房の紐
    b.cylinder(s * 1.2, lintel - 2.45, fz + 0.2, 0.03, 0.05, 0.2, [0.6, 0.15, 0.2], { seg: 10 });
    b.cylinder(s * (1.9 + 0.9), F + 1.4, fz + 0.3, 0.42, 0.5, 0.9, C.paper, { seg: 16, em: 0.85 });                    // 大提灯
    b.cylinder(s * (1.9 + 0.9), F + 2.3, fz + 0.3, 0.5, 0.42, 0.7, C.paper, { seg: 16, em: 0.85 });
    b.cylinder(s * (1.9 + 0.9), F + 1.3, fz + 0.3, 0.3, 0.42, 0.1, C.black, { seg: 16 });
    b.cylinder(s * (1.9 + 0.9), F + 3.0, fz + 0.3, 0.42, 0.3, 0.1, C.black, { seg: 16 });
    b.cylinder(s * (1.9 + 0.9), F + 3.1, fz + 0.3, 0.02, 0.02, lintel - F - 3.1, C.black, { seg: 6 });
    lights.push({ pos: [s * 2.8, F + 2.2, fz + 0.3], col: [1.0, 0.5, 0.22], k: 1.6 });
  }
  // ---- 内装: 釣灯籠、奉納額、太鼓、案と三方、神楽鈴と大幣、座布団 ----
  for (const px of [-4.5, -1.5, 1.5, 4.5]) for (const pz of [z - 2.5, z + 2.5]) {                 // 釣灯籠
    b.cylinder(px, top - 0.9, pz, 0.015, 0.015, 0.9, C.black, { seg: 6, mat: M.rx(Math.PI) });
    b.frustum(px, top - 2.3, pz, top - 2.1, 0.18, 0.18, 0.22, 0.22, C.gold);
    b.box(px, top - 2.0, pz, 0.34, 0.5, 0.34, [1.0, 0.8, 0.5], { em: 0.7 });
    b.frustum(px, top - 1.75, pz, top - 1.6, 0.3, 0.3, 0.05, 0.05, C.gold);
    lights.push({ pos: [px, top - 2.0, pz], col: [1.0, 0.7, 0.4], k: 0.9 });
  }
  for (const s of [-1, 1]) for (const zz of [z - 2.4, z + 2.4]) {                                  // 奉納額 (柱の間に 1 枚ずつ)
    b.box(s * (HX - 0.52), top - 2.0, zz, 0.06, 1.2, 2.4, C.black);                                  // 額縁
    b.box(s * (HX - 0.56), top - 2.0, zz, 0.03, 1.02, 2.22, C.shoji);                                // 紙
    b.box(s * (HX - 0.585), top - 2.0, zz, 0.01, 0.7, 1.7, [0.62, 0.55, 0.42]);                      // 絵 (墨の面)
    b.box(s * (HX - 0.59), top - 2.35, zz - 0.85, 0.01, 0.16, 0.16, [0.6, 0.15, 0.15]);              // 落款
  }
  { const dx = -4.2, dzz = z - 3.6, dy = F + 1.05;                                                // 宮太鼓と台 (皮は左右を向く)
    b.box(dx, F + 0.06, dzz, 1.3, 0.12, 1.1, C.darkwood);
    for (const s of [-1, 1]) { b.box(dx, F + 0.5, dzz + s * 0.45, 1.0, 0.9, 0.1, C.darkwood); b.box(dx, F + 0.75, dzz + s * 0.45, 0.16, 0.6, 0.16, C.darkwood); }
    hcyl(b, dx, dy, dzz, 0.55, 0.7, [0.55, 0.22, 0.12], 'x', { seg: 28 });
    for (const s of [-1, 1]) {
      hcyl(b, dx + s * 0.36, dy, dzz, 0.53, 0.03, [0.85, 0.78, 0.66], 'x', { seg: 28 });
      for (let k = 0; k < 14; k++) { const ang = k / 14 * Math.PI * 2; hcyl(b, dx + s * 0.35, dy + Math.cos(ang) * 0.49, dzz + Math.sin(ang) * 0.49, 0.028, 0.05, C.gold, 'x', { seg: 8 }); }
    }
    for (const s of [-1, 1]) hcyl(b, dx, dy + 0.62, dzz + s * 0.3, 0.02, 0.5, C.rope, 'x');                // 吊り紐
    b.box(dx + 0.95, F + 0.05, dzz, 0.3, 0.1, 0.4, C.darkwood);                                    // 撥台
    for (const ox of [0.9, 1.0]) hcyl(b, dx + ox, F + 0.12, dzz, 0.02, 0.5, C.wood, 'z', { seg: 8 }); } // 撥
  { const ax = 4.0, azz = z - 3.2;                                                                 // 案 (八足の机) と三方。中央は通り道なので脇に
    b.box(ax, F + 0.82, azz, 2.4, 0.06, 0.7, C.white);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const ox of [0.35, 1.05]) b.box(ax + sx * ox, F + 0.4, azz + sz * 0.26, 0.05, 0.8, 0.05, C.white);
    for (const sz of [-1, 1]) b.box(ax, F + 0.12, azz + sz * 0.26, 2.2, 0.04, 0.04, C.white);
    for (const ox of [-0.8, -0.27, 0.27, 0.8]) { b.box(ax + ox, F + 0.97, azz, 0.3, 0.22, 0.3, C.white); b.box(ax + ox, F + 1.1, azz, 0.34, 0.03, 0.34, C.white);
      b.frustum(ax + ox, F + 1.12, azz, F + 1.24, 0.09, 0.09, 0.02, 0.02, [0.96, 0.96, 0.94]); }
    b.cylinder(ax + 1.6, F, azz, 0.06, 0.05, 1.0, C.white, { seg: 10 });                          // 大幣
    for (let j = 0; j < 6; j++) b.box(ax + 1.6, F + 1.0 + j * 0.06, azz + 0.06, 0.4, 0.02, 0.02 + j * 0.02, C.white, { sway: 1 });
    b.box(ax + 1.6, F + 1.25, azz, 0.44, 0.5, 0.02, C.white, { sway: 1 });
    b.cylinder(ax - 1.6, F, azz, 0.05, 0.05, 0.8, C.wood, { seg: 8 });                            // 神楽鈴
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, r = 0.12; b.cylinder(ax - 1.6 + Math.cos(a) * r, F + 0.8, azz + Math.sin(a) * r, 0.04, 0.04, 0.08, C.gold, { seg: 8 }); }
    b.cylinder(ax - 1.6, F + 0.88, azz, 0.04, 0.04, 0.06, C.gold, { seg: 8 }); }
  for (let r = 0; r < 2; r++) for (const i of [-3, -2, 2, 3]) b.box(i * 1.1, F + 0.03, z + 1.2 + r * 1.1, 0.8, 0.06, 0.8, [0.45, 0.25, 0.3]); // 座布団 (通り道は空ける)
  // 内陣: 奥に御簾と幣。中は通れる
  for (const s of [-1, 1]) {
    b.box(s * 3.2, F + PH - 1.2, zs[0] + 0.3, 2.2, 2.2, 0.04, [0.55, 0.62, 0.35]);         // 御簾
    for (let j = 0; j < 8; j++) b.box(s * 3.2, F + PH - 2.3 + j * 0.28, zs[0] + 0.33, 2.2, 0.02, 0.02, C.gold);
    b.cylinder(s * 3.0, F, zs[0] + 1.0, 0.03, 0.03, 1.6, C.wood, { seg: 8 });
    b.box(s * 3.0, F + 1.75, zs[0] + 1.0, 0.5, 0.5, 0.02, C.white, { sway: 1 });         // 幣
    lights.push({ pos: [s * 3.0, F + 2.6, zs[0] + 1.6], col: [1.0, 0.75, 0.45], k: 1.2 });
  }
  // 当たり: 側面と背面の壁、柱
  for (const s of [-1, 1]) {
    blockers.push({ x0: s > 0 ? HX - 0.7 : -HX - 0.6, x1: s > 0 ? HX + 0.6 : -HX + 0.7, z0: z - HZ - 0.6, z1: z + HZ + 0.6 });
    blockers.push({ x0: s > 0 ? LAYOUT.corridor.halfX + 0.9 : -HX, x1: s > 0 ? HX : -LAYOUT.corridor.halfX - 0.9, z0: z - HZ - 0.6, z1: z - HZ + 0.6 });
    blockers.push({ x0: s > 0 ? 2.4 : -HX, x1: s > 0 ? HX : -2.4, z0: z + HZ - 0.5, z1: z + HZ + 0.7 });
  }
  for (const px of xs) for (const pz of zs) if (!(pz === z && Math.abs(px) < 2)) blockers.push({ cx: px, cz: pz, r: 0.3 });
}

// ---------- 渡殿: 拝殿の裏から本殿へ、屋根付きの廊下。奥で三段上がる ----------
function corridor(b, lights, blockers) {
  const C = COLORS, K = LAYOUT.corridor, F = LAYOUT.haiden.floor, F2 = LAYOUT.honden.floor, HX = K.halfX;
  const z0 = K.z0, z1 = K.z1, zs = z0 + 2.4;                       // zs から手前は F、奥は F2 に上がる
  const EW = HX + 0.9;                                                                     // 床の半幅 (柱の外まで)
  b.box(0, F - 0.12, (zs + z1) / 2, EW * 2, 0.24, z1 - zs, C.wood);
  b.box(0, F2 - 0.12, (z0 + zs) / 2 + 0.4, EW * 2, 0.24, zs - z0 + 0.8, C.wood);
  planks(b, -EW + 0.1, EW - 0.1, zs + 1.3, z1, F); planks(b, -EW + 0.1, EW - 0.1, z0, zs, F2);
  stairs(b, 0, zs + 1.2, zs, F, F2, HX * 2 + 0.2, 3);
  for (const s of [-1, 1]) {                                                               // 縁桁と、地面までの束
    b.box(s * (EW - 0.15), F - 0.4, (zs + z1) / 2, 0.3, 0.34, z1 - zs, C.darkwood);
    b.box(s * (EW - 0.15), F2 - 0.4, (z0 + zs) / 2 + 0.4, 0.3, 0.34, zs - z0 + 0.8, C.darkwood);
    for (let zz = z0 + 0.6; zz < z1; zz += 1.5) {
      const f = zz < zs ? F2 : F;
      b.box(s * (EW - 0.15), (f - 0.5) / 2, zz, 0.2, f - 0.5, 0.2, C.darkwood);
      b.frustum(s * (EW - 0.15), 0, zz, 0.12, 0.22, 0.22, 0.16, 0.16, C.stone);
    }
  }
  for (let zz = z0 + 0.6; zz < z1; zz += 1.5) b.box(0, (Math.min(F, zz < zs ? F2 : F) - 0.3) / 2, zz, 0.2, (zz < zs ? F2 : F) - 0.3, 0.2, C.darkwood);
  for (const s of [-1, 1]) {
    const PX = EW - 0.2, KX = PX;                 // 高欄は柱の線に載せる (柱が親柱を兼ねる)
    const NP = 8;
    for (let i = 0; i < NP; i++) {
      const zz = (z0 + 1.2) + ((z1 - 1.0) - (z0 + 1.2)) * i / (NP - 1), f = zz < zs ? F2 : F;
      b.cylinder(s * PX, f, zz, 0.14, 0.12, 3.0, C.vermilion, { seg: 14 });          // 床の縁に立つ柱。高欄はこれに取り付く
      b.box(s * PX, f + 3.15, zz, 0.36, 0.3, 0.36, C.black);
      railPillars.push([s * PX, zz]);
    }
    b.box(s * PX, F + 3.5, (z0 + z1) / 2, 0.26, 0.26, z1 - z0 + 0.4, C.vermilion);
  }
  for (let i = 0; i < 8; i++) b.box(0, F + 3.55, (z0 + 1.2) + ((z1 - 1.0) - (z0 + 1.2)) * i / 7, EW * 2 - 0.2, 0.24, 0.24, C.vermilion);
  // 屋根: z 方向に棟が通る切妻。左右へ傾けた板 2 枚と棟木
  { const a = 0.55, w = (EW + 0.9) / Math.cos(a), yc = F + 4.4, zc = (z0 + z1) / 2, len = z1 - z0 + 1.2;
    for (const s of [-1, 1]) {
      const m = chain(M.tr(0, yc, zc), M.rz(-s * a), M.tr(s * w / 2, 0, 0));
      b.box(0, 0, 0, w, 0.24, len, C.roof, { mat: m });
      b.box(0, -0.24, 0, w - 0.3, 0.06, len - 0.2, C.darkwood, { mat: m });
    }
    b.box(0, yc + 0.15, zc, 0.5, 0.3, len, C.black);
    for (let zz = z0 - 0.3; zz <= z1 + 0.3; zz += 0.45) for (const s of [-1, 1]) b.box(0, -0.05, 0, w - 0.4, 0.1, 0.1, C.darkwood, { mat: chain(M.tr(0, yc - 0.2, zz), M.rz(-s * a), M.tr(s * (w - 0.4) / 2, 0, 0)) });
  }
  for (let zz = z0 + 2.0; zz < z1; zz += 4.8) {
    b.cylinder(0, F + 3.1, zz, 0.2, 0.24, 0.5, C.paper, { seg: 14, em: 0.8 });
    lights.push({ pos: [0, F + 3.3, zz], col: [1.0, 0.55, 0.25], k: 1.3 });
  }
  for (const s of [-1, 1]) blockers.push({ x0: s > 0 ? EW - 0.5 : -EW - 0.5, x1: s > 0 ? EW + 0.5 : -EW + 0.5, z0: z0 - 0.2, z1: z1 + 0.2 });
}

// ---------- 本殿: 高床、流造。扉が開くと中に大きな神棚 ----------
function honden(b, lights, blockers) {
  const C = COLORS, Hn = LAYOUT.honden, z = Hn.z, dz = Hn.doorZ, hx = Hn.hingeX, F = Hn.floor, HX = Hn.halfX, HZ = Hn.halfZ;
  b.box(0, 0.4, z, HX * 2 + 4, 0.8, HZ * 2 + 4, C.stone);                                   // 基壇
  b.box(0, F - 0.12, z, HX * 2 + 1.6, 0.24, HZ * 2 + 1.6, C.wood);                           // 床 (縁まで)
  planks(b, -HX + 0.3, HX - 0.3, z - HZ + 0.3, z + HZ - 0.3, F);
  for (let x = -HX - 0.6; x <= HX + 0.6; x += 1.2) for (let zz = z - HZ - 0.6; zz <= z + HZ + 0.6; zz += 1.2) b.box(x, F - 0.7, zz, 0.2, 0.95, 0.2, C.darkwood);
  const E = 0.8;
  // 柱と壁
  const PH = 5.4, R = 0.28, top = F + PH;
  const xs = [-HX + 0.3, -HX / 3, HX / 3, HX - 0.3], zs = [z - HZ + 0.3, z - HZ / 3, z + HZ / 3, z + HZ - 0.3];
  for (const px of xs) for (const pz of zs) if (px === xs[0] || px === xs[3] || pz === zs[0] || pz === zs[3]) pillar(b, px, F, pz, PH, R);
  const WY = F + 0.02, WH = PH - 1.0;
  b.box(0, WY + WH / 2, zs[0], HX * 2 - 0.6, WH, 0.3, C.white);                                  // 背面
  wallFrame(b, { cx: 0, cz: zs[0], cy: WY + WH / 2, h: WH - 0.08, d: 0.3, alongX: true, pillars: xs });
  for (const s of [-1, 1]) {                                                                      // 側面
    b.box(s * (HX - 0.3), WY + WH / 2, z, 0.3, WH, HZ * 2 - 0.6, C.white);
    wallFrame(b, { cx: s * (HX - 0.3), cz: z, cy: WY + WH / 2, h: WH - 0.08, d: 0.3, alongX: false, pillars: zs });
  }
  { const w = HX - 0.3 - hx;                                                                       // 正面 (扉の脇)。扉の端 hx から柱まで隙間なく
    for (const s of [-1, 1]) {
      b.box(s * (hx + w / 2), WY + WH / 2, zs[3], w, WH, 0.3, C.white);
      wallFrame(b, { cx: s * (hx + w / 2), cz: zs[3], cy: WY + WH / 2, h: WH - 0.08, d: 0.3, alongX: true,
        pillars: [s * hx, s * (HX - 0.3)].sort((p, q) => p - q) });
    } }
  for (const yy of [F + 1.0, top - 0.8]) {
    b.box(0, yy, zs[0] - 0.2, HX * 2, 0.24, 0.12, C.vermilion);
    if (yy > F + 2) b.box(0, yy, zs[3] + 0.2, HX * 2, 0.24, 0.12, C.vermilion);
    else for (const s of [-1, 1]) b.box(s * (hx + 0.1 + HX) / 2, yy, zs[3] + 0.2, HX - hx - 0.1, 0.24, 0.12, C.vermilion);
    for (const s of [-1, 1]) b.box(s * (HX - 0.1), yy, z, 0.12, 0.24, HZ * 2, C.vermilion);
  }
  b.box(0, top + 0.3, zs[0], HX * 2 + 0.6, 0.4, 0.4, C.vermilion); b.box(0, top + 0.3, zs[3], HX * 2 + 0.6, 0.4, 0.4, C.vermilion);
  for (const px of [xs[0], xs[3]]) b.box(px, top + 0.3, z, 0.4, 0.4, HZ * 2, C.vermilion);
  for (const s of [-1, 1]) kaerumata(b, s * 2.6, top + 0.5, zs[3], 1.6, 0.9, true);              // 正面の桁の上
  for (const s of [-1, 1]) kaerumata(b, s * 2.6, top + 0.5, zs[0], 1.6, 0.9, true);
  b.box(0, top - 0.55, z, HX * 2 - 0.6, 0.3, HZ * 2 - 0.6, C.darkwood);                        // 天井
  for (let i = -4; i <= 4; i++) b.box(i * 1.1, top - 0.72, z, 0.12, 0.1, HZ * 2 - 0.6, C.black);   // 竿縁天井の桟
  for (let i = -4; i <= 4; i++) b.box(0, top - 0.72, z + i * 1.2, HX * 2 - 0.6, 0.1, 0.12, C.black);
  // 扉 (sway 3/4 で開く)。金具付き
  for (const s of [-1, 1]) {
    const sw = s < 0 ? 3 : 4;
    b.box(s * (hx - 0.65), WY + WH / 2, zs[3] + 0.25, 1.3, WH - 0.1, 0.12, C.wood, { sway: sw });
    for (const yy of [WY + 0.5, WY + WH / 2, WY + WH - 0.5]) b.box(s * (hx - 0.65), yy, zs[3] + 0.33, 1.1, 0.12, 0.03, C.gold, { sway: sw });
    b.cylinder(s * (hx - 0.65), WY + WH / 2, zs[3] + 0.36, 0.14, 0.14, 0.04, C.gold, { seg: 16, mat: M.rx(Math.PI / 2), sway: sw });
  }
  b.box(0, top - 0.7, zs[3] + 0.3, hx * 2 + 0.4, 0.3, 0.2, C.vermilion);                       // 鴨居
  // 向拝 (渡殿との接続部) と階段
  const vz = zs[3] + E + 1.0;
  for (const s of [-1, 1]) pillar(b, s * 2.2, F, vz, PH - 0.4, 0.22);
  b.box(0, top - 0.4, vz, 4.8, 0.36, 0.36, C.vermilion);
  b.karaHafu({ y: top + 1.6, z0: vz - 1.4, z1: vz + 1.4, drop: 0.9, halfX: 3.2, amp: 1.0, col: C.roof });
  // 屋根: 流造 (前へ長く流れる)。千木と鰹木
  const ridgeY = top + 5.4;
  b.roof({ ridgeY, ridgeZ: z - 0.6, halfX: HX + 1.6, front: HZ + 3.6, back: HZ + 1.8, slope: 0.6, thick: 0.36, flare: 0.5, col: C.roof, under: C.darkwood, N: 14 });
  b.box(0, ridgeY + 0.2, z - 0.6, HX * 2 + 3.6, 0.5, 0.8, C.black);
  for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) b.cylinder(x, ridgeY + 0.45, z - 0.6, 0.22, 0.22, 2.0, C.black, { seg: 12, mat: chain(M.tr(0, 0, -1.0), M.rx(Math.PI / 2)) });
  for (const s of [-1, 1]) for (const a of [-1, 1]) b.box(s * (HX + 1.7), ridgeY + 1.2, z - 0.6, 0.16, 3.4, 0.3, C.black, { mat: M.rx(a * 0.5) });
  for (const d of [-1, 1]) rafters(b, 0, HX + 1.4, z - 0.6, z - 0.6 + d * (d > 0 ? HZ + 3.4 : HZ + 1.6), ridgeY - 0.3, top + 1.0);
  // ---- 神棚: 奥に一段高い内陣。中央に宮形、御鏡、三方、榊、灯明、注連縄 ----
  const az = zs[0] + 1.6, AY = F + 0.6;
  b.box(0, F + 0.3, az, HX * 2 - 1.2, 0.6, 2.8, C.darkwood);                                    // 内陣の壇
  b.box(0, AY + 0.02, az, HX * 2 - 1.4, 0.04, 2.6, C.wood);
  stairs(b, 0, az + 1.9, az + 1.4, F, AY, 3.0, 2);
  for (const s of [-1, 1]) railPath(b, [[s * 1.6, az + 1.4], [s * (HX - 0.7), az + 1.4]], AY, C.wood);
  // 宮形 (中央の小さな社)。流造の屋根、扉、階段
  const mz = az - 0.4, MW = 1.6, MH = 1.7, MY = AY + 0.3;
  b.box(0, AY + 0.15, mz, MW + 1.2, 0.3, 2.0, C.wood);
  for (const s of [-1, 1]) b.cylinder(s * (MW / 2 + 0.35), MY - 0.15, mz + 0.9, 0.06, 0.06, MH + 0.3, C.white, { seg: 10 });
  b.box(0, MY + MH / 2, mz, MW, MH, 1.2, C.white);
  for (const s of [-1, 1]) b.box(s * 0.35, MY + MH / 2, mz + 0.62, 0.62, MH - 0.3, 0.05, [0.85, 0.80, 0.68]);
  b.box(0, MY + MH / 2, mz + 0.65, 0.04, MH - 0.3, 0.06, C.gold);
  stairs(b, 0, mz + 1.15, mz + 0.62, AY + 0.3, MY + 0.05, 0.9, 4, C.white);
  b.roof({ ridgeY: MY + MH + 1.1, ridgeZ: mz - 0.1, halfX: MW / 2 + 0.55, front: 1.4, back: 0.7, slope: 0.7, thick: 0.1, flare: 0.15, col: C.roof, under: C.darkwood, N: 8 });
  for (const s of [-1, 1]) for (const a of [-1, 1]) b.box(s * (MW / 2 + 0.55), MY + MH + 1.5, mz - 0.1, 0.05, 1.0, 0.08, C.gold, { mat: M.rx(a * 0.5) });
  for (const x of [-0.4, 0, 0.4]) b.cylinder(x, MY + MH + 1.2, mz - 0.1, 0.06, 0.06, 0.6, C.gold, { seg: 8, mat: chain(M.tr(0, 0, -0.3), M.rx(Math.PI / 2)) });
  // 御鏡: 宮形の前、台の上
  b.frustum(0, AY, mz + 1.5, AY + 0.25, 0.3, 0.2, 0.22, 0.14, C.black);
  b.cylinder(0, AY + 0.25, mz + 1.5, 0.05, 0.05, 0.35, C.gold, { seg: 10 });
  { const MR = LAYOUT.mirror;
    b.cylinder(MR.x, MR.y, MR.z - 0.1, 0.42, 0.42, 0.09, C.gold, { seg: 28, mat: M.rx(Math.PI / 2) });   // 枠
    b.cylinder(MR.x, MR.y, MR.z, 0.34, 0.34, 0.015, [0.86, 0.88, 0.9], { seg: 32, mat: M.rx(Math.PI / 2), sway: 14 }); }
  // 三方に神饌 (米・塩・水) と、榊、灯明
  for (const s of [-1, 1]) {
    for (const [ox, kind] of [[0.7, 0], [1.2, 1]]) {
      const x = s * ox, zz = mz + 1.3 + (kind ? 0.2 : 0);
      b.box(x, AY + 0.12, zz, 0.32, 0.24, 0.32, C.white);
      b.box(x, AY + 0.26, zz, 0.36, 0.04, 0.36, C.white);
      if (kind) b.cylinder(x, AY + 0.28, zz, 0.09, 0.07, 0.14, [0.92, 0.92, 0.9], { seg: 12 });
      else b.frustum(x, AY + 0.28, zz, AY + 0.4, 0.1, 0.1, 0.02, 0.02, [0.96, 0.96, 0.94]);
    }
    const sx = s * 1.9;
    b.cylinder(sx, AY, mz + 1.0, 0.1, 0.08, 0.5, C.white, { seg: 12 });                        // 榊立て
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, tilt = 0.25 + (k % 3) * 0.1;
      b.cylinder(sx, AY + 0.5, mz + 1.0, 0.012, 0.008, 0.9, C.leaf.map(c => c * 3), { seg: 5, mat: chain(M.ry(a), M.rz(-tilt)) });
      for (let j = 0; j < 4; j++) b.box(0, 0.35 + j * 0.15, 0, 0.16, 0.01, 0.08, [0.12, 0.30, 0.14], { mat: chain(M.tr(sx, AY + 0.5, mz + 1.0), M.ry(a), M.rz(-tilt), M.ry(j * 1.3)) });
    }
    const lx = s * 2.6;
    b.cylinder(lx, AY, mz + 1.6, 0.08, 0.05, 0.7, C.gold, { seg: 12 });                        // 灯明
    b.cylinder(lx, AY + 0.7, mz + 1.6, 0.05, 0.02, 0.12, [1.0, 0.85, 0.5], { seg: 8, em: 1.0 });
    lights.push({ pos: [lx, AY + 0.85, mz + 1.6], col: [1.0, 0.72, 0.4], k: 1.6, interior: true });
    // 幣・御簾
    b.cylinder(s * 3.4, AY, mz + 0.5, 0.03, 0.03, 1.8, C.wood, { seg: 8 });
    b.box(s * 3.4, AY + 1.95, mz + 0.5, 0.5, 0.5, 0.02, C.white, { sway: 1 });
  }
  b.box(0, top - 1.3, az + 1.4, HX * 2 - 1.2, 1.3, 0.04, [0.55, 0.62, 0.35]);                   // 御簾 (半分巻き上げ)
  for (let j = 0; j < 5; j++) b.box(0, top - 1.85 + j * 0.28, az + 1.43, HX * 2 - 1.2, 0.02, 0.02, C.gold);
  hcyl(b, 0, top - 0.68, az + 1.4, 0.12, HX * 2 - 1.2, [0.5, 0.55, 0.3], 'x');
  // 注連縄 (内陣の前)
  { const y = top - 1.9, N = 13, sag = 0.4, L = HX - 0.8;
    const rope = i => { const tt = i / N; return [-L + 2 * L * tt, y - Math.sin(tt * Math.PI) * sag, az + 1.6]; };
    for (let i = 0; i < N; i++) {
      const a = rope(i), c = rope(i + 1), ddx = c[0] - a[0], ddy = c[1] - a[1], l = Math.hypot(ddx, ddy);
      const r = 0.08 + Math.sin((i + 0.5) / N * Math.PI) * 0.1;
      b.cylinder(a[0], a[1], a[2], r, r, l, C.rope, { seg: 10, mat: M.rz(-Math.atan2(ddx, ddy)) });
    }
    for (let i = 1; i < N; i += 2) { const p = rope(i); b.box(p[0], p[1] - 0.4, p[2] + 0.05, 0.18, 0.7, 0.02, C.white, { sway: 1 }); } }
  // ---- 内陣まわりの調度 ----
  { const C2 = COLORS;
    // 御帳台: 宮形の上を覆う四本柱の天蓋。紫の帳が下がる
    const tz = mz + 0.1, tw = MW / 2 + 1.0, th = AY + MH + 1.9;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(sx * tw, AY + 0.3, tz + sz * 1.1, 0.06, 0.055, th - AY - 0.3, C2.black, { seg: 14 });
    b.box(0, th + 0.09, tz, tw * 2 + 0.4, 0.18, 2.6, C2.black);
    b.box(0, th + 0.22, tz, tw * 2 + 0.2, 0.1, 2.4, C2.gold);
    for (const sz of [-1, 1]) {                                                     // 帳 (前後)
      b.box(0, th - 0.45, tz + sz * 1.1, tw * 2, 0.8, 0.03, [0.30, 0.15, 0.38]);
      for (let i = -5; i <= 5; i++) b.box(i * tw / 5.5, th - 0.45, tz + sz * 1.13, 0.05, 0.8, 0.01, [0.20, 0.09, 0.28]);
    }
    for (const sx of [-1, 1]) {                                                     // 帳 (左右) と房
      b.box(sx * tw, th - 0.45, tz, 0.03, 0.8, 2.2, [0.30, 0.15, 0.38]);
      for (const sz of [-1, 1]) {
        b.cylinder(sx * tw, th - 0.9, tz + sz * 1.1, 0.012, 0.012, 0.3, [0.6, 0.15, 0.2], { seg: 6, mat: M.rx(Math.PI) });
        b.cylinder(sx * tw, th - 1.32, tz + sz * 1.1, 0.035, 0.055, 0.16, [0.6, 0.15, 0.2], { seg: 10 });
      }
    }
    // 狛犬: 宮形の左右を守る。台座の上に、胸を張った塊と頭・尾
    for (const sx of [-1, 1]) {
      const cx = sx * (MW / 2 + 0.85), cz = mz + 1.5, by = AY + 0.22;
      b.box(cx, AY + 0.11, cz, 0.44, 0.22, 0.5, C2.stone.map(c => c * 0.8));
      b.frustum(cx, by, cz, by + 0.34, 0.15, 0.2, 0.13, 0.17, C2.stone);            // 胴
      b.box(cx, by + 0.42, cz - 0.02, 0.3, 0.22, 0.34, C2.stone);
      b.box(cx, by + 0.62, cz + 0.14, 0.24, 0.24, 0.24, C2.stone);                  // 頭
      b.box(cx, by + 0.58, cz + 0.3, 0.14, 0.12, 0.12, C2.stone);                   // 鼻づら
      for (const e of [-1, 1]) b.box(cx + e * 0.09, by + 0.76, cz + 0.12, 0.08, 0.1, 0.07, C2.stone);   // 耳
      for (const f of [-1, 1]) b.cylinder(cx + f * 0.1, by, cz + 0.18, 0.045, 0.04, 0.3, C2.stone, { seg: 10 });  // 前脚
      b.frustum(cx, by + 0.3, cz - 0.22, by + 0.78, 0.08, 0.08, 0.12, 0.06, C2.stone);   // 尾
      if (sx < 0) b.cylinder(cx, by + 0.86, cz + 0.02, 0.05, 0.02, 0.14, C2.stone, { seg: 10 });        // 片方に角 (狛犬)
    }
    // 燈明の吊り灯籠を内陣の四隅に
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * (HX - 1.5), lz = az + (sz > 0 ? 1.1 : -1.1);
      b.cylinder(lx, top - 0.75, lz, 0.012, 0.012, 1.0, C2.black, { seg: 6, mat: M.rx(Math.PI) });
      b.frustum(lx, top - 1.95, lz, top - 1.78, 0.16, 0.16, 0.2, 0.2, C2.gold);
      b.box(lx, top - 1.66, lz, 0.3, 0.42, 0.3, [1.0, 0.82, 0.52], { em: 0.75 });
      b.frustum(lx, top - 1.45, lz, top - 1.3, 0.26, 0.26, 0.05, 0.05, C2.gold);
      lights.push({ pos: [lx, top - 1.66, lz], col: [1.0, 0.7, 0.4], k: 1.1, interior: true });
    }
    // 壁の御簾を左右にも
    for (const sx of [-1, 1]) {
      b.box(sx * (HX - 0.5), top - 1.6, az, 0.04, 1.5, 3.0, [0.55, 0.62, 0.35]);
      for (let j = 0; j < 6; j++) b.box(sx * (HX - 0.53), top - 2.2 + j * 0.26, az, 0.02, 0.02, 3.0, C2.gold);
    }
    // 床: 内陣の前に繧繝縁の畳を敷く
    for (let i = -1; i <= 1; i++) {
      b.box(i * 1.9, F + 0.04, az + 3.0, 1.8, 0.08, 2.6, [0.72, 0.70, 0.52]);
      for (const e of [-1, 1]) b.box(i * 1.9 + e * 0.88, F + 0.05, az + 3.0, 0.08, 0.09, 2.6, [0.35, 0.20, 0.28]);
      for (const e of [-1, 1]) b.box(i * 1.9, F + 0.05, az + 3.0 + e * 1.28, 1.8, 0.09, 0.08, [0.35, 0.20, 0.28]);
    }
  }
  lights.push({ pos: [0, F + 3.2, z + 1.0], col: [1.0, 0.85, 0.55], k: 2.6, interior: true });
  // 玉垣: 本殿を囲んで一周。正面は渡殿の幅だけ開ける
  { const FX = HX + 3.2, FZ0 = z - HZ - 3, FZ1 = z + HZ + 3, gate = LAYOUT.corridor.halfX + 1.1;
    fence(b, [[-FX, FZ1], [-FX, FZ0], [FX, FZ0], [FX, FZ1]]);   // 左・背面・右を 1 本で
    fence(b, [[-FX, FZ1], [-gate, FZ1]]);                        // 正面 (左)
    fence(b, [[gate, FZ1], [FX, FZ1]]); }                        // 正面 (右)
  // 当たり: 壁 (扉は main.js 側で開閉に応じて判定)。内陣の壇には上がれない
  blockers.push({ x0: -HX - 1, x1: -HX + 0.1, z0: z - HZ - 1, z1: z + HZ + 1 });
  blockers.push({ x0: HX - 0.1, x1: HX + 1, z0: z - HZ - 1, z1: z + HZ + 1 });
  blockers.push({ x0: -HX - 1, x1: HX + 1, z0: z - HZ - 1, z1: z - HZ + 0.1 });
  for (const s of [-1, 1]) blockers.push({ x0: s > 0 ? hx : -HX, x1: s > 0 ? HX : -hx, z0: zs[3] - 0.2, z1: zs[3] + 0.5 });
  blockers.push({ x0: -HX + 0.5, x1: HX - 0.5, z0: az - 1.5, z1: az + 1.5 });
  for (const px of [xs[0], xs[3]]) for (const pz of zs) blockers.push({ cx: px, cz: pz, r: 0.32 });
  for (const s of [-1, 1]) blockers.push({ cx: s * 2.2, cz: vz, r: 0.28 });
  for (const s of [-1, 1]) blockers.push({ x0: s > 0 ? HX + 3.0 : -HX - 3.4, x1: s > 0 ? HX + 3.4 : -HX - 3.0, z0: z - HZ - 3.2, z1: z + HZ + 3.2 });
  blockers.push({ x0: -HX - 3.4, x1: HX + 3.4, z0: z - HZ - 3.2, z1: z - HZ - 2.8 });
  blockers.push({ x0: -HX - 3.4, x1: HX + 3.4, z0: z + HZ + 2.8, z1: z + HZ + 3.2, gateX: LAYOUT.corridor.halfX + 1.2 });
}

// ---------- 濡れた足跡 ----------
// 鳥居から本殿の扉まで一人分。普段は地面の下に沈めてある
function footprints(b) {
  const wet = [0.045, 0.055, 0.075];
  const z0 = LAYOUT.torii - 1.0, z1 = LAYOUT.honden.doorZ + 1.2;
  const n = Math.floor((z0 - z1) / 0.78);
  for (let i = 0; i <= n; i++) {
    const tt = i / n, z = z0 + (z1 - z0) * tt;
    // 参道の中ほどまでは端を歩き、拝殿の手前から中央へ寄る (正中を外していない歩き方)
    const lane = z > 12 ? 1.25 : 0.42;
    const x = (i % 2 ? 1 : -1) * 0.17 + lane * Math.sign(-1);
    const y = 0.09 + (z > 12 || z < -3 ? 0 : 0);
    const a = 0.06 * (i % 2 ? 1 : -1);
    const m = chain(M.tr(x, y, z), M.ry(a));
    b.box(0, 0, 0, 0.1, 0.004, 0.23, wet, { sway: 8, mat: m });                    // 土踏まず
    b.box(0, 0, 0.11, 0.115, 0.004, 0.09, wet, { sway: 8, mat: m });               // 指のつけ根
    b.box(0, 0, -0.11, 0.085, 0.004, 0.07, wet, { sway: 8, mat: m });              // 踵
  }
}

// ---------- 御神木 ----------
function shinboku(b, blockers) {
  const C = COLORS, x = -9.4, z = 32.5, H = 17;
  b.frustum(x, 0, z, 0.5, 1.5, 1.5, 1.05, 1.05, C.trunk.map(c => c * 0.9));       // 根張り
  b.cylinder(x, 0.5, z, 1.0, 0.42, H, C.trunk, { seg: 24 });
  for (let i = 0; i < 5; i++) {                                                    // 上の方の枝
    const a = i * 1.35, tilt = 0.9 + (i % 3) * 0.2, y = H * (0.5 + i * 0.09);
    b.cylinder(x, y, z, 0.16, 0.05, 3.4 + (i % 2) * 1.2, C.trunk, { seg: 8, mat: chain(M.ry(a), M.rz(-tilt)) });
  }
  for (let t2 = 0; t2 < 6; t2++) {                                                 // 葉の塊 (シルエット)
    const y0 = H * (0.42 + t2 * 0.1), w = 4.6 - t2 * 0.6;
    b.frustum(x, y0, z, y0 + H * 0.14, w, w, w * 0.4, w * 0.4, C.leaf);
  }
  // 注連縄: 幹を一周。太い所と細い所を作る
  { const y = 2.6, N = 26, r = 1.02;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0 * 3) * 0.05, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, y + Math.sin(a1 * 3) * 0.05, z + Math.sin(a1) * r];
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz);
      const rr = 0.11 + Math.sin(i / N * Math.PI * 4) * 0.035;
      b.cylinder(p0[0], p0[1], p0[2], rr, rr, l, C.rope, { seg: 8, mat: chain(M.ry(Math.atan2(dx, dz)), M.rx(Math.PI / 2)) });
    }
    for (let i = 0; i < 8; i++) {                                                  // 紙垂
      const a = i / 8 * Math.PI * 2;
      b.box(x + Math.cos(a) * (r + 0.02), y - 0.45, z + Math.sin(a) * (r + 0.02), 0.18, 0.7, 0.02,
        C.white, { sway: 1, mat: M.ry(-a) });
    } }
  // 藁人形。局所座標で組んでから 1 つの行列で置く
  { const straw = [0.70, 0.61, 0.37], dark = straw.map(c => c * 0.72);
    const r = 0.96;                                              // その高さの幹の半径
    const m = chain(M.tr(x, 1.62, z - r + 0.02), M.ry(Math.PI));  // 幹の裏面に密着させる
    const at = (...ms) => chain(m, ...ms);
    const limb = (px, py, ang, len, r0, r1) => b.cylinder(0, 0, 0, r0, r1, len, straw, { sway: 9, seg: 8, mat: at(M.tr(px, py, 0), M.rz(ang)) });
    b.cylinder(0, 0, 0, 0.075, 0.07, 0.34, straw, { sway: 9, seg: 12, mat: at(M.tr(0, -0.18, 0)) });          // 胴
    b.cylinder(0, 0, 0, 0.055, 0.058, 0.14, straw, { sway: 9, seg: 12, mat: at(M.tr(0, 0.16, 0)) });          // 首から頭
    b.cylinder(0, 0, 0, 0.058, 0.03, 0.05, straw, { sway: 9, seg: 12, mat: at(M.tr(0, 0.30, 0)) });           // 頭の結び目
    for (const s of [-1, 1]) {
      limb(s * 0.055, 0.10, s * 2.05, 0.2, 0.032, 0.022);        // 腕: 肩から斜め下へ
      limb(s * 0.035, -0.18, s * 3.02, 0.19, 0.036, 0.024);      // 脚: 腰から下へ (わずかに開く)
    }
    for (const yy of [0.06, -0.06, -0.17]) {                     // 縄で縛ってある帯
      b.cylinder(0, 0, 0, 0.081, 0.081, 0.022, dark, { sway: 9, seg: 12, mat: at(M.tr(0, yy, 0)) });
    }
    // 五寸釘。6 本あるが、最初は 1 本だけ見える
    const nails = [[0.0, 0.07], [-0.035, -0.04], [0.03, -0.13], [0.055, 0.02], [-0.05, -0.19], [0.0, -0.28]];
    nails.forEach(([nx, ny], i) => {
      const sw = 20 + i * 0.1;
      b.cylinder(0, 0, 0, 0.009, 0.009, 0.16, [0.13, 0.12, 0.12], { seg: 8, sway: sw, mat: at(M.tr(nx, ny, 0.1), M.rx(Math.PI / 2)) });
      b.cylinder(0, 0, 0, 0.022, 0.022, 0.012, [0.17, 0.16, 0.16], { seg: 10, sway: sw, mat: at(M.tr(nx, ny, 0.105), M.rx(Math.PI / 2)) });
    }); }
  blockers.push({ cx: x, cz: z, r: 1.5 });
}

// ---------- 桜 ----------
function sakura(b, rnd, blossoms, blockers, density = 1) {
  const C = COLORS;
  const spots = [];
  for (const s of [-1, 1]) for (const z of [14, 21, 28]) spots.push([s * (7.0 + rnd() * 0.8), z + rnd() * 2]);
  for (const s of [-1, 1]) for (const z of [6, 16, 24, 32, 42]) spots.push([s * (12 + rnd() * 3), z + rnd() * 3]);
  for (const s of [-1, 1]) { spots.push([s * (13 + rnd() * 2), -4 + rnd() * 2]); spots.push([s * (13.5 + rnd() * 2), -14 + rnd() * 2]); spots.push([s * (14 + rnd() * 2), -26 + rnd() * 3]); }
  // 塊の外側ほど外を向く
  // 房の板 (1 枚に十数輪) と、表面の 1 輪ずつの花の 2 層
  const puff = (p, r, n) => {
    const place = (size, k) => {
      const u = rnd() * 2 - 1, v = rnd() * 2 * Math.PI, rr = r * k, sx = Math.sqrt(1 - u * u);
      const dx = sx * Math.cos(v), dy = u * 0.75, dz = sx * Math.sin(v);
      const nx = dx + (rnd() - 0.5) * 0.9, ny = dy + 0.4 + (rnd() - 0.5) * 0.9, nz = dz + (rnd() - 0.5) * 0.9;
      const l = Math.hypot(nx, ny, nz) || 1;
      pushBlossom(blossoms, [p[0] + rr * dx, p[1] + rr * dy, p[2] + rr * dz], [nx / l, ny / l, nz / l], size, rnd(), k);
    };
    // 房の板は 1 枚で 16 輪ぶん描けるので、板の数は抑えて房の比率を上げる (頂点数と塗る面積の両方が減る)
    for (let i = 0; i < n * 0.5 * density; i++) place(0.42 + rnd() * 0.22, Math.pow(rnd(), 0.6) * 0.95);  // 房
    for (let i = 0; i < n * 0.35 * density; i++) place(0.10 + rnd() * 0.08, Math.pow(rnd(), 0.4));        // 表面の 1 輪ずつ
  };
  // 4 段に分岐
  const branch = (m, len, r0, depth) => {
    const r1 = depth === 0 ? 0.015 : r0 * 0.62;
    b.cylinder(0, 0, 0, r0, r1, len, C.sakuraTrunk, { seg: depth > 2 ? 14 : depth > 0 ? 8 : 5, mat: m });
    const tip = M.pt(m, [0, len, 0]);
    if (depth === 0) {
      for (let i = 0; i < 3; i++) {                                        // 小枝
        const a = rnd() * Math.PI * 2, tilt = 0.5 + rnd() * 0.8, l = 0.35 + rnd() * 0.4;
        const mm = chain(m, M.tr(0, len * (0.4 + rnd() * 0.6), 0), M.ry(a), M.rz(-tilt));
        b.cylinder(0, 0, 0, 0.018, 0.008, l, C.sakuraTrunk, { seg: 4, mat: mm });
      }
      puff(tip, 0.75 + rnd() * 0.3, 300);
      return;
    }
    const k = depth === 3 ? 3 : 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rnd() * 1.4, tilt = 0.4 + rnd() * 0.55;
      const at = len * (0.5 + rnd() * 0.5);
      branch(chain(m, M.tr(0, at, 0), M.ry(a), M.rz(-tilt)), len * (0.6 + rnd() * 0.22), r1 * 1.15, depth - 1);
    }
    if (depth === 1 && rnd() < 0.8) puff(tip, 0.6 + rnd() * 0.3, 190);   // 途中の枝先にも花
  };
  for (const [x, z] of spots) {
    if (Math.hypot(x + 9.4, z - 32.5) < 5.5) continue;                    // 御神木のまわりは空ける
    if (Math.abs(x - LAYOUT.chozuya.x) < 4 && Math.abs(z - LAYOUT.chozuya.z) < 4) continue;
    if (Math.abs(x - LAYOUT.ema.x) < 3.5 && Math.abs(z - LAYOUT.ema.z) < 3) continue;
    const lean = (rnd() - 0.5) * 0.2, h = 2.6 + rnd() * 1.0;
    b.frustum(x, 0, z, 0.25, 0.5, 0.5, 0.36, 0.36, C.sakuraTrunk);                // 根張り
    branch(chain(M.tr(x, 0, z), M.rz(lean)), h, 0.36, 4);
    blockers.push({ cx: x, cz: z, r: 0.7 });
  }
}

// 木を立てない範囲
function keepOut(x, z) {
  if (Math.abs(x) < 7.5) return true;                        // 参道・鳥居の抜け
  if (Math.abs(x) < 18 && z > -40 && z < 50) return true;    // 境内 (本殿の裏から鳥居の内側まで)
  return false;
}

// ---------- 奥の杉 (シルエット) ----------
function cedars(b, rnd) {
  const C = COLORS;
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2, d = 24 + rnd() * 30;
    const x = Math.cos(a) * d, z = 12 + Math.sin(a) * d * 0.9, h = 12 + rnd() * 12;
    if (keepOut(x, z)) continue;
    b.cylinder(x, 0, z, 0.5, 0.3, h * 0.55, C.trunk, { seg: 10 });
    for (let t = 0; t < 8; t++) {
      const y0 = h * (0.18 + t * 0.105), w = 3.0 - t * 0.32;
      b.frustum(x, y0, z, y0 + h * 0.16, w, w, w * 0.25, w * 0.25, C.leaf);
    }
  }
}
