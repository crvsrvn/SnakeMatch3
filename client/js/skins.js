// Bead skins. Materials are cached by (skin, color, phase); geometry is shared globally.
//
// Every pattern is generated in GLSL, not painted into a canvas: each decorated skin
// injects a small procedural chunk through onBeforeCompile and reads a `uPhase` uniform.
// Neighbouring beads get neighbouring phases, so the pattern appears to travel from head
// to tail. The phase is baked into the material rather than pushed per draw call because
// three.js uploads material uniforms per material, not per object -- a "ring" of phase
// materials is the cheapest way to get a per-bead value with thousands of beads on screen.

import * as THREE from 'three';

// Number of phase steps. 16 is the compromise between "no visible stepping" and
// "material count stays in the hundreds".
const PHASES = 16;

/** Skins whose pattern travels along the body */
export const FLOW_SKINS = new Set(['neon', 'aurora', 'galaxy', 'magma', 'candy']);

/** Phase of bead i at time t. Rises with the index, falls with time -> crest runs head to tail. */
export function flowPhase(i, t, speed, spacing) {
  const p = i * spacing - t * speed * PHASES;
  return ((Math.floor(p) % PHASES) + PHASES) % PHASES;
}

// Segment counts are rebuilt at boot from config: bead counts run into the thousands,
// so triangle count is the most direct lever on render cost.
let SPHERE = new THREE.SphereGeometry(1, 16, 11);
let CORE = new THREE.SphereGeometry(1, 12, 8);

export function setBeadSegments(w, h) {
  SPHERE.dispose(); CORE.dispose();
  SPHERE = new THREE.SphereGeometry(1, w, h);
  CORE = new THREE.SphereGeometry(1, Math.max(6, w - 4), Math.max(5, h - 3));
}

const matCache = new Map();
let rainbowTex = null;

/** Only still used by the glass core and by skins that carry no shader of their own */
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

// ---------------------------------------------------------------------------
// Shared GLSL: cheap 3D value noise plus the helpers the patterns build on.
// Three octaves at most -- this runs on every bead pixel of every snake on screen.
// ---------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */`
float sm3Hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sm3Noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sm3Hash(i), sm3Hash(i + vec3(1,0,0)), f.x),
        mix(sm3Hash(i + vec3(0,1,0)), sm3Hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(sm3Hash(i + vec3(0,0,1)), sm3Hash(i + vec3(1,0,1)), f.x),
        mix(sm3Hash(i + vec3(0,1,1)), sm3Hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float sm3Fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * sm3Noise(p); p *= 2.07; a *= 0.5; }
  return s;
}
// Cosine palette rainbow, so wild beads need no texture
vec3 sm3Hue(float h) {
  return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
}
`;

// Preamble shared by every pattern. At the injection point (right after
// <emissivemap_fragment>) `normal` and `vViewPosition` are already in scope, and
// `diffuseColor`, `roughnessFactor` and `totalEmissiveRadiance` are all still read by the
// lighting chunks that follow -- so one injection point drives albedo, roughness and glow.
const PATTERN_PRELUDE = /* glsl */`
  vec3 sm3Dir = normalize(vObjPos);
  float sm3Wave = 0.5 - 0.5 * cos(6.28318 * uPhase);
  float sm3Fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.0);
  vec3 sm3Tint = uWild > 0.5
    ? sm3Hue(atan(sm3Dir.z, sm3Dir.x) * 0.159155 + uPhase)
    : uTint;
`;

const PATTERNS = {
  // Molten rock: an fbm crust drifting across the bead with glowing melt in the gaps.
  // The bead keeps its own hue (three-match readability) but is pushed towards white hot,
  // so it reads as melt of that color rather than as a plain colored ball.
  magma: /* glsl */`
    vec3 q = sm3Dir * 3.4 + vec3(0.0, uPhase * 2.5, uPhase * 1.2);
    float n = sm3Fbm(q);
    // Thin veins are the isoline of the noise field, not a threshold of it: thresholding
    // gives blotches, |n - 0.5| gives the cracked-crust network we actually want.
    float vein = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
    float halo = 1.0 - smoothstep(0.0, 0.24, abs(n - 0.5));
    float heat = (vein + halo * 0.4) * (0.5 + 0.8 * sm3Wave);
    diffuseColor.rgb = vec3(0.028, 0.014, 0.010) + sm3Tint * 0.02;
    totalEmissiveRadiance += mix(sm3Tint, vec3(1.0, 0.55, 0.15), 0.4) * heat * 2.8;
    roughnessFactor = 0.95;
  `,

  // Deep space: a hashed star field on the sphere direction plus a slowly swirling nebula.
  galaxy: /* glsl */`
    vec3 q = sm3Dir * 2.2 + vec3(uPhase * 1.2, uPhase * 0.6, 0.0);
    float neb = sm3Fbm(q);
    float star = smoothstep(0.972, 0.999, sm3Hash(floor(sm3Dir * 110.0)));
    diffuseColor.rgb = vec3(0.012, 0.014, 0.03);
    totalEmissiveRadiance += sm3Tint * pow(neb, 2.2) * (0.7 + 1.4 * sm3Wave)
      + vec3(0.45, 0.5, 1.0) * pow(neb, 5.0) * 1.2
      + vec3(0.9, 0.95, 1.0) * star * 2.2;
    roughnessFactor = 0.6;
  `,

  // Neon tube: a near-black body, all of the read comes from self-illumination plus a
  // hard fresnel rim that brightens as the pulse passes.
  neon: /* glsl */`
    diffuseColor.rgb = sm3Tint * 0.02;
    float rim = pow(sm3Fres, 1.6);
    totalEmissiveRadiance += sm3Tint * (0.5 + 1.0 * sm3Wave)
      + mix(sm3Tint, vec3(1.0), 0.6) * rim * (0.6 + 0.9 * sm3Wave);
    roughnessFactor = 0.35;
  `,

  // Aurora: the material already does thin-film iridescence; this adds slow curtains of
  // light drifting over the surface and brightening towards the silhouette.
  aurora: /* glsl */`
    float band = 0.5 + 0.5 * sin(sm3Fbm(sm3Dir * 1.7 + uPhase * 2.0) * 9.0 + uPhase * 6.28318);
    vec3 curtain = mix(sm3Tint, sm3Hue(band * 0.35 + uPhase), 0.55);
    totalEmissiveRadiance += curtain * pow(band, 2.0) * (0.35 + 1.3 * sm3Fres) * (0.6 + 0.9 * sm3Wave);
  `,

  // Candy: glazed spiral stripes turning around the bead, white sugar over the base color.
  candy: /* glsl */`
    float ang = atan(sm3Dir.z, sm3Dir.x);
    float stripe = 0.5 + 0.5 * sin(ang * 6.0 + sm3Dir.y * 4.5 + uPhase * 6.28318);
    diffuseColor.rgb = mix(sm3Tint * 0.9, vec3(1.0), smoothstep(0.35, 0.75, stripe) * 0.8);
    totalEmissiveRadiance += sm3Tint * 0.1 * sm3Wave;
    roughnessFactor = 0.1;
  `,

  // Polished metal: high frequency noise stretched along one axis fakes a brushed finish
  // by perturbing roughness alone, which is what actually produces the streaked highlight.
  metal: /* glsl */`
    float streak = sm3Noise(vec3(sm3Dir.x * 70.0, sm3Dir.y * 3.0, sm3Dir.z * 70.0));
    roughnessFactor = clamp(0.06 + streak * 0.34, 0.03, 0.55);
  `,

  // Glass: an oil-film rim. Cheap, and it is what makes a real marble read as glass.
  glass: /* glsl */`
    float f = pow(sm3Fres, 1.4);
    totalEmissiveRadiance += sm3Hue(f * 1.3 + uPhase) * f * 0.45;
  `,
};

/**
 * Bolt a procedural pattern onto a stock three.js material.
 * customProgramCacheKey is mandatory here: without it three.js hands two skins that share
 * the same material parameters the same compiled program, and one pattern silently wins.
 */
function decorate(material, skin, tint, phase01, wild) {
  const src = PATTERNS[skin];
  if (!src) return material;
  material.customProgramCacheKey = () => `sm3-${skin}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = { value: phase01 };
    shader.uniforms.uTint = { value: tint };
    shader.uniforms.uWild = { value: wild ? 1 : 0 };
    shader.vertexShader = `varying vec3 vObjPos;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = position;');
    shader.fragmentShader = `varying vec3 vObjPos;
uniform float uPhase;
uniform vec3 uTint;
uniform float uWild;
${NOISE_GLSL}
${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n{\n${PATTERN_PRELUDE}\n${src}\n}`,
    );
  };
  return material;
}

const keyOf = (skin, colorHex, phase) => `${skin}|${colorHex ?? 'wild'}|${phase}`;

export function makeMaterial(skin, colorHex, phase = -1) {
  const key = keyOf(skin, colorHex, phase);
  let m = matCache.get(key);
  if (m) return m;

  const wild = colorHex === null;
  const color = new THREE.Color(wild ? 0xffffff : colorHex);
  const phase01 = phase < 0 ? 0.25 : phase / PHASES;
  const wildMap = wild ? { map: rainbowTexture() } : {};

  switch (skin) {
    case 'glass':
      m = new THREE.MeshPhysicalMaterial({
        color, metalness: 0, roughness: 0.02, ior: 1.55, reflectivity: 1,
        clearcoat: 1, clearcoatRoughness: 0,
        transparent: true, opacity: 0.78, envMapIntensity: 1.3, ...wildMap,
      });
      break;
    case 'matte':
      // The one deliberately plain skin: no shader, no aura. It exists so that the flashy
      // ones have something to be flashy against.
      m = new THREE.MeshStandardMaterial({
        color, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.7, ...wildMap,
      });
      break;
    case 'metal':
      m = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.18, metalness: 1.0,
        anisotropy: 0.7, anisotropyRotation: Math.PI / 4,
        clearcoat: 0.7, clearcoatRoughness: 0.08,
        envMapIntensity: 1.6, ...wildMap,
      });
      break;
    case 'neon':
      m = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.03),
        emissive: new THREE.Color(0x000000),
        roughness: 0.4, metalness: 0.1, envMapIntensity: 0.15,
      });
      break;
    case 'aurora':
      m = new THREE.MeshPhysicalMaterial({
        color, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02,
        iridescence: 1, iridescenceIOR: 1.5 + phase01 * 0.9,
        iridescenceThicknessRange: [100 + phase01 * 380, 400 + phase01 * 700],
        emissive: new THREE.Color(0x000000), envMapIntensity: 1.1,
      });
      break;
    case 'galaxy':
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x0b0d1a),
        emissive: new THREE.Color(0x000000),
        roughness: 0.6, metalness: 0.2, envMapIntensity: 0.3,
      });
      break;
    case 'magma':
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x0c0402),
        emissive: new THREE.Color(0x000000),
        roughness: 1.0, metalness: 0.0, envMapIntensity: 0.0,
      });
      break;
    case 'candy':
    default:
      m = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
        sheen: 0.45, sheenColor: new THREE.Color(0xffffff),
        emissive: new THREE.Color(0x000000), envMapIntensity: 0.7,
      });
      break;
  }

  decorate(m, skin, color, phase01, wild);
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

/** Build one bead (glass also gets an inner slab, the "cat's eye" of a real marble) */
export function makeBead(skin, colorHex, radius, castShadow, phase = -1) {
  const mesh = new THREE.Mesh(SPHERE, makeMaterial(skin, colorHex, phase));
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
  mesh.userData.phase = phase;
  return mesh;
}

/**
 * Reuse an existing bead: a different skin needs a rebuild, a different color or phase is
 * just a different cached material.
 */
export function retintBead(mesh, skin, colorHex, phase = -1) {
  if (mesh.userData.skin !== skin) return false;
  if (mesh.userData.color !== colorHex) {
    if (mesh.userData.core) mesh.userData.core.material = coreMaterial(colorHex);
    mesh.userData.color = colorHex;
    mesh.userData.phase = NaN;                    // color changed, re-resolve the material
  }
  if (mesh.userData.phase !== phase) {
    mesh.material = makeMaterial(skin, colorHex, phase);
    mesh.userData.phase = phase;
  }
  return true;
}

/** Material for the match-3 "ghost" beads: additive, one per instance so opacity can vary */
export function makeGhostMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function ghostGeometry() { return SPHERE; }

/** These skins carry surface detail, so the beads look better slowly rotating */
export const SPINNING_SKINS = new Set(['glass', 'galaxy', 'magma']);
