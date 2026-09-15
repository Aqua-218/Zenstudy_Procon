// WebGL1 レンダラ。1 フレーム = 影 → 反射 → シーン → SSAO → ブルーム → 合成

import { M, v3 } from './math.js';
import { STRIDE } from './geometry.js';
import { BLOSSOM_STRIDE, blossomIndices, LAYOUT } from './shrine.js';
import * as S from './shaders.js';
import { noiseTexture, NOISE_SIZE } from './noise.js';

export const MOON = v3.norm([-0.45, 0.55, -0.7]);
const FOG = [0.05, 0.06, 0.12];
const SCENE_ATTRIBS = [['aP', 3, 0], ['aN', 3, 12], ['aC', 3, 24], ['aE', 1, 36], ['aS', 1, 40]];
const NL = 24;
const LIGHT_NEAR = 24, LIGHT_FAR = 34;   // この距離で光を滑らかに消す (選外になる前に 0 になるので、歩いても点かない/消えない)
const BLOSSOM_ATTRIBS = [['aP', 3, 0], ['aN', 3, 12], ['aUv', 2, 24], ['aSz', 1, 32], ['aR', 1, 36], ['aK', 1, 40]];

export class Renderer {
  constructor(canvas, scene, { dpr = 1, hinge = [0, 0], drip = [0, 0, 0], quality = {} } = {}) {
    this.drip = drip;
    this.q = Object.assign({ ssao: true, wideBloom: true, shadow: 4096, refl: 768, lod: 22 }, quality);
    this.canvas = canvas;
    this.dpr = dpr;
    this.hinge = hinge;
    // desynchronized (低遅延キャンバス) は通常の合成経路を迂回するため、
    // 端末によっては書き込み途中のバッファがそのまま出て虹色のノイズが走る。使わない
    const gl = this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');

    this.lights = scene.lights;
    this.sceneCount = scene.vertices.length / STRIDE;
    this.sceneBuf = this.buffer(scene.vertices);
    this.quadBuf = this.buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    if (!gl.getExtension('OES_element_index_uint')) throw new Error('OES_element_index_uint unavailable');
    this.blossomCount = scene.blossoms.length / BLOSSOM_STRIDE / 4;
    this.blossomBuf = this.buffer(scene.blossoms);
    this.blossomIdx = this.indexBuffer(blossomIndices(this.blossomCount));
    this.petalCount = scene.petals.length / BLOSSOM_STRIDE / 4;
    this.petalBuf = this.buffer(scene.petals);
    this.petalIdx = this.indexBuffer(blossomIndices(this.petalCount));

    this.p = {
      scene: this.program(S.SCENE_VS, S.SCENE_FS),
      shadow: this.program(S.SHADOW_VS, S.SHADOW_FS),
      sky: this.program(S.SKY_VS, S.SKY_FS),
      blossom: this.program(S.BLOSSOM_VS, S.BLOSSOM_FS),
      bright: this.program(S.QUAD_VS, S.BRIGHT_FS),
      blur: this.program(S.QUAD_VS, S.BLUR_FS),
      composite: this.program(S.QUAD_VS, S.COMPOSITE_FS),
      nd: this.program(S.ND_VS, S.ND_FS),
      ssao: this.program(S.QUAD_VS, S.SSAO_FS),
    };

    // 影: 月の方向から境内全体を平行投影
    this.noiseTex = this.texture2D(scene.noise || noiseTexture(), NOISE_SIZE);
    this.shadowSize = this.q.shadow;   // 扉が動いたときだけ描くので大きく取れる
    this.shadowFbo = this.fbo(this.shadowSize, this.shadowSize, true);
    this.reflFbo = this.fbo(this.q.refl, this.q.refl, true);   // 御鏡の反射
    const center = [0, 3, 14];
    const lightView = M.lookAt(v3.add(center, v3.scale(MOON, 70)), center, [0, 1, 0]);
    this.lightVP = M.mul(M.ortho(-40, 40, -40, 40, 10, 150), lightView);

    this.resize();
  }

  // ---------- 生成ヘルパー ----------
  buffer(data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  indexBuffer(data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {}; p.a = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const n = gl.getActiveUniform(p, i).name.replace('[0]', '');
      p.u[n] = gl.getUniformLocation(p, n);
    }
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) {
      const n = gl.getActiveAttrib(p, i).name;
      p.a[n] = gl.getAttribLocation(p, n);
    }
    return p;
  }

  // 繰り返し用のテクスチャ
  texture2D(data, size) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    // 異方性フィルタ: 床や壁を浅い角度で見たときのにじみが消える
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    return tex;
  }

  fbo(w, h, withDepth) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (withDepth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, rb, w, h };
  }

  // 作り直す前に古いものを捨てる。捨てずに作り直すと解像度を変えるたびに漏れて、
  // やがて GPU のメモリが足りなくなり画面がちらつく
  dispose(f) {
    if (!f) return;
    const gl = this.gl;
    gl.deleteFramebuffer(f.fb);
    gl.deleteTexture(f.tex);
    if (f.rb) gl.deleteRenderbuffer(f.rb);
  }

  // 重いときは内部解像度を下げ、余裕が戻れば上げる
  // targetMs: 目指している描画間隔。フレームを間引いているときは、その間隔を基準に判断しないと
  // 「重い」と誤認して解像度を下げ続けてしまう
  adapt(targetMs = 16.7) {
    const t = performance.now();
    const frameMs = this.lastAdaptAt ? Math.min(t - this.lastAdaptAt, 200) : targetMs;
    this.lastAdaptAt = t;
    this.avgMs = this.avgMs === undefined ? frameMs : this.avgMs * 0.9 + frameMs * 0.1;
    // 下げる条件と戻す条件を離し、変えたあとは測り直す。近い閾値で行き来すると
    // そのたびに作り直しが起きて画面がちらつく
    if (t - (this.lastAdapt || 0) < 3000) return;
    const change = this.avgMs > targetMs + 9 && this.scale > 0.55 ? -0.15
      : this.avgMs < targetMs - 1.5 && this.scale < 1 ? 0.15 : 0;
    if (!change) return;
    this.scale = Math.max(0.55, Math.min(1, this.scale + change));
    this.lastAdapt = t;
    this.avgMs = undefined;
    this.resize();
    this.ssao = this.q.ssao && this.scale >= 0.7;   // 解像度を落とすほど重いときは SSAO も止める
  }

  resize() {
    const gl = this.gl, c = this.canvas;
    if (this.scale === undefined) this.scale = 1;
    c.width = Math.max(1, Math.floor(innerWidth * this.dpr * this.scale));
    c.height = Math.max(1, Math.floor(innerHeight * this.dpr * this.scale));
    for (const f of [this.sceneFbo, this.bloomA, this.bloomB, this.bloomC, this.ndFbo, this.aoA, this.aoB]) this.dispose(f);
    this.sceneFbo = this.fbo(c.width, c.height, true);
    const bw = Math.max(1, c.width >> 2), bh = Math.max(1, c.height >> 2);
    this.bloomA = this.fbo(bw, bh, false);
    this.bloomB = this.fbo(bw, bh, false);
    this.bloomC = this.fbo(bw, bh, false);   // 広いぼかし (提灯のまわりの柔らかい光)
    const hw = Math.max(1, c.width >> 1), hh = Math.max(1, c.height >> 1);
    this.ndFbo = this.fbo(hw, hh, true);
    this.aoA = this.fbo(hw, hh, false);
    this.aoB = this.fbo(hw, hh, false);
    gl.viewport(0, 0, c.width, c.height);
  }

  // ---------- 描画ヘルパー ----------
  bindAttribs(p, buf, list, stride) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [n, sz, off] of list) {
      if (p.a[n] === undefined || p.a[n] < 0) continue;
      gl.enableVertexAttribArray(p.a[n]);
      gl.vertexAttribPointer(p.a[n], sz, gl.FLOAT, false, stride, off);
    }
  }

  drawQuad(p, target, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.useProgram(p);
    this.bindAttribs(p, this.quadBuf, [['aP', 2, 0]], 0);
    setup(p);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  // 近い順に選ぶ。本殿の中の灯りは扉の開き具合で強さが変わる
  pickLights(eye, open) {
    const scored = this.lights.map(l => {
      const d = v3.len(v3.sub(l.pos, eye));
      const fade = 1 - Math.min(1, Math.max(0, (d - LIGHT_NEAR) / (LIGHT_FAR - LIGHT_NEAR)));
      const k = (l.interior ? l.k * open : l.k) * (l.gain === undefined ? 1 : l.gain) * fade * fade * (3 - 2 * fade);
      return { l, k, d };
    }).filter(e => e.k > 0).sort((a, b) => a.d - b.d).slice(0, NL);
    const pos = [], col = [];
    for (let i = 0; i < NL; i++) {
      const e = scored[i];
      if (e) { pos.push(...e.l.pos); col.push(...v3.scale(e.l.col, e.k)); }
      else { pos.push(0, -100, 0); col.push(0, 0, 0); }
    }
    return { pos, col, n: scored.length };
  }

  setCommon(p, VP, t, swing, open) {
    const gl = this.gl;
    if (p.u.uVP) gl.uniformMatrix4fv(p.u.uVP, false, VP);
    gl.uniform1f(p.u.uT, t);
    if (p.u.uSwing) gl.uniform1f(p.u.uSwing, swing);
    if (p.u.uOpen) gl.uniform1f(p.u.uOpen, open);
    if (p.u.uHush) gl.uniform1f(p.u.uHush, this.hush || 0);
    if (p.u.uOmen) gl.uniform4fv(p.u.uOmen, this.omen ? this.omen.omen : [0, 0, 0, 0]);
    if (p.u.uOmen2) gl.uniform2fv(p.u.uOmen2, this.omen ? this.omen.omen2 : [1, 0]);
    if (p.u.uHinge) gl.uniform2fv(p.u.uHinge, this.hinge);
  }

  render({ eye, yaw, pitch, t, swing, open, hush = 0, omen = null, petals = true }) {
    const gl = this.gl, c = this.canvas, asp = c.width / c.height;
    const fov = asp < 1 ? 1.2 : 0.95;
    const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const right = v3.norm(v3.cross(fwd, [0, 1, 0]));
    const up = v3.cross(right, fwd);
    const proj = M.persp(fov, asp, 0.25, 220);
    const view = M.lookAt(eye, v3.add(eye, fwd), [0, 1, 0]);
    const VP = M.mul(proj, view);
    const tanv = [Math.tan(fov / 2) * asp, Math.tan(fov / 2)];
    this.hush = hush;
    this.omen = omen;
    const L = this.pickLights(eye, open);

    // 1. 影。景色は動かないので、扉が動いたときだけ描き直す
    let p = this.p.shadow;
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
    if (this.shadowOpen === undefined || Math.abs(this.shadowOpen - open) > 0.01) {
      this.shadowOpen = open;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo.fb);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(p);
      this.bindAttribs(p, this.sceneBuf, SCENE_ATTRIBS, STRIDE * 4);
      gl.uniformMatrix4fv(p.u.uLightVP, false, this.lightVP);
      this.setCommon(p, VP, 0, 0, open);
      gl.drawArrays(gl.TRIANGLES, 0, this.sceneCount);
    }

    // 1.5 御鏡の反射。扉が開いていて、正面の近くにいるときだけ
    const mir = LAYOUT.mirror;
    let reflVP = VP;
    this.mirrorOn = false;
    if (mir && open > 0.05) {
      const dz = eye[2] - mir.z, dist = Math.hypot(eye[0] - mir.x, eye[1] - mir.y, dz);
      if (dz > 0.2 && dist < 14) {
        this.mirrorOn = true;
        // 視点を鏡面で折り返した位置から鏡の中心へ向ける。
        // 画角は円板が収まる分だけに絞る (全体を描くと使うのは一部だけでぼやける)
        const me = [eye[0], eye[1], 2 * mir.z - eye[2]];
        const rfov = Math.min(2.2, Math.max(0.2, 2 * Math.atan(0.46 / Math.max(dist, 0.4)) * 1.45));
        reflVP = M.mul(M.persp(rfov, 1, 0.08, 220), M.lookAt(me, [mir.x, mir.y, mir.z], [0, 1, 0]));
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflFbo.fb);
        gl.viewport(0, 0, this.reflFbo.w, this.reflFbo.h);
        gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        p = this.p.scene;
        gl.useProgram(p);
        this.bindAttribs(p, this.sceneBuf, SCENE_ATTRIBS, STRIDE * 4);
        const mclose = this.omen && this.omen.mirror ? this.omen.mirror : 0;
        this.setCommon(p, reflVP, t, swing, open * (1 - mclose));   // 鏡の中でだけ扉が閉じていく
        gl.uniformMatrix4fv(p.u.uLightVP, false, this.lightVP);
        gl.uniform3fv(p.u.uEye, me);
        gl.uniform3fv(p.u.uMoon, MOON);
        gl.uniform3fv(p.u.uL, L.pos); gl.uniform3fv(p.u.uLc, L.col); gl.uniform1i(p.u.uNL, L.n);
        gl.uniform3fv(p.u.uFog, FOG);
        gl.uniform3fv(p.u.uDrip, this.drip);
        gl.uniform1f(p.u.uShTex, this.shadowSize);
        gl.uniform1f(p.u.uMirror, -1);                    // 反射を描いている間は鏡を鈍い金属として扱う (自分自身を参照しない)
        gl.uniform1f(p.u.uClipZ, mir.z + 0.02);           // 鏡面で切り落とす
        gl.uniformMatrix4fv(p.u.uReflVP, false, VP);
        this.bindTex(0, this.shadowFbo.tex, p.u.uShadow);
        this.bindTex(3, this.noiseTex, p.u.uNoise);
        this.bindTex(4, this.noiseTex, p.u.uRefl);
        gl.drawArrays(gl.TRIANGLES, 0, this.sceneCount);
      }
    }

    // 2. シーン
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo.fb);
    gl.viewport(0, 0, c.width, c.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    p = this.p.sky;
    gl.useProgram(p);
    this.bindAttribs(p, this.quadBuf, [['aP', 2, 0]], 0);
    gl.uniform3fv(p.u.uRight, right); gl.uniform3fv(p.u.uUp, up); gl.uniform3fv(p.u.uFwd, fwd);
    gl.uniform3fv(p.u.uMoon, MOON);
    gl.uniform2f(p.u.uTan, Math.tan(fov / 2) * asp, Math.tan(fov / 2));
    gl.uniform1f(p.u.uT, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    p = this.p.scene;
    gl.useProgram(p);
    this.bindAttribs(p, this.sceneBuf, SCENE_ATTRIBS, STRIDE * 4);
    this.setCommon(p, VP, t, swing, open);
    gl.uniformMatrix4fv(p.u.uLightVP, false, this.lightVP);
    gl.uniform3fv(p.u.uEye, eye);
    gl.uniform3fv(p.u.uMoon, MOON);
    gl.uniform3fv(p.u.uL, L.pos); gl.uniform3fv(p.u.uLc, L.col); gl.uniform1i(p.u.uNL, L.n);
    gl.uniform3fv(p.u.uFog, FOG);
    gl.uniform3fv(p.u.uDrip, this.drip);
    gl.uniform1f(p.u.uShTex, this.shadowSize);
    this.bindTex(0, this.shadowFbo.tex, p.u.uShadow);
    this.bindTex(3, this.noiseTex, p.u.uNoise);
    this.bindTex(4, this.reflFbo.tex, p.u.uRefl);
    gl.uniformMatrix4fv(p.u.uReflVP, false, reflVP);
    gl.uniform1f(p.u.uMirror, this.mirrorOn ? (this.omen && this.omen.mirror !== undefined ? this.omen.mirror : 0) : -1);
    gl.uniform1f(p.u.uPure, this.omen ? this.omen.purified : 0);
    gl.uniform1f(p.u.uClipZ, -1e9);   // 本編では切り落とさない
    gl.drawArrays(gl.TRIANGLES, 0, this.sceneCount);

    // 桜と花びら
    gl.disable(gl.CULL_FACE);
    p = this.p.blossom;
    gl.useProgram(p);
    this.setCommon(p, VP, t, swing, open);
    gl.uniform3fv(p.u.uEye, eye);
    gl.uniform3fv(p.u.uMoon, MOON);
    gl.uniform3fv(p.u.uL, L.pos); gl.uniform3fv(p.u.uLc, L.col); gl.uniform1i(p.u.uNL, Math.min(L.n, 10));   // 花は頂点数が多いので近い 10 灯まで
    gl.uniformMatrix4fv(p.u.uLightVP, false, this.lightVP);
    this.bindTex(0, this.shadowFbo.tex, p.u.uShadow);
    gl.uniform3fv(p.u.uFog, FOG);
    gl.uniform1f(p.u.uLod, this.q.lod);   // 1 輪ずつの花を描く距離
    gl.uniform1f(p.u.uFall, 0);
    this.bindAttribs(p, this.blossomBuf, BLOSSOM_ATTRIBS, BLOSSOM_STRIDE * 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.blossomIdx);
    gl.drawElements(gl.TRIANGLES, this.blossomCount * 6, gl.UNSIGNED_INT, 0);
    if (petals) {
      gl.uniform1f(p.u.uFall, 1);
      this.bindAttribs(p, this.petalBuf, BLOSSOM_ATTRIBS, BLOSSOM_STRIDE * 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.petalIdx);
      gl.drawElements(gl.TRIANGLES, this.petalCount * 6, gl.UNSIGNED_INT, 0);
    }

    // 3. SSAO (半解像度)
    if (this.q.ssao && this.ssao !== false) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ndFbo.fb);
      gl.viewport(0, 0, this.ndFbo.w, this.ndFbo.h);
      gl.clearColor(0.5, 0.5, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      p = this.p.nd;
      gl.useProgram(p);
      this.bindAttribs(p, this.sceneBuf, SCENE_ATTRIBS, STRIDE * 4);
      this.setCommon(p, VP, t, swing, open);
      gl.uniformMatrix4fv(p.u.uView, false, view);
      gl.drawArrays(gl.TRIANGLES, 0, this.sceneCount);
      gl.disable(gl.DEPTH_TEST);
      this.drawQuad(this.p.ssao, this.aoA, q => { this.bindTex(0, this.ndFbo.tex, q.u.uND); gl.uniform2fv(q.u.uTan, tanv); });
      this.drawQuad(this.p.blur, this.aoB, q => { this.bindTex(0, this.aoA.tex, q.u.uTex); gl.uniform2f(q.u.uDir, 1.0 / this.aoA.w, 0); });
      this.drawQuad(this.p.blur, this.aoA, q => { this.bindTex(0, this.aoB.tex, q.u.uTex); gl.uniform2f(q.u.uDir, 0, 1.0 / this.aoA.h); });
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoA.fb); gl.viewport(0, 0, this.aoA.w, this.aoA.h);
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // 4. ブルーム (1/4 解像度)
    this.drawQuad(this.p.bright, this.bloomA, q => this.bindTex(0, this.sceneFbo.tex, q.u.uTex));
    this.drawQuad(this.p.blur, this.bloomB, q => {
      this.bindTex(0, this.bloomA.tex, q.u.uTex); gl.uniform2f(q.u.uDir, 1.6 / this.bloomA.w, 0);
    });
    this.drawQuad(this.p.blur, this.bloomA, q => {
      this.bindTex(0, this.bloomB.tex, q.u.uTex); gl.uniform2f(q.u.uDir, 0, 1.6 / this.bloomA.h);
    });
    // 2 段目。狭い光芒と広い暈の 2 層にする
    if (this.q.wideBloom) {
      this.drawQuad(this.p.blur, this.bloomB, q => {
        this.bindTex(0, this.bloomA.tex, q.u.uTex); gl.uniform2f(q.u.uDir, 5.5 / this.bloomA.w, 0);
      });
      this.drawQuad(this.p.blur, this.bloomC, q => {
        this.bindTex(0, this.bloomB.tex, q.u.uTex); gl.uniform2f(q.u.uDir, 0, 5.5 / this.bloomA.h);
      });
    }

    // 5. 合成
    this.drawQuad(this.p.composite, null, q => {
      this.bindTex(0, this.sceneFbo.tex, q.u.uScene);
      this.bindTex(1, this.bloomA.tex, q.u.uBloom);
      this.bindTex(2, this.aoA.tex, q.u.uAO);
      this.bindTex(3, this.q.wideBloom ? this.bloomC.tex : this.bloomA.tex, q.u.uBloomW);
      gl.uniform2f(q.u.uPx, 1 / c.width, 1 / c.height);
      gl.uniform1f(q.u.uT, t);
    });
  }
}
