// three.js scene setup: renderer, top-down camera, lighting, endless grid ground, and the
// map boundary.
// Coordinate convention: game plane (x, y) -> three (x, height, -y), so game +y is up on
// screen.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createScene(CONFIG) {
  const stage = document.getElementById('stage');

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = CONFIG.graphics.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
  labelRenderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a12);
  scene.fog = new THREE.FogExp2(0x070a12, CONFIG.graphics.fogDensity);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.5, 600);

  scene.add(new THREE.HemisphereLight(0x8fb6ff, 0x060a16, 0.4));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  sun.castShadow = CONFIG.graphics.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  const half = 34;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---- Ground: a grid plane 3x3 maps across. Together with "render coordinates always
  // land within +/- size/2 of the camera focus", this makes wrapping seamless. ----
  const ground = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      map: gridTexture(renderer),
      color: 0xffffff, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.35,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = CONFIG.graphics.shadows;
  scene.add(ground);

  // ---- Boundary: a glowing band on the ground plus a vertical light wall, tiled 3x3 so
  // the nearest one is always in view while crossing. ----
  // Built from whole grid lines rather than nine rectangles: the shared edge between two
  // tiles is drawn once, so it does not add up to double brightness.
  const boundary = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  boundary.position.y = -CONFIG.snake.beadRadius + 0.02;
  boundary.frustumCulled = false;
  scene.add(boundary);

  /** Size the ground and the boundary to the map edge; called again whenever it changes,
   *  which it does with the player count */
  function setMapSize(MAP) {
    ground.geometry.dispose();
    ground.geometry = new THREE.PlaneGeometry(MAP * 3, MAP * 3);
    ground.material.map.repeat.setScalar(MAP * 3 / CONFIG.map.gridStep);
    ground.position.set(MAP / 2, -CONFIG.snake.beadRadius, -MAP / 2);
    boundary.geometry.dispose();
    boundary.geometry = boundaryGeometry(MAP, CONFIG.map.borderHeight, CONFIG.map.borderBand);
  }
  setMapSize(CONFIG.map.size);

  // ---- Bloom is what actually makes the emissive skins and the boundary wall glow. ----
  // With EffectComposer, tone mapping and color space conversion must be left to the final
  // OutputPass; doing them twice washes the picture out.
  const B = CONFIG.graphics.bloom;
  let composer = null;
  let bloom = null;
  if (B && B.enabled) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(devicePixelRatio, 2));
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), B.strength, B.radius, B.threshold,
    );
    // Run the bloom pyramid at a reduced resolution. The final composite is still full
    // resolution and the blur looks identical, but this pass costs scale^2 of the pixels.
    const passSetSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => passSetSize(
      Math.max(1, Math.round(w * B.scale)), Math.max(1, Math.round(h * B.scale)),
    );
    bloom.setSize(innerWidth, innerHeight);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  /** Hot reload of graphics.bloom: the three live knobs; enabled/scale are boot-time */
  function setBloom(b) {
    if (!bloom) return;
    bloom.strength = b.strength;
    bloom.radius = b.radius;
    bloom.threshold = b.threshold;
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);

  /** Put the camera above the focus (in game coordinates) and drag the shadow camera along */
  function placeCamera(fx, fy, distance) {
    const pitch = THREE.MathUtils.degToRad(CONFIG.camera.pitchDeg);
    const h = Math.sin(pitch) * distance;
    const back = Math.cos(pitch) * distance;
    camera.position.set(fx, h, -fy + back);
    camera.lookAt(fx, 0, -fy);
    sun.position.set(fx + 26, 48, -fy + 34);
    sun.target.position.set(fx, 0, -fy);
    sun.target.updateMatrixWorld();
  }

  return { renderer, labelRenderer, scene, camera, placeCamera, setMapSize, setBloom, render, CSS2DObject };
}

/** Procedural grid texture: one cell, dark fill and bright border, tiled by RepeatWrapping;
 *  the caller sets the repeat count */
function gridTexture(renderer) {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#161d31';
  g.fillRect(0, 0, N, N);
  g.strokeStyle = '#4a6ca8';
  g.lineWidth = 3;
  g.strokeRect(0, 0, N, N);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Boundary geometry. Each boundary is a vertical wall that is bright at the base and
 * transparent at the top, plus a ground band that is bright in the middle and fades to
 * either side.
 * Vertex colors under additive blending do the gradient, so no custom shader is needed --
 * a black vertex is simply invisible.
 * Covers the 3x3 tiled extent: x in [-MAP, 2MAP], z in [-2MAP, MAP].
 */
function boundaryGeometry(MAP, h, band) {
  const pos = [];
  const col = [];
  const base = new THREE.Color(0x5ad2ff);
  const push = (p, k) => {
    pos.push(p[0], p[1], p[2]);
    col.push(base.r * k, base.g * k, base.b * k);
  };
  const quad = (a, b, c, d, ka, kb, kc, kd) => {
    push(a, ka); push(b, kb); push(c, kc);
    push(a, ka); push(c, kc); push(d, kd);
  };
  /** One boundary from (x0,z0) to (x1,z1); (nx,nz) is its unit normal on the ground */
  const edge = (x0, z0, x1, z1, nx, nz) => {
    quad([x0, 0, z0], [x1, 0, z1], [x1, h, z1], [x0, h, z0], 0.8, 0.8, 0, 0);
    const ox = nx * band, oz = nz * band;
    quad([x0 - ox, 0, z0 - oz], [x1 - ox, 0, z1 - oz], [x1, 0, z1], [x0, 0, z0], 0, 0, 1, 1);
    quad([x0, 0, z0], [x1, 0, z1], [x1 + ox, 0, z1 + oz], [x0 + ox, 0, z0 + oz], 1, 1, 0, 0);
  };
  for (let i = -1; i <= 2; i++) {
    edge(i * MAP, MAP, i * MAP, -2 * MAP, 1, 0);        // lines of constant x, normal along x
    edge(-MAP, -i * MAP, 2 * MAP, -i * MAP, 0, 1);      // lines of constant z, normal along z
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
