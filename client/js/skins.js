// 珠体皮肤：材质按 (皮肤, 颜色) 缓存，几何体全局共享。
// glass 皮肤额外带一枚内芯薄片，模仿真实玻璃弹珠里的彩色"猫眼"。
// colorHex 传 null 表示万能珠：贴一张彩虹渐变贴图，未被消除前一直是彩色的。

import * as THREE from 'three';

// 分段数在 boot 时按配置重建：珠子数量动辄上千，面数是渲染开销里最直接的一项
let SPHERE = new THREE.SphereGeometry(1, 16, 11);
let CORE = new THREE.SphereGeometry(1, 12, 8);

export function setBeadSegments(w, h) {
  SPHERE.dispose(); CORE.dispose();
  SPHERE = new THREE.SphereGeometry(1, w, h);
  CORE = new THREE.SphereGeometry(1, Math.max(6, w - 4), Math.max(5, h - 3));
}
const matCache = new Map();
let rainbowTex = null;

export function rainbowTexture() {
  if (rainbowTex) return rainbowTex;
  const w = 256, h = 32;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 12; i++) grd.addColorStop(i / 12, `hsl(${(i / 12) * 360}, 92%, 60%)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  rainbowTex = new THREE.CanvasTexture(c);
  rainbowTex.wrapS = rainbowTex.wrapT = THREE.RepeatWrapping;
  rainbowTex.colorSpace = THREE.SRGBColorSpace;
  return rainbowTex;
}

const keyOf = (skin, colorHex) => `${skin}|${colorHex ?? 'wild'}`;

export function makeMaterial(skin, colorHex) {
  const key = keyOf(skin, colorHex);
  let m = matCache.get(key);
  if (m) return m;

  const wild = colorHex === null;
  const color = new THREE.Color(wild ? 0xffffff : colorHex);
  const wildExtra = wild ? { map: rainbowTexture(), emissive: new THREE.Color(0x222222) } : {};

  switch (skin) {
    case 'glass':
      m = new THREE.MeshPhysicalMaterial({
        color, metalness: 0, roughness: 0.02, ior: 1.55, reflectivity: 1,
        clearcoat: 1, clearcoatRoughness: 0,
        transparent: true, opacity: 0.78, envMapIntensity: 1.25, ...wildExtra,
      });
      break;
    case 'matte':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.55, ...wildExtra });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5, ...wildExtra });
      break;
    case 'neon':
      m = wild
        ? new THREE.MeshStandardMaterial({
          color: new THREE.Color(0x101018), map: rainbowTexture(), emissiveMap: rainbowTexture(),
          emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.2, roughness: 0.45, metalness: 0.1,
        })
        : new THREE.MeshStandardMaterial({
          color: new THREE.Color(colorHex).multiplyScalar(0.15),
          emissive: color, emissiveIntensity: 1.5, roughness: 0.45, metalness: 0.1, envMapIntensity: 0.3,
        });
      break;
    case 'candy':
    default:
      m = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
        sheen: 0.7, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 1.1, ...wildExtra,
      });
      break;
  }
  matCache.set(key, m);
  return m;
}

function coreMaterial(colorHex) {
  const key = `core|${colorHex ?? 'wild'}`;
  let m = matCache.get(key);
  if (!m) {
    if (colorHex === null) {
      m = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: rainbowTexture(), emissiveMap: rainbowTexture(),
        emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.1,
      });
    } else {
      const color = new THREE.Color(colorHex);
      m = new THREE.MeshStandardMaterial({
        color, roughness: 0.3, metalness: 0.1,
        emissive: color, emissiveIntensity: 0.4,
      });
    }
    matCache.set(key, m);
  }
  return m;
}

/** 创建一颗珠子（glass 会带内芯） */
export function makeBead(skin, colorHex, radius, castShadow) {
  const mesh = new THREE.Mesh(SPHERE, makeMaterial(skin, colorHex));
  mesh.scale.setScalar(radius);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  if (skin === 'glass') {
    const core = new THREE.Mesh(CORE, coreMaterial(colorHex));
    core.scale.set(0.8, 0.34, 0.8);
    core.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    mesh.add(core);
    mesh.userData.core = core;
  }
  mesh.userData.skin = skin;
  mesh.userData.color = colorHex;
  return mesh;
}

/** 复用已存在的珠子：换皮肤要重建，只换颜色则改材质 */
export function retintBead(mesh, skin, colorHex) {
  if (mesh.userData.skin !== skin) return false;
  if (mesh.userData.color === colorHex) return true;
  mesh.material = makeMaterial(skin, colorHex);
  if (mesh.userData.core) mesh.userData.core.material = coreMaterial(colorHex);
  mesh.userData.color = colorHex;
  return true;
}

/** 三消时的"虚拟珠"用的材质：自发光 + 可调透明度，每个实例独立一份 */
export function makeGhostMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function ghostGeometry() { return SPHERE; }
