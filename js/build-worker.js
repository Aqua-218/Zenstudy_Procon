// 境内の生成をメインスレッドから外す。生成した頂点はコピーせずに転送する
import { buildScene } from './shrine.js';
import { noiseTexture } from './noise.js';

onmessage = e => {
  const scene = buildScene(e.data.seed, e.data.density);
  scene.noise = noiseTexture();
  postMessage(scene, [scene.vertices.buffer, scene.blossoms.buffer, scene.petals.buffer, scene.noise.buffer]);
};
