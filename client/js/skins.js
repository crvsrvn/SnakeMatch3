// 珠体皮肤：材质按 (皮肤, 颜色) 缓存，几何体全局共享。
// glass 皮肤额外带一枚内芯薄片，模仿真实玻璃弹珠里的彩色"猫眼"。

import * as THREE from 'three';

const SPHERE = new THREE.SphereGeometry(1, 22, 14);
const CORE = new THREE.SphereGeometry(1, 16, 10);
const matCache = new Map();

export function makeMaterial(skin, colorHex) {
  const key = `${skin}|${colorHex}`;
  let m = matCache.get(key);
  if (m) return m;
  const color = new THREE.Color(colorHex);

  switch (skin) {
    case 'glass':
      m = new THREE.MeshPhysicalMaterial({
        color, metalness: 0, roughness: 0.02, ior: 1.55, reflectivity: 1,
        clearcoat: 1, clearcoatRoughness: 0,
        transparent: true, opacity: 0.78, envMapIntensity: 1.25,
      });
      break;
    case 'matte':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.55 });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5 });
      break;
    case 'neon':
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex).multiplyScalar(0.15),
        emissive: color, emissiveIntensity: 1.5, roughness: 0.45, metalness: 0.1, envMapIntensity: 0.3,
      });
      break;
    case 'candy':
    default:
      m = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
        sheen: 0.7, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 1.1,
      });
      break;
  }
  matCache.set(key, m);
  return m;
}

function coreMaterial(colorHex) {
  const key = `core|${colorHex}`;
  let m = matCache.get(key);
  if (!m) {
    const color = new THREE.Color(colorHex);
    m = new THREE.MeshStandardMaterial({
      color, roughness: 0.3, metalness: 0.1,
      emissive: color, emissiveIntensity: 0.4,
    });
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
