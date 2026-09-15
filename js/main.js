// エントリ。

import { buildScene, LAYOUT } from './shrine.js';
import { Renderer } from './renderer.js';
import { clamp01 } from './math.js';
import { ringBell, drum, startAmbient, hushAmbient, footstep, clap, ladle } from './audio.js';
import { SPOTS, HONDEN, REVEAL, AFTER } from './content.js';
import { Scroll } from './scroll.js';
import { Board } from './board.js';
import { Omens } from './omen.js';

const $ = id => document.getElementById(id);
const canvas = $('c');
const ui = {
  start: $('start'), startBtn: $('startBtn'), prompt: $('prompt'), open: $('open'), ring: $('ring'),
  spotName: $('spotName'), progress: $('progress'), stick: $('stick'), knob: $('knob'), fallback: $('fallback'), clap: $('clapBtn'), purify: $('purifyBtn'),
};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;

// 端末に応じた品質。スマホは作る量から減らし、重いパスを省き、フレームも抑える。
// 発熱はフレームを抑えるのが一番効く
const mobile = touch || Math.min(innerWidth, innerHeight) < 760;
const QUALITY = mobile
  ? { density: 0.45, ssao: false, wideBloom: false, shadow: 1024, refl: 384, lod: 16, fps: 40, idleFps: 24, dpr: 1.1 }
  : { density: 1, ssao: true, wideBloom: true, shadow: 4096, refl: 768, lod: 22, fps: 0, idleFps: 30, dpr: 1.5 };
// ?debug で巻物を読まなくても本殿が開く (動作確認用)
const debug = new URLSearchParams(location.search).has('debug');

// 境内の生成 (数百ms) は Worker で行い、開始画面の操作を止めない。Worker が使えなければその場で作る
let scene = null, renderer = null, omens = null;
function ready(sc) {
  scene = sc;
  try {
    renderer = new Renderer(canvas, scene, {
      dpr: Math.min(devicePixelRatio || 1, QUALITY.dpr),
      quality: QUALITY,
      hinge: [LAYOUT.honden.hingeX, LAYOUT.honden.doorZ],
      drip: [LAYOUT.chozuya.x, 1.12, LAYOUT.chozuya.z - 0.05],
    });
  } catch (e) {
    ui.fallback.hidden = false;
    throw e;
  }
  omens = new Omens(scene, player);
  ui.startBtn.disabled = false;
  requestAnimationFrame(frame);
}
ui.startBtn.disabled = true;
{
  let done = false;
  const inline = why => { if (done) return; done = true; if (why) console.warn('build-worker:', why); ready(buildScene(7, QUALITY.density)); };   // noise は Renderer 側で作られる
  try {
    const w = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => { if (!done) { done = true; ready(e.data); } w.terminate(); };
    w.onerror = e => { w.terminate(); inline(e.message || 'error'); };
    w.onmessageerror = () => { w.terminate(); inline('messageerror'); };
    w.postMessage({ seed: 7, density: QUALITY.density });
    setTimeout(() => { if (!done) { w.terminate(); inline('timeout'); } }, 6000);
  } catch (e) {
    inline(e);
  }
}
addEventListener('resize', () => renderer && renderer.resize());

// ---------- 状態 ----------
const player = { x: 1.3, z: 47, yaw: 0, pitch: 0.02 };
const keys = new Set();
let started = false, swing = 0, open = 0, openTarget = 0, revealed = false, hush = 0;
const read = new Set();
const scroll = new Scroll($('scroll'));
const board = new Board($('fuda'));          // 境内の立て札。本殿だけ巻物を使う
const reading = () => scroll.isOpen || board.isOpen;

// ---------- 入力 ----------
addEventListener('keydown', e => {
  if (!started) return;
  keys.add(e.code);
  if (reading()) { if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Enter') { scroll.close(); board.close(); } return; }
  if (e.code === 'KeyE' || e.code === 'Enter') openNearest();
  if (e.code === 'KeyR') ring();
  if (e.code === 'KeyF') doClap();
  if (e.code === 'KeyQ') purify();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ポインタ: 左側は移動スティック (タッチ時)、それ以外はドラッグで視点
const look = { id: null, x: 0, y: 0 };
const stick = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
// PC: クリックでマウスを取り込み (Pointer Lock)、以降はマウスを動かすだけで視線が変わる。Esc で解除
const locked = () => document.pointerLockElement === canvas;
document.addEventListener('mousemove', e => {
  if (!locked() || reading()) return;
  const k = 0.0022;
  player.yaw += e.movementX * k;
  player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - e.movementY * k));
});
canvas.addEventListener('pointerdown', e => {
  if (!started || reading()) return;
  if (!touch && !locked() && canvas.requestPointerLock) { canvas.requestPointerLock(); return; }
  if (locked()) return;
  canvas.setPointerCapture(e.pointerId);
  if (touch && e.clientX < innerWidth * 0.45 && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.dx = stick.dy = 0;
    ui.stick.style.left = `${e.clientX}px`; ui.stick.style.top = `${e.clientY}px`;
    ui.stick.classList.add('on');
  } else if (look.id === null) {
    look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
  }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === look.id) {
    const k = touch ? 0.0045 : 0.0032;
    player.yaw += (e.clientX - look.x) * k;
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - (e.clientY - look.y) * k));
    look.x = e.clientX; look.y = e.clientY;
  } else if (e.pointerId === stick.id) {
    const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, l = Math.hypot(dx, dy), m = Math.min(l, 48);
    stick.dx = l ? dx / l * m / 48 : 0; stick.dy = l ? dy / l * m / 48 : 0;
    ui.knob.style.transform = `translate(${dx / (l || 1) * m}px, ${dy / (l || 1) * m}px)`;
  }
});
const release = e => {
  if (e.pointerId === look.id) look.id = null;
  if (e.pointerId === stick.id) { stick.id = null; stick.dx = stick.dy = 0; ui.stick.classList.remove('on'); ui.knob.style.transform = ''; }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

ui.startBtn.addEventListener('click', () => {
  started = true;
  ui.start.classList.add('gone');
  drum(0.001);   // AudioContext をユーザー操作の中で起こしておく
  startAmbient();
});
ui.open.addEventListener('click', openNearest);
ui.ring.addEventListener('click', ring);
ui.clap.addEventListener('click', doClap);
ui.purify.addEventListener('click', purify);

// ---------- 巻物 ----------
function nearestSpot() {
  let best = null, bd = Infinity;
  for (const s of [...SPOTS, HONDEN]) {
    const d = Math.hypot(player.x - s.pos[0], player.z - s.pos[1]);
    if (d < s.r && d < bd) { best = s; bd = d; }
  }
  return best;
}

function openNearest() {
  if (!started || reading()) return;
  const s = nearestSpot();
  if (!s) return;
  if (s.id === 'honden') {
    if (locked()) document.exitPointerLock();
    if (read.size < SPOTS.length && !debug) { scroll.show(s.name, [s.locked]); return; }
    scroll.show(s.name, s.body, () => { if (!revealed) reveal(); });
    return;
  }
  const already = read.has(s.id);
  read.add(s.id);
  updateProgress();
  if (omens) omens.onRead(s.id, read.size);
  if (locked()) document.exitPointerLock();
  // 六つ読み終えたあとに読み直すと、末尾に一文だけ増える
  const body = (already && read.size >= SPOTS.length && AFTER[s.id]) ? [...s.body, AFTER[s.id]] : s.body;
  board.show(s.name, body);
}

function updateProgress() {
  ui.progress.textContent = `立て札 ${read.size} / ${SPOTS.length}`;
  ui.progress.classList.toggle('done', read.size >= SPOTS.length);
}

function reveal() {
  revealed = true;
  // 環境音を止めてから扉を開ける
  hushAmbient(3.4, 0.5);
  hush = 1;
  if (omens) omens.onReveal();
  setTimeout(() => { openTarget = 1; drum(1); }, 1500);
  setTimeout(() => drum(0.7), 2400);
  setTimeout(() => { ringBell(); }, 4100);
  setTimeout(() => scroll.show(REVEAL.name, REVEAL.body), 5100);
}

// 手水
function purify() {
  if (!started || reading()) return;
  const s = nearestSpot();
  if (!s || s.id !== 'chozuya' || (omens && omens.purified)) return;
  ladle();
  if (omens) omens.purified = true;
  ui.purify.hidden = true;
}

// 拍手
function doClap() {
  if (!started || reading()) return;
  const s = nearestSpot();
  if (!s || s.id !== 'haiden') return;
  clap(1);
  claps++;
  if (claps === 2 && omens && !omens.thirdClap) {
    omens.thirdClap = true;
    setTimeout(() => clap(0.85, true), 620 + Math.random() * 120);   // 自分のではない三つ目
  }
  clearTimeout(clapReset);
  clapReset = setTimeout(() => { claps = 0; }, 2500);
}
let claps = 0, clapReset = null;

function ring() {
  if (!started || reading()) return;
  const s = nearestSpot();
  if (!s || s.id !== 'haiden') return;
  ringBell();
  swing = 1;
  if (omens) omens.onRingBell();
}

// ---------- 床の高さ ----------
// 拝殿・渡殿・本殿は高床。階段の範囲は線形に上がる。それ以外は地面
function floorY(x, z) {
  const H = LAYOUT.haiden, K = LAYOUT.corridor, N = LAYOUT.honden;
  const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  if (Math.abs(x) <= H.halfX + 0.6 && z >= H.z - H.halfZ - 0.6 && z <= H.z + H.halfZ + 0.6) return H.floor;
  if (Math.abs(x) <= 2.3 && z > H.z + H.halfZ + 0.6 && z <= H.z + H.halfZ + 3.4) return lerp(H.floor, 0.5, (z - (H.z + H.halfZ + 0.6)) / 2.6);
  if (Math.abs(x) <= K.halfX + 0.9 && z >= K.z0 && z < K.z1) {
    const zs = K.z0 + 2.4;
    if (z >= zs + 1.2) return H.floor;
    if (z >= zs) return lerp(N.floor, H.floor, (z - zs) / 1.2);
    return N.floor;
  }
  if (Math.abs(x) <= N.halfX + 0.8 && z >= N.z - N.halfZ - 0.8 && z <= N.z + N.halfZ + 0.8) return N.floor;
  if (Math.abs(x) <= K.halfX + 0.9 && z >= N.z + N.halfZ + 0.8 && z < K.z0) return N.floor;
  return 0;
}

// ---------- 移動と当たり ----------
const B = LAYOUT.bounds;
function blocked(x, z) {
  if (Math.abs(x) > B.x || z < B.zMin || z > B.zMax) return true;
  // 高床の縁からは落ちない (段差が 0.6 以上なら通れない)
  if (Math.abs(floorY(x, z) - floorY(player.x, player.z)) > 0.6) return true;
  // 本殿の扉: 開くまでは通れない
  if (!revealed && z < LAYOUT.honden.doorZ + 1.2 && Math.abs(x) < LAYOUT.honden.hingeX + 0.2) return true;
  for (const k of scene.blockers) {
    if (k.r !== undefined) { if (Math.hypot(x - k.cx, z - k.cz) < k.r + 0.35) return true; continue; }
    if (x > k.x0 - 0.3 && x < k.x1 + 0.3 && z > k.z0 - 0.3 && z < k.z1 + 0.3) {
      if (k.gateX !== undefined && Math.abs(x) < k.gateX) continue;
      return true;
    }
  }
  return false;
}

function move(dt) {
  let f = 0, r = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
  f -= stick.dy; r += stick.dx;
  const l = Math.hypot(f, r);
  if (l > 1) { f /= l; r /= l; }
  if (l < 0.01) return 0;
  const speed = (keys.has('ShiftLeft') ? 5.5 : 3.4) * (debug ? 10.0 : 1) * dt;
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const dx = (sy * f + cy * r) * speed, dz = (-cy * f + sy * r) * speed;
  if (!blocked(player.x + dx, player.z)) player.x += dx;
  if (!blocked(player.x, player.z + dz)) player.z += dz;
  return Math.min(l, 1);
}

// ---------- 足音 ----------
// 歩いた距離が一歩ぶん溜まるたびに鳴らす。踏んでいる面を位置から判定する
function surfaceAt(x, z) {
  if (floorY(x, z) > 0.5) return 'wood';                                   // 拝殿・渡殿・本殿の床
  if (Math.abs(x) < 2.72 && z > -14 && z < 62) return 'stone';             // 参道の石畳
  const H = LAYOUT.haiden, N = LAYOUT.honden;
  if (Math.abs(x) <= H.halfX + 3 && Math.abs(z - H.z) <= H.halfZ + 4) return 'stone';   // 拝殿の基壇
  if (Math.abs(x) <= N.halfX + 3 && Math.abs(z - N.z) <= N.halfZ + 3) return 'stone';   // 本殿の基壇
  if (Math.abs(x) < 18 && z > -40 && z < 50) return 'gravel';              // 境内は玉砂利
  return 'earth';
}
let stepPhase = 0;

// ---------- ループ ----------
let last = performance.now(), walk = 0, eyeY = 1.62, frameNo = 0;
// 描画の間隔。何も起きていないときは落として端末を休ませる。
// 状態の更新は毎フレーム走るので、操作の反応は鈍らない
let lastDraw = 0, idleSince = performance.now();
const touched = () => { idleSince = performance.now(); };
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) addEventListener(ev, touched, { passive: true });
function frame(now) {
  const dtReal = (now - last) / 1000, dt = Math.min(0.05, dtReal); last = now;
  const t = now / 1000;

  hush *= Math.exp(-dtReal * 0.35);
  const moving = (started && !reading()) ? move(dt) : 0;
  walk += moving * dt * 7;
  // 足音は頭の上下 (bob) と合わせる。半周期ごとに片足が着く
  const ph = Math.floor(walk / Math.PI);
  const surface = surfaceAt(player.x, player.z);
  const stepped = started && !reading() && moving > 0.05 && ph !== stepPhase;
  if (stepped) footstep(surface, 0.85 + moving * 0.3);
  stepPhase = ph;
  if (started && omens) { omens.eyeY = eyeY; omens.update(dt, reading() ? 0 : moving, surface); }
  swing *= Math.exp(-dtReal * 1.1);
  if (omens && omens.ropeSwing > swing) swing = omens.ropeSwing;   // 帰り道、鈴緒がまだ揺れている
  open += (openTarget - open) * (1 - Math.exp(-dtReal * 0.9));

  const bob = reduce ? 0 : Math.sin(walk) * 0.035 * moving;
  eyeY += (floorY(player.x, player.z) + 1.62 - eyeY) * (1 - Math.exp(-dtReal * 12));
  const eye = [player.x, eyeY + bob, player.z];
  if (moving > 0.01) idleSince = now;
  // 目標の間隔を決める。読んでいる間は背景、動きが無いときも落とす
  const idle = now - idleSince > 2500;
  const fps = reading() ? 20 : idle ? QUALITY.idleFps : QUALITY.fps;
  const minMs = fps ? 1000 / fps - 1.5 : 0;
  if (now - lastDraw >= minMs) {
    lastDraw = now;
    renderer.render({ eye, yaw: player.yaw, pitch: player.pitch, t, swing, open, hush, omen: omens && omens.uniforms(), petals: !reduce });
    // 休ませている間の間隔で解像度を判断しない
    if (!idle && !reading()) renderer.adapt(QUALITY.fps ? 1000 / QUALITY.fps : 16.7);
    else renderer.lastAdaptAt = 0;
  }

  if (started && !reading()) {
    const s = nearestSpot();
    ui.prompt.classList.toggle('show', !!s);
    if (s) {
      ui.spotName.textContent = s.name;
      ui.ring.hidden = s.id !== 'haiden';
      ui.clap.hidden = s.id !== 'haiden';
      ui.purify.hidden = s.id !== 'chozuya' || (omens && omens.purified);
      ui.open.textContent = s.id === 'honden'
        ? (read.size < SPOTS.length && !debug ? '扉に触れる' : '巻物を開く')
        : (read.has(s.id) ? 'もう一度読む' : '立て札を読む');
    }
  } else {
    ui.prompt.classList.remove('show');
  }
  requestAnimationFrame(frame);
}
updateProgress();

// 動作確認用 (テストからカメラを動かす)
window.__yomairi = { player, read, SPOTS, scroll, omens: () => omens, mirrorOn: () => renderer && renderer.mirrorOn, open: () => open,
  ui: () => {
    const f = document.querySelector('.fuda-frame').getBoundingClientRect();
    return { 枠の中心: (f.left + f.right) / 2, 画面の中心: innerWidth / 2, ずれ: ((f.left + f.right) / 2 - innerWidth / 2).toFixed(1) };
  },
  mirror: () => omens && { 閉じ具合: omens.mirror.toFixed(2), 直視: !!omens.lookingMirror, ずれ角: (omens.lookAngle * 180 / Math.PI).toFixed(1) + '°', 反射中: renderer.mirrorOn }, force: () => { for (const s of SPOTS) read.add(s.id); updateProgress(); }, reveal, jump: () => { open = openTarget = 1; revealed = true; } };
