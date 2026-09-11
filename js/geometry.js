// ジオメトリ生成。すべて三角形リストとして1本の Float32Array に積む。
// 頂点レイアウト: pos(3) normal(3) color(3) emissive(1) sway(1)
//   sway: 0 = 静止, 1 = 風で揺れる (紙垂), 2 = 鈴緒 (鳴らすと振れる)

import { v3, M, chain, FloatList } from './math.js';

export const STRIDE = 11;

// 六面体の面定義。頂点インデックスは bit で x=1, y=2, z=4。最後は外向き法線の目安
const FACES = [
  [1, 3, 7, 5, [1, 0, 0]], [0, 4, 6, 2, [-1, 0, 0]], [2, 6, 7, 3, [0, 1, 0]],
  [0, 1, 5, 4, [0, -1, 0]], [4, 5, 7, 6, [0, 0, 1]], [0, 2, 3, 1, [0, 0, -1]],
];

export class MeshBuilder {
  constructor() { this.data = new FloatList(1 << 20); }

  get vertexCount() { return this.data.length / STRIDE; }

  tri(p0, p1, p2, col, em = 0, sw = 0) {
    const n = v3.norm(v3.cross(v3.sub(p1, p0), v3.sub(p2, p0)));
    this.vert(p0, n, col, em, sw); this.vert(p1, n, col, em, sw); this.vert(p2, n, col, em, sw);
  }

  vert(p, n, col, em, sw) {
    const i = this.data.reserve(STRIDE), a = this.data.a;   // reserve が配列を伸ばすことがあるので、参照はその後で取る
    a[i] = p[0]; a[i + 1] = p[1]; a[i + 2] = p[2]; a[i + 3] = n[0]; a[i + 4] = n[1]; a[i + 5] = n[2];
    a[i + 6] = col[0]; a[i + 7] = col[1]; a[i + 8] = col[2]; a[i + 9] = em; a[i + 10] = sw;
  }

  // 頂点ごとに法線を指定する三角形 (曲面をなめらかに見せる)
  triN(p, n, col, em = 0, sw = 0) {
    for (let i = 0; i < 3; i++) this.vert(p[i], n[i], col, em, sw);
  }

  // 法線が want 側を向くように巻き順を自動で直す四角形
  quad(p0, p1, p2, p3, col, want, em = 0, sw = 0) {
    const n = v3.cross(v3.sub(p1, p0), v3.sub(p2, p0));
    if (v3.dot(n, want) < 0) [p1, p3] = [p3, p1];
    this.tri(p0, p1, p2, col, em, sw);
    this.tri(p0, p2, p3, col, em, sw);
  }

  // 8頂点の六面体。mat で回転などを掛けられる
  hexa(c, col, em = 0, sw = 0, mat = null) {
    const cc = mat ? c.map(p => M.pt(mat, p)) : c;
    for (const f of FACES) {
      const w = mat ? M.dir(mat, f[4]) : f[4];
      this.quad(cc[f[0]], cc[f[1]], cc[f[2]], cc[f[3]], col, w, em, sw);
    }
  }

  // 中心 (cx,cy,cz)、寸法 (w,h,d) の箱
  box(cx, cy, cz, w, h, d, col, opt = {}) {
    const c = [];
    for (let i = 0; i < 8; i++) {
      c.push([(i & 1 ? w : -w) / 2, (i & 2 ? h : -h) / 2, (i & 4 ? d : -d) / 2]);
    }
    this.hexa(c, col, opt.em || 0, opt.sway || 0, chain(M.tr(cx, cy, cz), opt.mat || M.id()));
  }

  // 底面 (hw0,hd0) から上面 (hw1,hd1) へすぼまる台
  frustum(cx, y0, cz, y1, hw0, hd0, hw1, hd1, col, em = 0) {
    const c = [];
    for (let i = 0; i < 8; i++) {
      const top = !!(i & 2), hw = top ? hw1 : hw0, hd = top ? hd1 : hd0;
      c.push([cx + (i & 1 ? hw : -hw), top ? y1 : y0, cz + (i & 4 ? hd : -hd)]);
    }
    this.hexa(c, col, em);
  }

  // y 軸方向の円柱 (r0: 底, r1: 上)。mat で向きを変える。側面は法線を頂点ごとに持ってなめらかに
  cylinder(cx, cy, cz, r0, r1, h, col, opt = {}) {
    const seg = opt.seg || 32, sw = opt.sway || 0, em = opt.em || 0;
    const m = chain(M.tr(cx, cy, cz), opt.mat || M.id());
    const ring = (r, y) => {
      const a = [];
      for (let i = 0; i < seg; i++) {
        const t = i / seg * Math.PI * 2;
        a.push(M.pt(m, [Math.cos(t) * r, y, Math.sin(t) * r]));
      }
      return a;
    };
    // 側面の法線: 円周方向 + すぼまりの分だけ軸方向へ傾ける
    const slope = (r0 - r1) / (h || 1);
    const nrm = i => { const t = i / seg * Math.PI * 2; return v3.norm(M.dir(m, [Math.cos(t), slope, Math.sin(t)])); };
    const b = ring(r0, 0), t = ring(r1, h), cb = M.pt(m, [0, 0, 0]), ct = M.pt(m, [0, h, 0]);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg, ni = nrm(i), nj = nrm(j);
      this.triN([b[i], b[j], t[j]], [ni, nj, nj], col, em, sw);
      this.triN([b[i], t[j], t[i]], [ni, nj, ni], col, em, sw);
      if (r1 > 0) this.tri(t[j], t[i], ct, col, em, sw);
      if (r0 > 0) this.tri(b[i], b[j], cb, col, em, sw);
    }
  }

  // 流造の屋根。棟 (ridge) から前後へ、反り (そり) を付けて流す
  roof({ cx = 0, ridgeY, ridgeZ, halfX, front, back, slope = 0.62, thick = 0.3, flare = 0.6, col, under, N = 12 }) {
    for (const [dir, len] of [[1, front], [-1, back]]) {
      const P = (t, side, off) => {
        const sag = 1 - Math.pow(1 - t, 1.55);
        return [cx + side * (halfX + flare * t), ridgeY - slope * len * sag - off, ridgeZ + dir * len * t];
      };
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        this.quad(P(t0, -1, 0), P(t0, 1, 0), P(t1, 1, 0), P(t1, -1, 0), col, [0, 1, 0]);
        this.quad(P(t0, -1, thick), P(t0, 1, thick), P(t1, 1, thick), P(t1, -1, thick), under, [0, -1, 0]);
        for (const s of [-1, 1]) {
          this.quad(P(t0, s, 0), P(t1, s, 0), P(t1, s, thick), P(t0, s, thick), col, [s, 0, 0]);
        }
      }
      this.quad(P(1, -1, 0), P(1, 1, 0), P(1, 1, thick), P(1, -1, thick), col, [0, 0, dir]);
    }
  }

  // 寄棟 (入母屋の下半分にも使う)。棟 (短い) から四方の軒へ、反りを付けて下ろす
  hipRoof({ cx = 0, cz = 0, ridgeY, eaveY, ridgeHalfX, eaveHalfX, eaveHalfZ, thick = 0.3, col, under, N = 10 }) {
    const sag = t => 1 - Math.pow(1 - t, 1.5);
    const Y = (t, off) => ridgeY - (ridgeY - eaveY) * sag(t) - off;
    const lerp = (a, b, t) => a + (b - a) * t;
    // 前後の台形面
    for (const dir of [-1, 1]) {
      const P = (t, side, off) => [cx + side * lerp(ridgeHalfX, eaveHalfX, t), Y(t, off), cz + dir * t * eaveHalfZ];
      this.slopeStrip(P, N, col, under, thick, [0, 0, dir]);
    }
    // 左右の三角面
    for (const side of [-1, 1]) {
      const P = (t, s, off) => [cx + side * lerp(ridgeHalfX, eaveHalfX, t), Y(t, off), cz + s * t * eaveHalfZ];
      this.slopeStrip(P, N, col, under, thick, [side, 0, 0]);
    }
  }

  // 屋根面1枚: P(t, side, off) で位置を返す関数から、板厚つきの帯を作る
  slopeStrip(P, N, col, under, thick, eaveDir) {
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      this.quad(P(t0, -1, 0), P(t0, 1, 0), P(t1, 1, 0), P(t1, -1, 0), col, [0, 1, 0]);
      this.quad(P(t0, -1, thick), P(t0, 1, thick), P(t1, 1, thick), P(t1, -1, thick), under, [0, -1, 0]);
    }
    this.quad(P(1, -1, 0), P(1, 1, 0), P(1, 1, thick), P(1, -1, thick), col, eaveDir);
  }

  // 唐破風。中央が持ち上がり、両端がなだらかに下がる曲線の庇
  karaHafu({ cx = 0, y, z0, z1, drop, halfX, amp, thick = 0.22, col, under, N = 16 }) {
    const f = x => y + amp * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * x / halfX), 1.4) + amp * 0.18 * Math.pow(Math.abs(x) / halfX, 6);
    for (let i = 0; i < N; i++) {
      const x0 = -halfX + 2 * halfX * i / N, x1 = -halfX + 2 * halfX * (i + 1) / N;
      const y0 = f(x0), y1 = f(x1);
      const c = [
        [x0, y0 - thick, z0], [x1, y1 - thick, z0], [x0, y0, z0], [x1, y1, z0],
        [x0, y0 - thick - drop, z1], [x1, y1 - thick - drop, z1], [x0, y0 - drop, z1], [x1, y1 - drop, z1],
      ].map(p => [p[0] + cx, p[1], p[2]]);
      this.hexa(c, col);
    }
    void under;
  }

  build() { return this.data.toArray(); }
}
