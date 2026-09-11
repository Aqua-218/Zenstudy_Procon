import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene, LAYOUT } from '../js/shrine.js';
import { STRIDE } from '../js/geometry.js';
import { SPOTS, HONDEN, REVEAL } from '../js/content.js';

const scene = buildScene(7);

test('シーンは同じシードなら同じバイト列になる', () => {
  const other = buildScene(7);
  assert.equal(scene.vertices.length, other.vertices.length);
  assert.ok(scene.vertices.every((v, i) => v === other.vertices[i]));
  assert.notEqual(buildScene(8).vertices.length, 0);
});

test('頂点配列は STRIDE の倍数で、全部有限', () => {
  assert.equal(scene.vertices.length % STRIDE, 0);
  for (const v of scene.vertices) assert.ok(Number.isFinite(v));
  assert.equal(scene.blossoms.length % 11, 0);
  assert.equal(scene.petals.length % 11, 0);
});

test('灯りは 8 個以上あり、本殿の中の灯りがある', () => {
  assert.ok(scene.lights.length >= 8);
  assert.ok(scene.lights.filter(l => l.interior).length >= 1);
  for (const l of scene.lights) {
    assert.equal(l.pos.length, 3);
    assert.equal(l.col.length, 3);
    assert.ok(l.k > 0);
  }
});

test('本殿の扉は左右 (sway 3 と 4) が両方ある', () => {
  const sways = new Set();
  for (let i = STRIDE - 1; i < scene.vertices.length; i += STRIDE) sways.add(scene.vertices[i]);
  assert.ok(sways.has(3) && sways.has(4));
  assert.ok(sways.has(1) && sways.has(2));
});

test('巻物の位置は歩ける範囲にあって、id が重複しない', () => {
  const B = LAYOUT.bounds;
  const ids = new Set();
  for (const s of [...SPOTS, HONDEN]) {
    assert.ok(!ids.has(s.id)); ids.add(s.id);
    assert.ok(Math.abs(s.pos[0]) <= B.x);
    assert.ok(s.pos[1] >= B.zMin && s.pos[1] <= B.zMax);
    assert.ok(s.r > 0);
    assert.ok(s.body.every(t => typeof t === 'string' && t.length > 0));
  }
  assert.ok(REVEAL.body.length >= 3);
  assert.equal(SPOTS.length, 6);
});

test('玉垣の正面には渡殿の幅の通り口がある', () => {
  const gate = scene.blockers.find(k => k.gateX !== undefined);
  assert.ok(gate);
  assert.ok(gate.gateX >= LAYOUT.corridor.halfX);
});
