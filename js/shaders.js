// シェーダー。WebGL1 (GLSL ES 1.0)。精度指定は全段 highp に揃える。

// 頂点の変形。シーン本体とシャドウパスで共有
//   sway 1: 紙垂 (風)   2: 鈴緒 (鳴らすと振れる)   3/4: 本殿の左右の扉 (uOpen で開く)
const DISPLACE = /* glsl */`
  uniform float uT, uSwing, uOpen, uHush; uniform vec2 uHinge;
  // uOmen: x=狛犬の向き(rad) y=足跡(0..1) z=藁人形(0..1) w=柄杓(0..1)
  // uOmen2: x=釘の本数 y=絵馬の鳴り(0..1)
  uniform vec4 uOmen; uniform vec2 uOmen2;

  void rotY(inout vec3 p, inout vec3 n, vec2 pivot, float a) {
    float c = cos(a), s = sin(a);
    vec2 d = p.xz - pivot;
    p.xz = pivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    n.xz = vec2(c * n.x - s * n.z, s * n.x + c * n.z);
  }

  vec3 displace(vec3 p, float s, inout vec3 n) {
    if (s > 19.5) {
      // 五寸釘。添字が本数に満たないものは地面の下へ (見ていない間に増える)
      float idx = floor((s - 20.0) * 10.0 + 0.5);
      if (idx >= uOmen2.x) p.y -= 200.0;
    } else if (s > 13.5) {
      // 14 御鏡。形は動かさない
    } else if (s > 12.5) {
      // 柄杓。伏せるときは縁の上で転がる
      rotY(p, n, vec2(-8.0, 21.0), 0.0);
      float a = uOmen.w * 2.6;
      float c = cos(a), sn = sin(a);
      vec2 d = p.yz - vec2(1.30, 21.05);
      p.yz = vec2(1.30, 21.05) + vec2(c * d.x - sn * d.y, sn * d.x + c * d.y);
      n.yz = vec2(c * n.y - sn * n.z, sn * n.y + c * n.z);
    } else if (s > 11.5) {
      // 絵馬。無風でも一枚だけ細かく鳴る
      p.x += sin(uT * 19.0) * 0.012 * uOmen2.y;
      p.z += cos(uT * 23.0) * 0.008 * uOmen2.y;
    } else if (s > 8.5) {
      if (uOmen.z < 0.5) p.y -= 200.0;                 // 藁人形。途中から現れる
    } else if (s > 7.5) {
      p.y -= (1.0 - uOmen.y) * 5.0;                    // 濡れた足跡。普段は地面の下
    } else if (s > 6.5) {
      // 狛犬。見ていない間に向きが変わる。左右それぞれの台座を軸に回す
      rotY(p, n, vec2(sign(p.x) * 4.6, 12.0), uOmen.x * sign(p.x));
    } else if (s > 4.5) {
      // 5 水面 / 6 流水。形は動かさずフラグメントで表現
    } else if (s > 2.5) {
      float side = s > 3.5 ? 1.0 : -1.0;
      float a = -side * uOpen * 1.6;
      vec2 h = vec2(side * uHinge.x, uHinge.y);
      rotY(p, n, h, a);
    } else if (s > 1.5) {
      float k = 6.4 - p.y;
      p.x += sin(uT * 7.0) * uSwing * k * 0.045;
      p.z += cos(uT * 7.0) * uSwing * k * 0.02;
    } else if (s > 0.5) {
      // 紙垂。風はときどき吹くもので、吹いていない間は止まっている
      float gust = pow(0.5 + 0.5 * sin(uT * 0.21), 3.0) * pow(0.5 + 0.5 * sin(uT * 0.073 + 1.3), 2.0);
      gust *= 1.0 - uHush;
      float w = 0.012 + gust * 0.09;
      p.x += sin(uT * 1.6 + p.y * 2.0 + p.x) * w;
      p.z += cos(uT * 1.1 + p.x * 1.5) * w * 0.8;
      // 風が凪いでいるとき、どれか一枚だけが揺れる。どの一枚かはゆっくり移っていく
      float pick = floor(uT * 0.09);
      float sel = fract(sin(pick * 37.13 + floor(p.x * 3.0) * 5.7 + floor(p.z * 3.0) * 11.3) * 43758.5453);
      float lone = step(0.94, sel) * (1.0 - smoothstep(0.02, 0.12, gust)) * (0.5 + 0.5 * sin(uT * 2.7));
      p.x += lone * 0.055;
      p.z += lone * 0.03;
    }
    return p;
  }`;

// 8 個の点光源 (提灯・灯籠) は毎フレーム近い順に選んで渡す
const LIGHTS = /* glsl */`
  uniform vec3 uL[24]; uniform vec3 uLc[24]; uniform highp int uNL;
  vec3 pointLights(vec3 pos, vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      if (i >= uNL) break;
      vec3 d = uL[i] - pos; float dist = length(d);
      float att = 0.8 / (1.0 + 0.25 * dist * dist);
      acc += uLc[i] * max(dot(n, d / dist), 0.0) * att;
    }
    return acc;
  }
  // 拡散 + 鏡面を 1 回のループで
  void pointLightsSpec(vec3 pos, vec3 n, vec3 v, float rough, out vec3 diff, out vec3 spec) {
    diff = vec3(0.0); spec = vec3(0.0);
    float p = mix(160.0, 8.0, rough), sk = 0.75 * (1.0 - rough * 0.6);
    for (int i = 0; i < 24; i++) {
      if (i >= uNL) break;
      vec3 d = uL[i] - pos; float dist = length(d); d /= dist;
      float att = 1.0 / (1.0 + 0.25 * dist * dist);
      float nl = dot(n, d);
      if (nl <= 0.0) continue;
      diff += uLc[i] * nl * att * 0.8;
      vec3 h = normalize(d + v);
      spec += uLc[i] * pow(max(dot(n, h), 0.0), p) * att * sk;
    }
  }`;

export const SCENE_VS = /* glsl */`
  precision highp float;
  attribute vec3 aP, aN, aC; attribute float aE, aS;
  uniform mat4 uVP, uLightVP;
  varying vec3 vN, vC, vW; varying float vE, vS; varying vec4 vSh;
  ${DISPLACE}
  void main() {
    vec3 n = aN;
    vec3 p = displace(aP, aS, n);
    vW = p; vN = n; vC = aC; vE = aE; vS = aS;
    vSh = uLightVP * vec4(p, 1.0);
    gl_Position = uVP * vec4(p, 1.0);
  }`;

export const SCENE_FS = /* glsl */`
  precision highp float;
  varying vec3 vN, vC, vW; varying float vE, vS; varying vec4 vSh;
  uniform vec3 uEye, uMoon, uFog, uDrip; uniform float uT;
  uniform mat4 uReflVP; uniform sampler2D uRefl; uniform float uMirror, uPure;   // uMirror: 鏡の中の扉の閉じ具合
  uniform float uClipZ;   // 反射を描く間だけ有効。鏡の面より奥のものは映さない
  uniform sampler2D uShadow; uniform float uShTex;
  ${LIGHTS}

  float unpack(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }

  float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float shadow(vec3 n) {
    vec3 s = vSh.xyz / vSh.w * 0.5 + 0.5;
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
    float nl = max(dot(n, uMoon), 0.0);
    float bias = clamp(0.0025 * sqrt(1.0 - nl * nl) / max(nl, 0.05), 0.0008, 0.006);
    float a = hash12(gl_FragCoord.xy) * 6.2832, ca = cos(a), sa = sin(a);
    // 遮蔽物までの距離で半影の広さを変える
    vec2 P4[4]; P4[0] = vec2(-0.7, 0.3); P4[1] = vec2(0.6, 0.7); P4[2] = vec2(0.8, -0.5); P4[3] = vec2(-0.4, -0.8);
    float search = 5.0 / uShTex, blocker = 0.0, cnt = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(ca * P4[i].x - sa * P4[i].y, sa * P4[i].x + ca * P4[i].y) * search;
      float d = unpack(texture2D(uShadow, s.xy + o));
      if (s.z - bias > d) { blocker += d; cnt += 1.0; }
    }
    float px = 1.2 / uShTex;
    if (cnt > 0.0) px = mix(0.8, 7.0, clamp((s.z - blocker / cnt) * 26.0, 0.0, 1.0)) / uShTex;
    vec2 P[16];
    P[0] = vec2(-0.94, 0.02); P[1] = vec2(0.94, -0.40); P[2] = vec2(-0.09, -0.93); P[3] = vec2(0.34, 0.29);
    P[4] = vec2(-0.91, -0.44); P[5] = vec2(-0.82, 0.55); P[6] = vec2(-0.38, 0.28); P[7] = vec2(0.97, 0.06);
    P[8] = vec2(0.44, -0.89); P[9] = vec2(0.53, 0.68); P[10] = vec2(-0.30, -0.42); P[11] = vec2(0.14, -0.14);
    P[12] = vec2(0.10, 0.84); P[13] = vec2(-0.55, -0.79); P[14] = vec2(0.72, -0.21); P[15] = vec2(-0.29, 0.83);
    float sum = 0.0;
    for (int i = 0; i < 16; i++) {
      vec2 o = vec2(ca * P[i].x - sa * P[i].y, sa * P[i].x + ca * P[i].y) * px;
      float d = unpack(texture2D(uShadow, s.xy + o));
      sum += (s.z - bias > d) ? 0.0 : 1.0;
    }
    return sum / 16.0;
  }

  // 焼いたノイズを法線の向きで投影して 1 回引く
  uniform sampler2D uNoise;
  vec4 surf(vec3 p, vec3 n, float scale) {
    vec3 a = abs(n);
    vec2 uv = a.y > a.x && a.y > a.z ? p.xz : (a.x > a.z ? p.zy : p.xy);
    return texture2D(uNoise, uv * scale);
  }

  // 水面
  vec3 waterNormal(vec3 p) {
    float a = sin(p.x * 9.0 + uT * 1.7) * 0.5 + sin(p.z * 11.0 - uT * 1.3) * 0.5 + sin((p.x + p.z) * 6.0 + uT * 0.9) * 0.4;
    float b = cos(p.z * 8.0 + uT * 1.5) * 0.5 + cos(p.x * 12.0 - uT * 1.1) * 0.5 + cos((p.x - p.z) * 7.0 + uT * 0.8) * 0.4;
    vec2 dv = p.xz - uDrip.xz; float dist = length(dv);
    float ring = sin(dist * 40.0 - uT * 9.0) * exp(-dist * 2.2) * 0.9;
    vec2 g = (dist > 0.001 ? dv / dist : vec2(0.0)) * ring;
    return normalize(vec3(a * 0.05 + g.x, 1.0, b * 0.05 + g.y));
  }

  // 流水
  vec3 streamColor(vec3 n, vec3 p) {
    vec3 v = normalize(uEye - p);
    float fr = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    float flow = 0.5 + 0.5 * sin(p.y * 38.0 + uT * 14.0 + sin(p.x * 50.0 + p.z * 50.0) * 2.0);
    float flow2 = 0.5 + 0.5 * sin(p.y * 61.0 + uT * 19.0 + p.x * 30.0);
    vec3 behind = vec3(0.30, 0.31, 0.33) * (0.6 + 0.3 * surf(p * 2.0, n, 1.0).b);
    vec3 col = behind * vec3(0.75, 0.85, 1.0) * (0.75 + 0.25 * flow);
    col += vec3(0.6, 0.75, 1.0) * fr * 0.7;
    col += vec3(1.0) * pow(flow * flow2, 4.0) * 0.55;
    vec3 h = normalize(uMoon + v);
    col += vec3(0.7, 0.8, 1.0) * pow(max(dot(n, h), 0.0), 60.0) * 0.5;
    col += pointLights(p, n) * 0.5;
    return col;
  }

  void main() {
    // 反射を描く間は鏡面より奥を落とす。無いと折り返したカメラが壁の裏に回り込んで壁しか映らない
    if (vW.z < uClipZ) discard;
    vec3 n = normalize(vN);
    if (vS > 13.5) {
      // 御鏡。見ている者だけが映らない (一人称なので何も描かなくてよい)
      if (uMirror < -0.5) {                      // 反射を描いている最中は、鏡自体は鈍い金属として描く
        gl_FragColor = vec4(vec3(0.14, 0.13, 0.11), 1.0);
        return;
      }
      vec4 c4 = uReflVP * vec4(vW, 1.0);
      vec2 uv = c4.xy / c4.w * 0.5 + 0.5;
      vec3 refl = texture2D(uRefl, clamp(uv, 0.002, 0.998)).rgb;
      vec3 v = normalize(uEye - vW);
      float fr = 0.06 + 0.94 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
      // 銅鏡なので少し曇って金色に寄る
      vec3 col = mix(refl * vec3(1.04, 0.98, 0.86), vec3(0.16, 0.15, 0.13), 0.22);
      // 清めていれば、見ている者の居る所に光が宿る
      vec4 e4 = uReflVP * vec4(uEye.x, uEye.y, 2.0 * vW.z - uEye.z, 1.0);
      vec2 euv = e4.xy / e4.w * 0.5 + 0.5;
      col += vec3(1.0, 0.86, 0.62) * uPure * 0.55 * exp(-dot(uv - euv, uv - euv) * 90.0);
      col += vec3(0.9, 0.85, 0.7) * pow(max(dot(reflect(-v, n), uMoon), 0.0), 90.0) * 0.5;
      float fog = 1.0 - exp(-length(vW - uEye) * 0.011);
      gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
      return;
    }
    if (vS > 5.5 && vS < 6.5) {                // 6 流水 (それより大きい sway は気配の類なので通さない)
      vec3 col = streamColor(n, vW);
      float fog = 1.0 - exp(-length(vW - uEye) * 0.013);
      gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
      return;
    }
    if (vS > 4.5 && vS < 5.5) {                // 5 水面
      n = waterNormal(vW);
      vec3 v = normalize(uEye - vW);
      float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 r = reflect(-v, n);
      vec3 skyc = mix(vec3(0.03, 0.04, 0.09), vec3(0.10, 0.13, 0.26), clamp(r.y, 0.0, 1.0));
      float spec = pow(max(dot(r, uMoon), 0.0), 220.0);
      vec3 col = vC * 0.6 + skyc * (0.25 + 0.75 * fr) + vec3(0.7, 0.8, 1.0) * spec * 1.6;
      col += vC * pointLights(vW, n) * 0.6 + pointLights(vW, n) * pow(fr, 0.5) * 0.4;
      float fog = 1.0 - exp(-length(vW - uEye) * 0.013);
      gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
      return;
    }
    // 表面のむら: 木は縦方向に引き伸ばした木目、それ以外は粒
    float wood = step(0.4, vC.r) * step(vC.g, vC.r * 0.8) * step(vC.b, vC.g);
    float stone = (1.0 - wood) * step(abs(vC.r - vC.g), 0.05) * step(0.3, vC.r);
    // 木は年輪が縦に走るよう引き伸ばして投影する
    vec4 nz = surf(vW * mix(vec3(0.85), vec3(2.4, 0.62, 2.4), wood), n, 1.0);
    float woodT = nz.r, stoneT = nz.g, fine = nz.b, weather = nz.a;
    vec3 base = vC;
    // 木
    base = mix(base, base * mix(vec3(0.74, 0.66, 0.60), vec3(1.10, 1.06, 1.02), woodT), wood);
    // 石。低い所ほど風化してくすむ
    base = mix(base, base * (0.62 + stoneT * 0.72), stone);
    base *= 1.0 - stone * weather * 0.16 * smoothstep(3.0, 0.2, vW.y);
    base *= 0.94 + fine * 0.14;
    float grain = mix(fine, mix(stoneT, woodT, wood), max(wood, stone));
    float dist = length(vW - uEye);
    // バンプ。近くだけ、追加の参照 2 回で済ませる
    float h0 = mix(fine, mix(stoneT, woodT, wood), max(wood, stone));
    if (dist < 20.0) {
      vec3 sc = mix(vec3(0.85), vec3(2.4, 0.62, 2.4), wood);
      vec3 t1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : vec3(1.0, 0.0, 0.0));
      vec3 t2 = cross(n, t1);
      float e = 0.02;
      vec4 ax = surf((vW + t1 * e) * sc, n, 1.0), ay = surf((vW + t2 * e) * sc, n, 1.0);
      float hx = mix(ax.b, mix(ax.g, ax.r, wood), max(wood, stone));
      float hy = mix(ay.b, mix(ay.g, ay.r, wood), max(wood, stone));
      float k = (0.6 + stone * 0.8) * smoothstep(22.0, 4.0, dist);
      n = normalize(n - (t1 * (hx - h0) + t2 * (hy - h0)) * k);
    }
    float rough = mix(0.55, 0.9, stone) - wood * 0.15 + (fine - 0.5) * 0.12;   // 粗さも場所で振れる
    float lacq = step(0.6, vC.r) * step(vC.g, 0.3) + step(vC.r, 0.12) * step(vC.g, 0.12);   // 朱塗り・黒漆は艶
    rough = mix(rough, 0.25, clamp(lacq, 0.0, 1.0));
    // 夜空と地面からの環境光。上向きほど明るく、地面近くは遮蔽で暗く
    vec3 sky = vec3(0.10, 0.13, 0.26), gnd = vec3(0.04, 0.04, 0.05);
    vec3 amb = mix(gnd, sky, n.y * 0.5 + 0.5);
    // 月光。青白く、影を落とす
    float nlm = max(dot(n, uMoon), 0.0);
    float sh = nlm > 0.001 ? shadow(n) : 0.0;
    float ml = nlm * sh;
    vec3 col = base * (amb * 1.1 + vec3(0.55, 0.66, 0.95) * ml * 0.55);
    vec3 v = normalize(uEye - vW);
    vec3 ld, ls;
    pointLightsSpec(vW, n, v, rough, ld, ls);
    col += base * ld;
    // 鏡面: 提灯の映り込みと月のハイライト。フレネルで斜めから強く
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    col += ls * mix(0.25, 1.0, fres) * (0.5 + 0.5 * (1.0 - rough));
    vec3 h = normalize(uMoon + v);
    col += vec3(0.55, 0.66, 0.95) * pow(max(dot(n, h), 0.0), mix(200.0, 12.0, rough)) * (0.12 + fres * 0.3) * (1.0 - rough * 0.7) * sh;
    col *= 0.6 + 0.4 * smoothstep(0.0, 1.4, vW.y);
    col = mix(col, vC * 2.2, vE);
    // 高さフォグ: 地面近くに薄く霧が溜まる + 距離フォグ
    float fog = 1.0 - exp(-dist * 0.011);
    float ground = exp(-max(vW.y, 0.0) * 0.35) * (1.0 - exp(-dist * 0.03)) * 0.35;
    col = mix(col, uFog * 1.3, clamp(fog + ground, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }`;

export const SHADOW_VS = /* glsl */`
  precision highp float;
  attribute vec3 aP; attribute float aS;
  uniform mat4 uLightVP;
  ${DISPLACE}
  void main() { vec3 n = vec3(0.0, 1.0, 0.0); gl_Position = uLightVP * vec4(displace(aP, aS, n), 1.0); }`;

export const SHADOW_FS = /* glsl */`
  precision highp float;
  vec4 pack(float d) {
    vec4 r = fract(d * vec4(1.0, 255.0, 65025.0, 16581375.0));
    return r - r.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  }
  void main() { gl_FragColor = pack(gl_FragCoord.z); }`;

// 空。ピクセルごとに視線方向を求めて、星と月を描く
export const SKY_VS = /* glsl */`
  precision highp float;
  attribute vec2 aP; varying vec2 vNdc;
  void main() { vNdc = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;

export const SKY_FS = /* glsl */`
  precision highp float;
  varying vec2 vNdc;
  uniform vec3 uRight, uUp, uFwd, uMoon; uniform vec2 uTan; uniform float uT;
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  // 1格子に星1つ。層を変えて2回撒く (近い大きい星と、遠い細かい星)
  float stars(vec3 d, float cells, float thresh, float size) {
    vec3 g = floor(d * cells), f = fract(d * cells) - 0.5;
    float r = hash3(g);
    vec3 off = vec3(hash3(g + 1.0), hash3(g + 2.0), hash3(g + 3.0)) - 0.5;
    float dist = length(f - off * 0.7);
    float mag = smoothstep(thresh, 1.0, r);
    float twinkle = 0.7 + 0.3 * sin(uT * (1.0 + r * 4.0) + r * 60.0);
    return mag * twinkle * smoothstep(size, 0.0, dist);
  }
  void main() {
    vec3 d = normalize(uFwd + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(vec3(0.028, 0.032, 0.075), vec3(0.003, 0.004, 0.014), pow(h, 0.5));
    float horizonFade = smoothstep(0.0, 0.12, d.y);
    float s1 = stars(d, 60.0, 0.94, 0.16), s2 = stars(d, 150.0, 0.88, 0.22);
    float tint = hash3(floor(d * 60.0) + 5.0);
    vec3 starCol = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.72), tint);   // 青白い星と赤みの星
    col += starCol * (s1 * 3.0 + s2 * 1.2) * horizonFade;
    col += vec3(0.05, 0.055, 0.09) * pow(1.0 - clamp(d.y, 0.0, 1.0), 6.0);     // 地平の淡い光
    // 天の川: なだらかな帯
    float band = exp(-pow(dot(d, normalize(vec3(0.5, 0.3, -0.8))), 2.0) * 7.0);
    col += vec3(0.05, 0.06, 0.11) * band * horizonFade * (0.6 + 0.4 * stars(d, 400.0, 0.5, 0.5));
    // 月
    float md = dot(d, uMoon);
    col += vec3(0.95, 0.95, 0.85) * smoothstep(0.9990, 0.9994, md);
    col += vec3(0.30, 0.34, 0.50) * pow(max(md, 0.0), 50.0) * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }`;

// 桜。1 輪 = 向きを持った小さな板。形はフラグメントで切り抜く
export const BLOSSOM_VS = /* glsl */`
  precision highp float;
  attribute vec3 aP, aN; attribute vec2 aUv; attribute float aSz, aR, aK;
  uniform mat4 uVP, uLightVP; uniform vec3 uEye, uMoon; uniform float uT, uFall, uLod;
  uniform sampler2D uShadow;
  varying vec2 vUv; varying vec3 vC; varying float vR, vSz, vFog;
  ${LIGHTS}
  float unpackB(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
  void main() {
    vec3 c = aP, n = aN;
    float rot = aR * 6.2832;
    if (uFall > 0.5) {
      // 花びら: ひらひらと落ちる。y は範囲で折り返す。aK が負のものだけ逆に昇る
      float dir = aK < 0.0 ? -1.0 : 1.0;
      float y = mod(aP.y - dir * uT * (0.35 + aR * 0.35), 9.0);
      c = vec3(aP.x + sin(uT * 0.8 + aR * 30.0) * 0.6, y, aP.z + cos(uT * 0.6 + aR * 20.0) * 0.5);
      float a = uT * (1.5 + aR * 2.0), b = uT * (1.1 + aR);
      n = normalize(vec3(sin(a) * 0.8, cos(b) * 0.6 + 0.4, cos(a) * 0.8));
      rot += uT * 2.0;
    } else {
      c.x += sin(uT * 0.7 + aP.z * 0.5 + aR * 6.0) * 0.04;
      c.y += sin(uT * 0.9 + aP.x * 0.7 + aR * 9.0) * 0.02;
    }
    // 真横から見ると線になるので、法線を視線側へ寄せる
    vec3 toEye = normalize(uEye - c);
    if (dot(n, toEye) < 0.0) n = -n;
    n = normalize(mix(n, toEye, 0.6));
    // 板の基底: 法線に直交する 2 軸を回す
    vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bt = cross(n, t);
    vec3 r = t * cos(rot) + bt * sin(rot), u = -t * sin(rot) + bt * cos(rot);
    // 少し反った花弁: 端を法線方向へ持ち上げる
    vec2 q = aUv;
    vec3 p = c + (r * q.x + u * q.y) * aSz + n * (dot(q, q) * aSz * 0.35);
    vUv = q; vR = aR; vSz = aSz;
    // 色: 外側は白に近く、塊の内側は濃いピンク。個体差を少し
    vec3 outer = vec3(1.0, 0.92, 0.94), inner = vec3(0.98, 0.70, 0.80);
    vec3 base = mix(inner, outer, aK) * (0.9 + 0.2 * fract(aR * 13.0));
    // 照明は花 1 輪ごと。10cm の板なので頂点で足りる
    vec3 sn = dot(n, toEye) < 0.0 ? -n : n;
    vec4 sp4 = uLightVP * vec4(c, 1.0);
    vec3 sp = sp4.xyz / sp4.w * 0.5 + 0.5;
    float shd = 1.0;
    if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0 && sp.z < 1.0)
      shd = (sp.z - 0.004 > unpackB(texture2D(uShadow, sp.xy))) ? 0.4 : 1.0;
    float ml = max(dot(sn, uMoon), 0.0) + max(dot(-sn, uMoon), 0.0) * 0.35;   // 表と透過光
    vec3 amb = vec3(0.12, 0.14, 0.30);
    vec3 col = base * (amb + vec3(0.55, 0.66, 0.95) * ml * 0.55 * shd);
    col += base * pointLights(c, sn) * 1.2;
    vec3 hv = normalize(uMoon + toEye);
    col += vec3(0.6, 0.68, 0.9) * pow(max(dot(sn, hv), 0.0), 28.0) * 0.16 * shd;   // 花弁の艶
    float d = length(p - uEye);
    vFog = 1.0 - exp(-d * 0.011);
    vC = col;
    // 遠くの 1 輪ずつの花は房に隠れるので畳んで消す
    gl_Position = (aSz < 0.3 && d > uLod) ? vec4(2.0, 2.0, 2.0, 1.0) : uVP * vec4(p, 1.0);
  }`;

export const BLOSSOM_FS = /* glsl */`
  precision highp float;
  varying vec2 vUv; varying vec3 vC; varying float vR, vSz, vFog;
  uniform vec3 uFog; uniform float uFall;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // 五弁の輪郭。中心からの距離 rr が edge を超えたら外
  float petalEdge(float th, float rr) {
    float petalT = fract(th / 6.2832 * 5.0 + 0.5) - 0.5;
    float width = 1.0 - pow(abs(petalT) * 2.0, 1.6);
    float notch = 1.0 - 0.18 * exp(-petalT * petalT * 90.0);
    return (0.62 + 0.36 * width) * notch;
  }
  void main() {
    vec2 q = vUv * 2.0;
    float rr = length(q), th = atan(q.y, q.x);
    vec3 col = vC;
    if (uFall > 0.5) {
      // 花びら 1 枚: 先に切れ込みのあるしずく形
      vec2 s = vec2(q.x, q.y + 0.2);
      if (length(s * vec2(1.4, 1.0)) > 0.6) discard;
      if (s.y > 0.62 * (smoothstep(0.0, 0.25, abs(s.x)) * 0.6 + 0.4) + 0.1) discard;
    } else if (vSz > 0.3) {
      // 房。板を 4x4 に切り、各マスに 1 輪ずつ
      if (rr > 1.0) discard;
      vec2 g = vUv * 4.0 + 2.0, cell = floor(g - 0.5);
      float best = 9.0; vec2 bq = vec2(0.0);
      for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
        vec2 seed = cell + vec2(float(i), float(j)) + vR * 31.0;
        vec2 center = cell + vec2(float(i), float(j)) + 0.5 + (vec2(h21(seed), h21(seed + 7.0)) - 0.5) * 0.7;
        vec2 d = (g - center) / 0.62;
        float a = h21(seed + 3.0) * 6.2832;
        d = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
        float l = length(d);
        if (l < best) { best = l; bq = d; }
      }
      th = atan(bq.y, bq.x);
      if (best > petalEdge(th, best)) discard;
      rr = best;
    } else {
      if (rr > petalEdge(th, rr)) discard;
    }
    if (uFall < 0.5) {
      // 中心は雄しべで黄色みを帯び、少し沈む
      col = mix(col, col * vec3(1.0, 0.86, 0.72), smoothstep(0.34, 0.08, rr) * 0.8);
      float stamen = step(0.72, h21(vec2(floor(th * 3.5), vR * 50.0))) * smoothstep(0.30, 0.22, rr) * step(0.10, rr);
      col = mix(col, vec3(0.95, 0.85, 0.45), stamen * 0.55);
      col *= 0.82 + 0.18 * rr;
    }
    gl_FragColor = vec4(mix(col, uFog, vFog), 1.0);
  }`;

// SSAO 用の法線と深度 (法線 xy, 深度 16bit)
export const ND_VS = /* glsl */`
  precision highp float;
  attribute vec3 aP, aN; attribute float aS;
  uniform mat4 uVP, uView;
  varying vec3 vNv; varying float vD;
  ${DISPLACE}
  void main() {
    vec3 n = aN;
    vec3 p = displace(aP, aS, n);
    vNv = mat3(uView) * n;
    vec4 v = uView * vec4(p, 1.0);
    vD = -v.z;
    gl_Position = uVP * vec4(p, 1.0);
  }`;

export const ND_FS = /* glsl */`
  precision highp float;
  varying vec3 vNv; varying float vD;
  void main() {
    vec3 n = normalize(vNv);
    if (n.z < 0.0) n = -n;
    float d = clamp(vD / 200.0, 0.0, 1.0);
    float hi = floor(d * 255.0) / 255.0, lo = fract(d * 255.0);
    gl_FragColor = vec4(n.xy * 0.5 + 0.5, hi, lo);
  }`;

// SSAO
export const SSAO_FS = /* glsl */`
  precision highp float;
  varying vec2 vUv; uniform sampler2D uND; uniform vec2 uTan;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float depthAt(vec2 uv) { vec4 c = texture2D(uND, uv); return (c.z + c.w / 255.0) * 200.0; }
  void main() {
    vec4 c = texture2D(uND, vUv);
    float d = (c.z + c.w / 255.0) * 200.0;
    if (d > 150.0) { gl_FragColor = vec4(1.0); return; }
    vec2 nxy = c.xy * 2.0 - 1.0;
    vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
    vec3 p = vec3((vUv * 2.0 - 1.0) * uTan * d, -d);
    float r = 0.7, occ = 0.0;
    float a0 = hash(gl_FragCoord.xy) * 6.2832;
    vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bt = cross(n, t);
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float a = a0 + fi * 2.399, e = 0.15 + 0.85 * fract(fi * 0.618 + hash(vUv * 7.0));
      float ph = 0.25 + 0.7 * fract(fi * 0.382 + hash(vUv * 3.0));
      vec3 dir = (t * cos(a) + bt * sin(a)) * sqrt(1.0 - ph * ph) + n * ph;
      vec3 s = p + dir * r * e;
      vec2 suv = (s.xy / (-s.z)) / uTan * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float sd = depthAt(suv);
      float diff = (-s.z) - sd;
      float range = smoothstep(0.0, 1.0, r / max(abs(d - sd), 0.001));
      occ += (diff > 0.03 ? 1.0 : 0.0) * range;
    }
    float ao = 1.0 - occ / 12.0;
    gl_FragColor = vec4(vec3(pow(ao, 1.6)), 1.0);
  }`;

export const QUAD_VS = /* glsl */`
  precision highp float;
  attribute vec2 aP; varying vec2 vUv;
  void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

export const BRIGHT_FS = /* glsl */`
  precision highp float;
  varying vec2 vUv; uniform sampler2D uTex;
  void main() {
    vec3 c = texture2D(uTex, vUv).rgb;
    float l = max(max(c.r, c.g), c.b);
    gl_FragColor = vec4(c * smoothstep(0.9, 1.4, l), 1.0);
  }`;

export const BLUR_FS = /* glsl */`
  precision highp float;
  varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir;
  void main() {
    float w[5]; w[0] = 0.227; w[1] = 0.194; w[2] = 0.121; w[3] = 0.054; w[4] = 0.016;
    vec3 c = texture2D(uTex, vUv).rgb * w[0];
    for (int i = 1; i < 5; i++) {
      vec2 o = uDir * float(i);
      c += texture2D(uTex, vUv + o).rgb * w[i];
      c += texture2D(uTex, vUv - o).rgb * w[i];
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

export const COMPOSITE_FS = /* glsl */`
  precision highp float;
  varying vec2 vUv; uniform sampler2D uScene, uBloom, uBloomW, uAO; uniform float uT; uniform vec2 uPx;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  // FXAA
  vec3 fxaa(vec2 uv) {
    vec3 c = texture2D(uScene, uv).rgb;
    float l = luma(c);
    float ln = luma(texture2D(uScene, uv + vec2(0.0, uPx.y)).rgb), ls = luma(texture2D(uScene, uv - vec2(0.0, uPx.y)).rgb);
    float le = luma(texture2D(uScene, uv + vec2(uPx.x, 0.0)).rgb), lw = luma(texture2D(uScene, uv - vec2(uPx.x, 0.0)).rgb);
    float lmin = min(l, min(min(ln, ls), min(le, lw))), lmax = max(l, max(max(ln, ls), max(le, lw)));
    if (lmax - lmin < max(0.03, lmax * 0.12)) return c;
    float lne = luma(texture2D(uScene, uv + vec2(uPx.x, uPx.y)).rgb), lnw = luma(texture2D(uScene, uv + vec2(-uPx.x, uPx.y)).rgb);
    float lse = luma(texture2D(uScene, uv + vec2(uPx.x, -uPx.y)).rgb), lsw = luma(texture2D(uScene, uv + vec2(-uPx.x, -uPx.y)).rgb);
    float eh = abs(lnw + lne - 2.0 * ln) + abs(lw + le - 2.0 * l) * 2.0 + abs(lsw + lse - 2.0 * ls);
    float ev = abs(lnw + lsw - 2.0 * lw) + abs(ln + ls - 2.0 * l) * 2.0 + abs(lne + lse - 2.0 * le);
    bool horiz = eh >= ev;
    vec2 st = horiz ? vec2(0.0, uPx.y) : vec2(uPx.x, 0.0);
    float l1 = horiz ? ln : le, l2 = horiz ? ls : lw;
    float g1 = abs(l1 - l), g2 = abs(l2 - l);
    vec2 dir = g1 >= g2 ? st : -st;
    vec3 a = texture2D(uScene, uv + dir * 0.5).rgb, b = texture2D(uScene, uv + dir * 1.5).rgb, d = texture2D(uScene, uv - dir * 0.5).rgb;
    return (c * 2.0 + a * 2.0 + b + d) / 6.0;
  }
  void main() {
    float ao = texture2D(uAO, vUv).r;
    vec3 c = fxaa(vUv) * (0.35 + 0.65 * ao)
           + texture2D(uBloom, vUv).rgb * 0.42          // 狭い光芒
           + texture2D(uBloomW, vUv).rgb * 0.5;         // 広い暈
    c *= 0.95;                                          // 露出
    c = aces(c);
    // 影は青紫へ、明部は暖色へ
    float l = luma(c);
    c = mix(c, c * vec3(0.9, 0.95, 1.15), (1.0 - l) * 0.35);
    c = mix(c, c * vec3(1.08, 1.0, 0.9), smoothstep(0.5, 1.0, l) * 0.3);
    c = mix(vec3(l), c, 1.1);                            // 彩度
    c *= smoothstep(1.15, 0.45, length((vUv - 0.5) * vec2(1.15, 1.0)) * 1.3);
    c += (hash(vUv * 900.0 + fract(uT)) - 0.5) * 0.015;
    gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
  }`;
