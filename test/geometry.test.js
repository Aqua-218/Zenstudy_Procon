import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, STRIDE } from '../js/geometry.js';
import { M } from '../js/math.js';

// 頂点配列を { p, n, c, e, s } の列にほどく
function verts(b) {
  const out = [];
  for (let i = 0; i < b.data.length; i += STRIDE) {
    const d = b.data.slice(i, i + STRIDE);
    out.push({ p: d.slice(0, 3), n: d.slice(3, 6), c: d.slice(6, 9), e: d[9], s: d[10] });
  }
  return out;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(...a);

test('box: 36 頂点、法線は単位長で外向き', () => {
  const b = new MeshBuilder();
  b.box(1, 2, 3, 2, 4, 6, [1, 0, 0]);
  const v = verts(b);
  assert.equal(v.length, 36);
  for (const { p, n } of v) {
    assert.ok(Math.abs(len(n) - 1) < 1e-6);
    // 中心から頂点へのベクトルと法線が同じ側
    assert.ok(dot(n, [p[0] - 1, p[1] - 2, p[2] - 3]) > 0);
  }
});

test('box: 回転しても法線は外向きのまま', () => {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 1, 3, 1, [1, 1, 1], { mat: M.rx(0.5) });
  for (const { p, n } of verts(b)) assert.ok(dot(n, p) > 0);
});

test('frustum: 側面の法線は上を向く成分を持つ (すぼまっているので)', () => {
  const b = new MeshBuilder();
  b.frustum(0, 0, 0, 1, 1, 1, 0.5, 0.5, [1, 1, 1]);
  const sides = verts(b).filter(v => Math.abs(v.n[1]) < 0.99);
  assert.ok(sides.length > 0);
  for (const { p, n } of sides) {
    assert.ok(n[1] > 0);
    assert.ok(dot(n, [p[0], 0, p[2]]) > 0);
  }
});

test('cylinder: 側面の法線は軸から外向き、蓋は上下', () => {
  const b = new MeshBuilder();
  b.cylinder(0, 0, 0, 1, 1, 2, [1, 1, 1], { seg: 12 });
  const v = verts(b);
  assert.equal(v.length, 12 * 6 + 12 * 3 * 2);
  for (const { p, n } of v) {
    if (Math.abs(n[1]) > 0.99) continue;
    assert.ok(Math.abs(n[1]) < 1e-6);
    assert.ok(dot(n, [p[0], 0, p[2]]) > 0);
  }
  const caps = v.filter(x => Math.abs(x.n[1]) > 0.99);
  assert.ok(caps.some(x => x.n[1] > 0 && x.p[1] > 1.9));
  assert.ok(caps.some(x => x.n[1] < 0 && x.p[1] < 0.1));
});

test('roof: 上面の法線は上向きで、軒先は棟より低く外側に張り出す', () => {
  const b = new MeshBuilder();
  b.roof({ ridgeY: 8, ridgeZ: 0, halfX: 5, front: 6, back: 4, col: [1, 1, 1], under: [0, 0, 0] });
  const v = verts(b);
  const top = v.filter(x => x.c[0] === 1 && x.n[1] > 0.3);
  assert.ok(top.length > 0);
  const ys = v.map(x => x.p[1]);
  assert.ok(Math.max(...ys) <= 8 + 1e-9);
  assert.ok(Math.min(...ys) < 8 - 2);
  assert.ok(Math.max(...v.map(x => Math.abs(x.p[0]))) > 5);
});

test('hipRoof: 四方の軒がすべて eaveY まで下りる', () => {
  const b = new MeshBuilder();
  b.hipRoof({ ridgeY: 9, eaveY: 5, ridgeHalfX: 3, eaveHalfX: 7, eaveHalfZ: 5, col: [1, 1, 1], under: [0, 0, 0] });
  const v = verts(b);
  const eave = v.filter(x => Math.abs(x.p[1] - 5) < 1e-6);
  assert.ok(eave.some(x => x.p[2] > 4.9));
  assert.ok(eave.some(x => x.p[2] < -4.9));
  assert.ok(eave.some(x => x.p[0] > 6.9));
  assert.ok(eave.some(x => x.p[0] < -6.9));
});

test('karaHafu: 中央が両端より高い', () => {
  const b = new MeshBuilder();
  b.karaHafu({ y: 5, z0: 0, z1: 1, drop: 0.5, halfX: 3, amp: 1, col: [1, 1, 1] });
  const v = verts(b);
  const yAt = x => Math.max(...v.filter(p => Math.abs(p.p[0] - x) < 0.2 && p.p[2] === 0).map(p => p.p[1]));
  assert.ok(yAt(0) > yAt(2.8));
});

test('sway / emissive は頂点にそのまま乗る', () => {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 1, 1, 1, [1, 1, 1], { sway: 3, em: 0.5 });
  for (const v of verts(b)) { assert.equal(v.s, 3); assert.equal(v.e, 0.5); }
});
