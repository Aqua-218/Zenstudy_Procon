// 境内で起きる演出。灯り・音・向きの操作だけで、追加のオブジェクトは出さない。

import { LAYOUT } from './shrine.js';
import { footstep, coin, distantBell, doorThud, emaRattle } from './audio.js';

const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, to, dt, k) => v + (to - v) * (1 - Math.exp(-dt * k));

export class Omens {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.komainu = 0;      // 狛犬の向き (rad)
    this.prints = 0;       // 濡れた足跡
    this.effigy = 0;       // 藁人形が現れているか
    this.hishaku = 0;      // 柄杓が伏せているか
    this.nails = 1;        // 見えている釘の本数
    this.ema = 0;          // 絵馬の鳴り
    this.lanternAt = 8 + Math.random() * 12;
    this.seichu = false;   // 「正中」を読んだか
    this.seichuT = 0;
    this.purified = false; // 手水を使ったか
    this.revealed = false;
    this.darkWayBack = false;
    this.drift = 0;        // 視点が勝手に寄る量
    this.driftDone = false;
    this.saisenT = 0;
    this.emaT = 20 + Math.random() * 30;
    this.extraStep = 0;
    this.wasMoving = false;
    this.bellAnswered = false;
    this.mirror = 0;          // 鏡の中の扉の閉じ具合
    this.ropeSwing = 0;
    this.approachLights = scene.lights.filter(l => !l.interior && l.pos[2] > 8);
  }

  onRead(id, count) {
    if (id === 'seichu') this.seichu = true;
    if (count >= 3) this.effigy = 1;
    if (count >= 4) this.hishakuWanted = true;
  }

  onRingBell() {
    if (this.bellAnswered) return;
    this.bellAnswered = true;
    setTimeout(() => distantBell(), 1400 + Math.random() * 600);
  }

  onReveal() {
    this.revealed = true;
    if (!this.purified) this.prints = 0.001;
    setTimeout(() => { this.darkWayBack = true; }, 1000);
    setTimeout(() => doorThud(), 9000 + Math.random() * 4000);
  }

  // 見られていないか
  unobserved(pos, cos = 0.35) {
    const p = this.player;
    const dx = pos[0] - p.x, dz = pos[2] - p.z, d = Math.hypot(dx, dz);
    if (d > 26) return true;
    const f = [Math.sin(p.yaw), -Math.cos(p.yaw)];
    return (dx * f[0] + dz * f[1]) / d < cos;
  }

  update(dt, moving, surface) {
    const p = this.player;

    // --- 御鏡 ---
    if (this.revealed) {
      // 許容角は鏡の見かけの大きさに合わせる
      const MR = LAYOUT.mirror;
      const ey = this.eyeY === undefined ? p.y || 3.62 : this.eyeY;
      const vx = MR.x - p.x, vy = MR.y - ey, vz = MR.z - p.z;
      const d = Math.hypot(vx, vy, vz);
      const cp = Math.cos(p.pitch);
      const f = [Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
      const cosA = d > 0.01 ? (vx * f[0] + vy * f[1] + vz * f[2]) / d : 0;
      const allow = Math.atan(0.34 / Math.max(d, 0.5)) + 0.07;    // 鏡の見かけの半径 + 約 4 度
      this.lookAngle = Math.acos(Math.max(-1, Math.min(1, cosA)));
      this.lookingMirror = d < 7 && d > 0.4 && this.lookAngle < allow;
      this.mirror = Math.max(0, Math.min(1, this.mirror + (this.lookingMirror ? dt * 0.17 : -dt * 0.9)));
      // 内陣の灯明を一つ消す
      if (!this.lampOut && this.unobserved([0, 3, LAYOUT.honden.z + 1], 0.1)) {
        this.lampT = (this.lampT || 0) + dt;
        if (this.lampT > 4) {
          this.lampOut = true;
          const lamps = this.scene.lights.filter(l => l.interior);
          if (lamps.length) lamps[lamps.length - 1].gain = 0;
        }
      }
    }

    // --- 藁人形の釘 ---
    if (this.effigy > 0.5 && this.nails < 6) {
      if (this.unobserved([-9.4, 1.6, 32.5], 0.5)) {
        this.nailT = (this.nailT || 0) + dt;
        if (this.nailT > 9) { this.nailT = 0; this.nails++; }
      }
    }

    // --- 狛犬 ---
    if (!this.komainuDone && this.revealed === false) {
      const seen = !this.unobserved([4.6, 1.5, 12.0], 0.2) || !this.unobserved([-4.6, 1.5, 12.0], 0.2);
      if (!seen) {
        this.komaT = (this.komaT || 0) + dt;
        if (this.komaT > 6 && Math.hypot(p.x, p.z - 12) < 30) { this.komainu = -0.42; this.komainuDone = true; }
      }
    }

    // --- 柄杓 ---
    if (this.hishakuWanted && this.hishaku < 0.99) {
      if (Math.hypot(p.x - LAYOUT.chozuya.x, p.z - LAYOUT.chozuya.z) > 9) this.hishaku = 1;
    }

    // --- 絵馬 ---
    this.emaT -= dt;
    if (this.emaT < 0 && this.ema < 0.01) {
      this.emaT = 40 + Math.random() * 50;
      this.ema = 1;
      if (Math.hypot(p.x - LAYOUT.ema.x, p.z - LAYOUT.ema.z) < 14) emaRattle();
    }
    this.ema = approach(this.ema, 0, dt, 0.6);

    // --- 背後の灯籠が一度消えて戻る ---
    for (const l of this.scene.lights) {
      if (l.out === undefined) continue;
      l.out = Math.max(0, l.out - dt / 3.2);
      l.gain = l.out > 0.75 ? 1 - (l.out - 0.75) * 4 : (l.out > 0.2 ? 0 : 1 - l.out * 5);
      if (l.out <= 0) { l.gain = 1; delete l.out; }
    }
    this.lanternAt -= dt;
    if (this.lanternAt < 0) {
      this.lanternAt = 14 + Math.random() * 26;
      const f = [Math.sin(p.yaw), -Math.cos(p.yaw)];
      const cands = this.scene.lights.filter(l => {
        if (l.interior || l.out !== undefined || l.dark) return false;
        const dx = l.pos[0] - p.x, dz = l.pos[2] - p.z, d = Math.hypot(dx, dz);
        return d > 4 && d < 22 && (dx * f[0] + dz * f[1]) / d < -0.25;
      });
      if (cands.length) cands[(Math.random() * cands.length) | 0].out = 1;
    }

    // --- 正中の巻物を読んだあと、中央を歩くと前方の灯りが順に暗くなる ---
    if (this.seichu && !this.revealed) {
      const onCenter = Math.abs(p.x) < 0.55 && p.z > 8 && p.z < 40 && moving > 0.3;
      this.seichuT = onCenter ? this.seichuT + dt : 0;
      if (this.seichuT > 1.2) {
        const head = p.z + 26 - (this.seichuT - 1.2) * 13;
        for (const l of this.approachLights) {
          const d = Math.abs(l.pos[2] - head);
          l.gain = Math.min(l.gain === undefined ? 1 : l.gain, d < 2.6 ? 0.12 + d / 2.6 * 0.88 : 1);
        }
        if (head < p.z - 4) this.seichuT = 0;
      } else if (!this.darkWayBack) {
        for (const l of this.approachLights) if (l.out === undefined) l.gain = Math.min(1, (l.gain || 1) + dt * 1.5);
      }
    }

    // --- 本殿を出ると参道の灯りが落ちる ---
    if (this.darkWayBack) {
      for (const l of this.approachLights) { l.dark = true; l.gain = approach(l.gain === undefined ? 1 : l.gain, 0, dt, 0.7); }
      // 鳥居の外から振り返ると戻る
      if (p.z > LAYOUT.torii + 1.5) this.relit = true;
      if (this.relit) {
        const lookingBack = -Math.cos(p.yaw) < -0.3;
        if (lookingBack) for (const l of this.approachLights) l.gain = 1;
      }
    }

    // --- 帰り道の鈴緒 ---
    if (this.darkWayBack) {
      if (Math.abs(p.x) < 5 && p.z > 6 && p.z < 13 && this.ropeSwing < 0.01 && !this.ropeDone) {
        this.ropeDone = true;
        this.ropeSwing = 0.55;
      }
      this.ropeSwing = approach(this.ropeSwing, 0, dt, 0.25);
    }

    // --- 濡れた足跡 ---
    if (this.prints > 0) this.prints = Math.min(1, this.prints + dt * 0.25);

    // --- 賽銭箱の前で静止していると硬貨の音 ---
    const atBox = Math.abs(p.x) < 1.6 && Math.abs(p.z - (LAYOUT.bell[2] - 1.2)) < 2.2;
    this.saisenT = atBox && moving < 0.05 ? this.saisenT + dt : 0;
    if (this.saisenT > 7 && !this.coinDone) { this.coinDone = true; coin(); }

    // --- 止まった直後に一歩多い ---
    if (this.wasMoving && moving < 0.05 && Math.random() < 0.28) {
      this.extraStep = 0.28 + Math.random() * 0.12;
      this.extraSurface = surface;
    }
    this.wasMoving = moving > 0.05;
    if (this.extraStep > 0) {
      this.extraStep -= dt;
      if (this.extraStep <= 0) { this.extraStep = 0; footstep(this.extraSurface, 0.8); }
    }

    // --- 視点が本殿の方へ寄る (一度きり) ---
    if (!this.driftDone && this.seichu && p.z < 26 && p.z > 12) {
      this.driftT = (this.driftT || 0) + dt;
      if (this.driftT > 12) {
        this.driftDone = true;
        this.drift = 0.5;
      }
    }
    if (this.drift > 0) {
      const want = Math.atan2(p.x * -1, -(p.z + 27));
      let d = want - p.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.yaw += d * dt * 1.6;
      this.drift -= dt;
    }
  }

  uniforms() {
    return {
      omen: [this.komainu, this.prints, this.effigy, this.hishaku],
      omen2: [this.nails, this.ema],
      mirror: this.mirror,
      purified: this.purified ? 1 : 0,
      swing: this.ropeSwing,
    };
  }
}
