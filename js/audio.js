// 音はすべて合成。録音素材は再配布規約に触れるので、解析した数値だけを使う。

import { makeRng } from './math.js';

let ctx = null;

export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---------- 本坪鈴 ----------
// 録音を FFT で解析して写したモード表 (周波数 Hz, 相対振幅, 減衰時定数 秒)。基音 2549Hz の個体。
// 塊の中の僅かな差がうなりになる。再生時は REF に対する比率で BASE へ移調する
const REF = 2549, BASE = 2100;
const MODES = [
  [2549, 0.50, 0.28],
  [6554, 0.46, 0.22], [6568, 0.81, 0.30], [6592, 0.43, 0.22], [6609, 0.45, 0.24], [6674, 1.00, 0.24], [6683, 0.36, 0.26],
  [6873, 0.51, 0.22], [6891, 0.28, 0.24], [6929, 0.32, 0.20],
  [9296, 0.25, 0.17],
  [10371, 0.50, 0.18], [10380, 0.59, 0.22], [10389, 0.49, 0.16], [10400, 0.35, 0.17], [10441, 0.30, 0.18], [10500, 0.55, 0.18], [10535, 0.36, 0.15],
  [10948, 0.39, 0.15], [10989, 0.40, 0.19], [11004, 0.81, 0.16], [11013, 0.60, 0.20], [11024, 0.72, 0.17], [11074, 0.78, 0.20], [11089, 0.51, 0.21], [11106, 0.46, 0.20],
  [16954, 0.31, 0.13], [16995, 0.47, 0.14], [17183, 0.27, 0.16],
];

let bellIR = null, hallIR = null;

// 1 打の応答
function renderStrike(ac, base) {
  const sr = ac.sampleRate, len = Math.floor(sr * 1.2);
  const buf = ac.createBuffer(1, len, sr), ch = buf.getChannelData(0);
  for (const [hz, amp, tau] of MODES) {
    const f = hz * base / REF;
    if (f > sr * 0.45) continue;
    const w = 2 * Math.PI * f / sr, ph = Math.random() * Math.PI * 2;
    const k = -1 / (tau * sr);
    for (let i = 0; i < len; i++) ch[i] += amp * Math.sin(w * i + ph) * Math.exp(k * i);
  }
  const nlen = Math.floor(sr * 0.003);
  for (let i = 0; i < nlen; i++) ch[i] += (Math.random() * 2 - 1) * 1.5 * (1 - i / nlen);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(ch[i]));
  for (let i = 0; i < len; i++) ch[i] /= peak;
  return buf;
}

// 境内の残響
function renderHall(ac) {
  const sr = ac.sampleRate, len = Math.floor(sr * 1.6);
  const buf = ac.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 3.2) * (t < 0.02 ? t / 0.02 : 1);
      const n = (Math.random() * 2 - 1);
      lp += (n - lp) * (0.6 - 0.4 * Math.min(1, t));       // 時間とともに暗くなる
      ch[i] = lp * env * 0.6;
    }
    for (const d of [0.011, 0.023, 0.037]) { const j = Math.floor(d * sr); ch[j] += 0.5 * (c ? -1 : 1); }
  }
  return buf;
}

function bellChain(ac) {
  if (!bellIR) bellIR = renderStrike(ac, BASE);
  if (!hallIR) hallIR = renderHall(ac);
  const master = ac.createGain(); master.gain.value = 0.9;
  const dry = ac.createGain(); dry.gain.value = 0.7;
  const wet = ac.createGain(); wet.gain.value = 0.35;
  const conv = ac.createConvolver(); conv.buffer = hallIR;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.15;
  master.connect(dry); master.connect(conv); conv.connect(wet);
  dry.connect(comp); wet.connect(comp); comp.connect(ac.destination);
  return master;
}

// 1 粒 = 玉が壁を叩く
function grain(ac, out, at, gain, rate) {
  const src = ac.createBufferSource(), g = ac.createGain(), bp = ac.createBiquadFilter();
  src.buffer = bellIR;
  src.playbackRate.value = rate;
  bp.type = 'peaking'; bp.frequency.value = 3000 + Math.random() * 3000; bp.Q.value = 1.2; bp.gain.value = 3;
  g.gain.value = gain;
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(at);
}

// 録音の包絡 (250ms に 4〜5 回の山、その後 1.3 秒で減衰) に合わせる。山 1 つ = 玉が跳ね返る間の連打
export function ringBell() {
  const ac = audioContext();
  const out = bellChain(ac);
  const t0 = ac.currentTime + 0.02;
  const hits = [[0, 0.55], [0.05, 1.0], [0.10, 0.6], [0.15, 0.85], [0.21, 0.45], [0.28, 0.35], [0.37, 0.22], [0.48, 0.14], [0.62, 0.08]];
  for (const [at, g] of hits) {
    const n = 4 + Math.floor(g * 6);
    for (let i = 0; i < n; i++) {
      const dt = i * (0.004 + i * 0.0015) * (0.8 + Math.random() * 0.4);
      grain(ac, out, t0 + at + dt, g * 0.3 * Math.exp(-i * 0.25) * (0.7 + Math.random() * 0.3), 0.985 + Math.random() * 0.03);
    }
  }
  return 1.5;
}

// 太鼓
export function drum(gain = 1) {
  const ac = audioContext();
  if (gain < 0.01) return;
  const t = ac.currentTime + 0.01;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.9 * gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + 1.5);
  const len = Math.floor(ac.sampleRate * 0.12);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), ng = ac.createGain();
  src.buffer = buf;
  lp.type = 'lowpass'; lp.frequency.value = 900;
  ng.gain.value = 0.35 * gain;
  src.connect(lp); lp.connect(ng); ng.connect(ac.destination);
  src.start(t);
}


// ---------- 環境音 ----------
// 「夏の夜の田舎」と「風に揺れる草木」の録音を FFT で解析した値から組み立てている。
//   虫は 2 種類の帯域が立っている。3.3-3.7kHz (-13.7dB) と 7-10kHz (-11.6dB)。それ以外は 15-35dB 下。
//   250Hz 以下はほぼ無音 (-50dB) = 夜の野原には低音がない。
//   帯域ごとの包絡を自己相関で見ると、3.5kHz 側は周期 160ms (約 6 回/秒)、8kHz 側は 48ms (約 21 回/秒)。
//   どちらも 尖り (peak/mean) 3.2-4.0、鳴っている時間の割合 0.41。
//   3.3-3.7kHz に 20Hz 刻みでピークが密集 = 少しずつ音程の違う個体が何十匹もいる。
//   草木の風は 500Hz-5kHz がほぼ平坦で 3-4kHz が頂点、125-250Hz で -13.9dB と急に落ちる。
//   つまり葉擦れは「暗い低音」ではなく明るい帯域の音。尖り 2.4 でゆっくり強弱する。
// 合成側を同じ方法で測り直した結果 (dB、最大帯域を 0 とする):
//   帯域        合成    実測          帯域        合成    実測
//   500-1k     -24.3  -31.6         4-5k       -23.6  -22.9
//   1-2k       -23.1  -28.9         5-6k       -23.9  -28.1
//   2-3k       -23.5  -27.8         6-7k       -21.3  -24.0
//   3-4k       -15.0  -13.7         7-8k       -15.1  -11.6
//                                   8-10k      -15.1  -11.7
// 125-500Hz だけ実測より 15dB 高いのは意図的。録音は虫だけの野原で、こちらは桜の下なので風を残してある。
let ambientGain = null, ambientSrc = null;

const AMB_SEC = 12;

// 風
function windInto(ch, sr, len, seed) {
  const rnd = makeRng(seed);
  // 実測は 125-250Hz で -13.9dB、250-500Hz で -6.9dB と急に落ちる。一次では緩すぎるので二段重ねる
  const aHp = 1 / (1 + 2 * Math.PI * 340 / sr);
  const aLp = (2 * Math.PI * 6500 / sr) / (1 + 2 * Math.PI * 6500 / sr);
  let hp = 0, x1 = 0, hp2 = 0, y1 = 0, lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const x = rnd() * 2 - 1;
    hp = aHp * (hp + x - x1); x1 = x;
    hp2 = aHp * (hp2 + hp - y1); y1 = hp;
    lp += (hp2 - lp) * aLp;
    // 突風: 速さの違う三つの唸りを掛け合わせる。尖り 2.4 に合わせて指数を選んだ
    const g = Math.pow(0.5 + 0.5 * Math.sin(t * 0.62 + seed), 2.2)
            * (0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.17 + seed * 2), 1.6))
            + 0.16;
    ch[i] += lp * 0.16 * g;   // 虫が主役で、風はその下に薄く敷く
  }
}

// 帯域を絞った雑音。虫の声は純音ではなく幅がある
function bandNoise(sr, len, f, q, seed) {
  const rnd = makeRng(seed), o = new Float32Array(len);
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < len; i++) {
    const x = rnd() * 2 - 1;
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    o[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return o;
}

// 虫 1 種ぶん。f は中心周波数、rate は 1 秒あたりの鳴き数。個体ごとに位相をずらして重ねる
function insects(ch, sr, len, { f, spread, rate, n, amp, duty, sharp, seed, noise = 0, q = 6 }) {
  const rnd = makeRng(seed), L = len / sr;
  const nz = noise > 0 ? bandNoise(sr, len, f, q, seed + 999) : null;
  for (let k = 0; k < n; k++) {
    // 周期がバッファ長の整数倍になるよう丸める → 継ぎ目で音が途切れない
    const fk = Math.round((f + (rnd() - 0.5) * spread) * L) / L;
    const rk = Math.round((rate * (0.9 + rnd() * 0.2)) * L) / L;
    const ph = rnd() * Math.PI * 2, mph = rnd() * Math.PI * 2;
    const pan = 0.55 + rnd() * 0.9, a = amp * (0.6 + rnd() * 0.8) * pan / Math.sqrt(n);
    const w = 2 * Math.PI * fk / sr, mw = 2 * Math.PI * rk / sr;
    // 倍音を少し足すと「サーッ」ではなく虫の声に近づく
    const w2 = w * 2.02;
    for (let i = 0; i < len; i++) {
      let e = 0.5 + 0.5 * Math.sin(mw * i + mph);
      e = Math.pow(Math.max(0, (e - (1 - duty)) / duty), sharp);
      if (e <= 0) continue;
      const tone = Math.sin(w * i + ph) + Math.sin(w2 * i + ph) * 0.35;
      ch[i] += (noise > 0 ? tone * (1 - noise) + nz[i] * noise * 3.0 : tone) * e * a;
    }
  }
}

function renderAmbient(ac) {
  const sr = ac.sampleRate, len = Math.floor(sr * AMB_SEC), buf = ac.createBuffer(2, len, sr);
  const fade = Math.floor(sr * 0.8);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    // 風だけは雑音なので周期にできない。頭と尻を等パワーで重ねて継ぎ目を消す
    const w = new Float32Array(len);
    windInto(w, sr, len, 3 + c * 7);
    for (let i = 0; i < len; i++) {
      let v = w[i];
      if (i < fade) { const k = i / fade; v = v * Math.sin(k * Math.PI / 2) + w[len - fade + i] * Math.cos(k * Math.PI / 2); }
      ch[i] = v;
    }
    // 虫は別の配列に作ってから、距離ぶんの高域の減衰を通す。
    // 実測は虫のすぐそばで録ったものなので、そのままだと耳につく。境内の木立の中で鳴いている
    // 距離を想定して、4.5kHz から上を落としてから混ぜる
    const ins = new Float32Array(len);
    insects(ins, sr, len, { f: 3280, spread: 300, rate: 6.25, n: 14, amp: 0.10, duty: 0.41, sharp: 1.7, seed: 11 + c * 13 });
    insects(ins, sr, len, { f: 5900, spread: 700, rate: 21, n: 10, amp: 0.085, duty: 0.41, sharp: 1.6, seed: 41 + c * 17, noise: 0.55, q: 11 });
    // ごく小さく、遠くの一匹だけ間を置いて鳴く
    insects(ins, sr, len, { f: 4200, spread: 50, rate: 1 / 3, n: 2, amp: 0.04, duty: 0.18, sharp: 3.0, seed: 77 + c });
    { const aLp = (2 * Math.PI * 4500 / sr) / (1 + 2 * Math.PI * 4500 / sr);
      let l1 = 0, l2 = 0;
      for (let i = 0; i < len; i++) { l1 += (ins[i] - l1) * aLp; l2 += (l1 - l2) * aLp; ch[i] += l2 * 1.5; } }
  }
  return buf;
}

export function startAmbient() {
  const ac = audioContext();
  if (ambientSrc) return;
  ambientGain = ac.createGain();
  ambientGain.gain.value = 0;
  ambientGain.connect(ac.destination);
  ambientSrc = ac.createBufferSource();
  ambientSrc.buffer = renderAmbient(ac);
  ambientSrc.loop = true;
  ambientSrc.connect(ambientGain);
  ambientSrc.start();
  ambientGain.gain.linearRampToValueAtTime(0.5, ac.currentTime + 4);
}

// 環境音を hold 秒だけ止める。fade 秒かけて消し、戻すときはゆっくり
export function hushAmbient(hold = 2.2, fade = 0.7) {
  if (!ambientGain) return;
  const ac = audioContext(), t = ac.currentTime, g = ambientGain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.0001, t + fade);
  g.setValueAtTime(0.0001, t + fade + hold);
  g.linearRampToValueAtTime(0.5, t + fade + hold + 3.5);
}


// ---------- 足音 ----------
// 歩行音 (アスファルト / フローリング / 土 / 砂利) を解析した値から合成。
// 足音はほぼ全部 640Hz 以下で、高い方の「コツ」は添え物でしかない。
//   石畳   30-640Hz が -4〜-8dB でほぼ平ら。そこから上は 1 オクターブごとに約 -9dB
//   木の床 30-160Hz だけ (-5, -9)。160-320Hz で既に -23dB。ほとんど低い胴鳴りだけ
//   土     80-1250Hz が -2〜-4dB と広く、上が緩く落ちる。いちばん長く尾を引く
//   砂利   全体に平たく、2.5-10kHz まで -27dB 前後残る = じゃりじゃりした細かい音
// 歩幅の間隔は実測で 500-630ms。
const STEP = {
  //          帯域の中心(Hz) ごとのレベル(dB)                                     包絡 (0,2,5,10,20,40,70,110ms の dB)
  stone:  { sp: [-4.5, -6.7, -7.7, -5.8, -17.5, -28.3, -35.4, -42.9, -52.4], env: [-18, -20, -7, -8, -15, -19, -21, -23], sec: 0.16 },
  wood:   { sp: [-5.0, -9.2, -22.9, -30.5, -40.5, -43.8, -47.9, -53.2, -62.0], env: [-14, -12, -5, -4, -4, -12, -18, -26], sec: 0.22 },
  earth:  { sp: [-6.2, -2.0, -3.8, -4.0, -2.9, -6.5, -13.2, -19.0, -22.3], env: [-21, -16, -10, -1, -2, -5, -11, -18], sec: 0.20 },
  gravel: { sp: [-11.9, -19.9, -15.6, -15.8, -19.0, -26.5, -26.5, -27.6, -32.7], env: [-11, -11, -6, -3, -4, -9, -9, -14], sec: 0.20 },
};
const STEP_F = [49, 113, 226, 453, 894, 1768, 3536, 7071, 13416];   // 測った帯域の幾何中心
const STEP_T = [0, 2, 5, 10, 20, 40, 70, 110];                       // 包絡を測った時刻 (ms)
const steps = {};

// FFT / 逆 FFT (基数 2)
function fftRun(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// 対数周波数で内挿
function levelAt(sp, hz) {
  if (hz <= STEP_F[0]) return Math.pow(10, sp[0] / 20);
  if (hz >= STEP_F[STEP_F.length - 1]) return Math.pow(10, sp[sp.length - 1] / 20) * STEP_F[STEP_F.length - 1] / hz;
  for (let i = 0; i + 1 < STEP_F.length; i++) {
    if (hz <= STEP_F[i + 1]) {
      const k = Math.log(hz / STEP_F[i]) / Math.log(STEP_F[i + 1] / STEP_F[i]);
      return Math.pow(10, (sp[i] + (sp[i + 1] - sp[i]) * k) / 20);
    }
  }
  return 0;
}

function envAt(env, ms) {
  if (ms >= STEP_T[STEP_T.length - 1]) {
    const last = env[env.length - 1];
    return Math.pow(10, (last - (ms - 110) * 0.25) / 20);   // 110ms 以降は緩やかに落として切る
  }
  for (let i = 0; i + 1 < STEP_T.length; i++) {
    if (ms <= STEP_T[i + 1]) {
      const k = (ms - STEP_T[i]) / (STEP_T[i + 1] - STEP_T[i]);
      return Math.pow(10, (env[i] + (env[i + 1] - env[i]) * k) / 20);
    }
  }
  return 0;
}

// 白色雑音を測ったスペクトルに整形し、測った包絡を掛ける
function renderStep(ac, kind, seed) {
  const sr = ac.sampleRate, def = STEP[kind];
  const N = 8192, re = new Float64Array(N), im = new Float64Array(N);
  const rnd = makeRng(seed);
  for (let i = 0; i < N; i++) re[i] = rnd() * 2 - 1;
  fftRun(re, im, false);
  for (let i = 1; i < N / 2; i++) {
    const hz = i * sr / N;
    // 実測は靴で近接録音したもの。そのままだと体重の重い人の足音になるので、
    // いちばん低い所 (160Hz 以下) を落として軽い踏み方に寄せる
    const g = levelAt(def.sp, hz) * (hz < 160 ? Math.pow(hz / 160, 0.6) : 1);
    re[i] *= g; im[i] *= g;
    re[N - i] *= g; im[N - i] *= g;      // 実数信号になるよう対称に掛ける
  }
  re[0] = im[0] = 0;
  fftRun(re, im, true);
  const len = Math.floor(sr * def.sec), buf = ac.createBuffer(1, len, sr), ch = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const v = re[i % N] * envAt(def.env, i / sr * 1000);
    ch[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < len; i++) ch[i] /= peak || 1;
  return buf;
}

// 同じ音の連打にならないよう、面ごとに数種を用意して選ぶ
export function footstep(kind = 'stone', gain = 1) {
  const ac = audioContext();
  if (!steps[kind]) steps[kind] = [0, 1, 2].map(i => renderStep(ac, kind, 7 + i * 131));
  const list = steps[kind];
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = 0.92 + Math.random() * 0.16;
  g.gain.value = (kind === 'wood' ? 0.17 : kind === 'stone' ? 0.12 : 0.11) * gain * (0.8 + Math.random() * 0.4);
  src.connect(g);
  if (ac.createStereoPanner) {
    const pan = ac.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.4;
    g.connect(pan); pan.connect(ac.destination);
  } else g.connect(ac.destination);
  src.start();
}


// 賽銭箱に落ちる硬貨
export function coin() {
  const ac = audioContext(), t0 = ac.currentTime + 0.02;
  const out = ac.createGain(); out.gain.value = 0.18; out.connect(ac.destination);
  let t = t0;
  for (let k = 0; k < 5; k++) {
    const g = Math.pow(0.62, k);
    for (const [r, amp] of [[1, 1], [2.76, 0.5], [5.4, 0.28], [8.9, 0.15]]) {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = 'sine';
      o.frequency.value = 2450 * r * (1 + (Math.random() - 0.5) * 0.02);
      const d = 0.16 / (1 + r * 0.4);
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.5 * amp * g, t + 0.002);
      gn.gain.exponentialRampToValueAtTime(0.0004, t + d);
      o.connect(gn); gn.connect(out);
      o.start(t); o.stop(t + d + 0.02);
    }
    t += 0.075 * Math.pow(0.78, k);
  }
  // 箱の中の木の響き
  const o = ac.createOscillator(), gn = ac.createGain();
  o.type = 'triangle'; o.frequency.value = 128;
  gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(0.25, t0 + 0.004);
  gn.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.22);
  o.connect(gn); gn.connect(out); o.start(t0); o.stop(t0 + 0.25);
}

// 本殿の方から返ってくる鈴。遠いので高域が落ち、残響だけが長い
export function distantBell() {
  const ac = audioContext();
  const out = bellChain(ac);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.7;
  const g = ac.createGain(); g.gain.value = 0.5;
  lp.connect(g); g.connect(out);
  const t0 = ac.currentTime + 0.02;
  for (let i = 0; i < 5; i++) grain(ac, lp, t0 + i * 0.035 * (1 + i * 0.3), 0.07 * Math.pow(0.72, i), 0.99 + Math.random() * 0.03);
}

// 遠くで重い木の扉が閉まる音
export function doorThud() {
  const ac = audioContext(), t0 = ac.currentTime + 0.02;
  const out = ac.createGain(); out.gain.value = 0.5; out.connect(ac.destination);
  const len = Math.floor(ac.sampleRate * 0.6), buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / ac.sampleRate;
    lp += ((Math.random() * 2 - 1) - lp) * 0.06;
    ch[i] = lp * Math.exp(-tt * 9) * 1.6;
  }
  for (const [f, amp, d] of [[58, 1, 7], [96, 0.5, 9], [151, 0.22, 12]]) {
    const w = 2 * Math.PI * f / ac.sampleRate;
    for (let i = 0; i < len; i++) ch[i] += Math.sin(w * i) * amp * Math.exp(-i / ac.sampleRate * d);
  }
  let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(ch[i]));
  for (let i = 0; i < len; i++) ch[i] /= peak;
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = buf; g.gain.value = 0.32;
  src.connect(g); g.connect(out); src.start(t0);
}

// 絵馬が触れ合う音
export function emaRattle() {
  const ac = audioContext(), t0 = ac.currentTime + 0.02;
  const out = ac.createGain(); out.gain.value = 0.1; out.connect(ac.destination);
  for (let k = 0; k < 7; k++) {
    const t = t0 + k * (0.07 + Math.random() * 0.05);
    const o = ac.createOscillator(), gn = ac.createGain(), bp = ac.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = 900 + Math.random() * 700;
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 2;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(0.5 * (1 - k / 9), t + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    o.connect(bp); bp.connect(gn); gn.connect(out);
    o.start(t); o.stop(t + 0.06);
  }
}


// 拍手
export function clap(gain = 1, distant = false) {
  const ac = audioContext(), t0 = ac.currentTime + 0.01;
  const out = ac.createGain(); out.gain.value = 0.5 * gain; out.connect(ac.destination);
  const conv = ac.createConvolver();
  if (!hallIR) hallIR = renderHall(ac);
  conv.buffer = hallIR;
  const wet = ac.createGain(); wet.gain.value = distant ? 0.9 : 0.35;
  conv.connect(wet); wet.connect(ac.destination);
  const sr = ac.sampleRate, len = Math.floor(sr * 0.05);
  const buf = ac.createBuffer(1, len, sr), ch = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / sr;
    lp += ((Math.random() * 2 - 1) - lp) * (distant ? 0.25 : 0.6);
    ch[i] = lp * Math.exp(-tt * (distant ? 120 : 190)) * 2.2;
  }
  const src = ac.createBufferSource(), g = ac.createGain(), bp = ac.createBiquadFilter();
  src.buffer = buf;
  bp.type = 'bandpass'; bp.frequency.value = distant ? 900 : 1700; bp.Q.value = 0.8;
  g.gain.value = distant ? 0.28 : 0.9;
  src.connect(bp); bp.connect(g); g.connect(out); g.connect(conv);
  src.start(t0);
}


// 手水
export function ladle() {
  const ac = audioContext(), t0 = ac.currentTime + 0.02;
  const out = ac.createGain(); out.gain.value = 0.5; out.connect(ac.destination);
  const sr = ac.sampleRate;
  // 掬う: 水面をかき混ぜる低い音
  const len = Math.floor(sr * 0.55), buf = ac.createBuffer(1, len, sr), ch = buf.getChannelData(0);
  let lp = 0, bp = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / sr;
    lp += ((Math.random() * 2 - 1) - lp) * 0.25;
    bp += (lp - bp) * 0.06;
    const env = Math.sin(Math.PI * Math.min(1, tt / 0.5)) * (0.4 + 0.6 * Math.abs(Math.sin(tt * 9)));
    ch[i] = (lp - bp) * env * 0.8;
  }
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = buf; g.gain.value = 0.3;
  src.connect(g); g.connect(out); src.start(t0);
  // 落ちる水: 粒が水面を叩く
  for (let k = 0; k < 26; k++) {
    const t = t0 + 0.5 + k * (0.012 + Math.random() * 0.03);
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(700 + Math.random() * 1400, t);
    o.frequency.exponentialRampToValueAtTime(300 + Math.random() * 300, t + 0.03);
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(0.1 + Math.random() * 0.12, t + 0.003);
    gn.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    o.connect(gn); gn.connect(out);
    o.start(t); o.stop(t + 0.06);
  }
}
