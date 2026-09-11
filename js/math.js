// 最小限の線形代数。行列は WebGL に合わせて列優先 (column-major) の長さ16配列。

export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

export const M = {
  id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],

  // a * b
  mul: (a, b) => {
    const o = new Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
    }
    return o;
  },

  tr: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  sc: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
  rx: a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  ry: a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rz: a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },

  // 点の変換 (w=1)
  pt: (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ],
  // 方向ベクトルの変換 (w=0)
  dir: (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ],

  persp: (fov, asp, n, f) => {
    const t = 1 / Math.tan(fov / 2), r = 1 / (n - f);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0];
  },

  ortho: (l, r, b, t, n, f) => [
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ],

  lookAt: (e, t, u) => {
    const z = v3.norm(v3.sub(e, t)), x = v3.norm(v3.cross(u, z)), y = v3.cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -v3.dot(x, e), -v3.dot(y, e), -v3.dot(z, e), 1];
  },
};

// 左から順に掛ける: chain(T, R, S) = T * R * S
export const chain = (...ms) => ms.reduce((a, b) => M.mul(a, b));

// 決定的な乱数 (xorshift32)。シーンの再現性のため Math.random は使わない。整数演算だけなので速い
export function makeRng(seed = 7) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const clamp01 = v => Math.min(1, Math.max(0, v));

// 伸びる Float32Array。大量の頂点を push するより速い
export class FloatList {
  constructor(cap = 1 << 16) { this.a = new Float32Array(cap); this.n = 0; }
  push(...v) {
    if (this.n + v.length > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length)); b.set(this.a); this.a = b; }
    for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i];
  }
  // 直接書く用。k 個分の空きを保証して現在位置を返す
  reserve(k) {
    if (this.n + k > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; }
    const i = this.n; this.n += k; return i;
  }
  get length() { return this.n; }
  slice(s, e) { return Array.from(this.a.subarray(s, e)); }
  every(f) { for (let i = 0; i < this.n; i++) if (!f(this.a[i], i)) return false; return true; }
  [Symbol.iterator]() { return this.a.subarray(0, this.n)[Symbol.iterator](); }
  toArray() { return this.a.slice(0, this.n); }
}
