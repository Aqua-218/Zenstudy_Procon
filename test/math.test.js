import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3, M, chain, makeRng, clamp01 } from '../js/math.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearV = (a, b, eps = 1e-9) => a.every((x, i) => near(x, b[i], eps));

test('mul: 単位行列は無変化、平行移動は加算', () => {
  const T = M.tr(1, 2, 3);
  assert.deepEqual(M.mul(M.id(), T), T);
  assert.ok(nearV(M.pt(M.mul(T, M.tr(1, 1, 1)), [0, 0, 0]), [2, 3, 4]));
});

test('回転行列は長さを保ち、90度回転が期待通り', () => {
  const p = [1, 0, 0];
  assert.ok(nearV(M.pt(M.ry(Math.PI / 2), p), [0, 0, -1]));
  assert.ok(nearV(M.pt(M.rz(Math.PI / 2), p), [0, 1, 0]));
  assert.ok(nearV(M.pt(M.rx(Math.PI / 2), [0, 1, 0]), [0, 0, 1]));
  for (const m of [M.rx(0.7), M.ry(1.3), M.rz(2.1)]) assert.ok(near(v3.len(M.pt(m, [3, 4, 12])), 13));
});

test('chain は左から順に掛かる (T*R*S)', () => {
  const m = chain(M.tr(10, 0, 0), M.rz(Math.PI / 2), M.sc(2, 2, 2));
  assert.ok(nearV(M.pt(m, [1, 0, 0]), [10, 2, 0]));
});

test('dir は平行移動の影響を受けない', () => {
  assert.ok(nearV(M.dir(M.tr(5, 5, 5), [0, 1, 0]), [0, 1, 0]));
});

test('lookAt: 視点は原点へ、注視点は -z へ写る', () => {
  const eye = [1, 2, 3], target = [4, 2, 3];
  const V = M.lookAt(eye, target, [0, 1, 0]);
  assert.ok(nearV(M.pt(V, eye), [0, 0, 0]));
  const t = M.pt(V, target);
  assert.ok(near(t[0], 0) && near(t[1], 0) && t[2] < 0);
});

test('ortho: ボックスの角が ±1 に写る', () => {
  const O = M.ortho(-2, 2, -3, 3, 1, 11);
  assert.ok(nearV(M.pt(O, [-2, -3, -1]), [-1, -1, -1]));
  assert.ok(nearV(M.pt(O, [2, 3, -11]), [1, 1, 1]));
});

test('persp: 近平面の中心は -1、遠平面は +1', () => {
  const P = M.persp(1.0, 1.5, 0.5, 100);
  const w = p => { const z = P[10] * p[2] + P[14], ww = -p[2]; return z / ww; };
  assert.ok(near(w([0, 0, -0.5]), -1));
  assert.ok(near(w([0, 0, -100]), 1));
});

test('makeRng: 決定的で [0,1) に収まる', () => {
  const a = makeRng(7), b = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('clamp01', () => {
  assert.equal(clamp01(-1), 0); assert.equal(clamp01(2), 1); assert.equal(clamp01(0.3), 0.3);
});
