// three.js 场景搭建：渲染器、俯视相机、环境光照、无限网格地面、地图边界。
// 坐标约定：游戏平面 (x, y) -> three (x, height, -y)，这样游戏 +y 就是屏幕上方。

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export function createScene(CONFIG) {
  const MAP = CONFIG.map.size;
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

  // ---- 地面：3x3 张地图大小的网格平面，配合"渲染坐标始终落在相机焦点 ±size/2"实现无缝穿越 ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP * 3, MAP * 3),
    new THREE.MeshStandardMaterial({
      map: gridTexture(renderer, MAP * 3 / CONFIG.map.gridStep),
      color: 0xffffff, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.35,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(MAP / 2, -CONFIG.snake.beadRadius, -MAP / 2);
  ground.receiveShadow = CONFIG.graphics.shadows;
  scene.add(ground);

  // ---- 边界：3x3 份地图轮廓，跨越时始终能看到最近的一份 ----
  const borders = new THREE.Group();
  const pts = [
    new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(MAP, 0.02, 0),
    new THREE.Vector3(MAP, 0.02, -MAP), new THREE.Vector3(0, 0.02, -MAP),
    new THREE.Vector3(0, 0.02, 0),
  ];
  const borderMat = new THREE.LineBasicMaterial({ color: 0x5ad2ff, transparent: true, opacity: 0.55 });
  const borderGeo = new THREE.BufferGeometry().setFromPoints(pts);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const l = new THREE.Line(borderGeo, borderMat);
      l.position.set(i * MAP, -CONFIG.snake.beadRadius + 0.02, -j * MAP);
      borders.add(l);
    }
  }
  scene.add(borders);

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);

  /** 把相机放到焦点(游戏坐标)上方，并让阴影相机跟随 */
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

  return { renderer, labelRenderer, scene, camera, placeCamera, CSS2DObject };
}

/** 程序生成网格贴图：一格一张，深底 + 亮边，靠 RepeatWrapping 铺满整片地面 */
function gridTexture(renderer, repeat) {
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
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
