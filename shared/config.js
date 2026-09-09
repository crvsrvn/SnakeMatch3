// 全局可调配置：服务端与客户端共用同一份，保证规则一致。
// 修改后重启服务器即可生效（客户端在 welcome 消息里收到同一份快照）。
export const CONFIG = {
  net: {
    port: 3000,
    tickRate: 30,          // 服务器模拟 + 广播频率(Hz)
    interpDelayMs: 80,     // 客户端插值缓冲，越大越平滑、越迟钝；需大于收包间隔抖动
  },

  map: {
    size: 110,             // 正方形地图边长(世界单位)，四边穿越到对侧
    gridStep: 5,           // 地面网格线间距，必须能整除 size
  },

  snake: {
    beadRadius: 0.6,
    beadSpacing: 0.92,     // 相邻球心距(略小于直径 -> 视觉相连)
    initialLength: 6,      // 出生长度
    maxLength: 40,         // 长度上限(吞并断尾时截断)
    baseSpeed: 8,          // 单位/秒
    sprintMultiplier: 1.75,// Shift 加速倍率
    turnRate: 3.2,         // 最大角速度(rad/s) -> 最小转弯半径 = baseSpeed/turnRate
    jumpHeight: 2.4,
    jumpDuration: 0.6,
    jumpCooldown: 1.0,
    jumpClearance: 1.1,    // 两颗珠高度差超过此值视为跨过，不判碰撞
    hitFactor: 0.92,       // 碰撞距离 = (r1+r2)*hitFactor
    spawnInvulnerable: 1.5,// 出生保护(秒)
    selfCollision: 'die',  // 'die' 撞自己死亡重生 | 'none' 不判定
    selfCollisionMinIndex: 4, // 从第几节开始算自撞
    headOnTieEpsilon: 0.08,   // 头对头"正前方程度"差小于此值视为势均力敌，双方同归于尽
  },

  // 珠子颜色种类：增删这个数组即可改变颜色数量
  colors: ['#ff4d5a', '#43a8ff', '#ffd23f', '#4ce07a'],

  items: {
    count: 24,             // 地图上随机补充到的道具数量
    maxOnMap: 90,          // 含死亡掉落在内的道具总上限，防止极端情况堆积
    radius: 0.55,
    minSpawnDistance: 6,   // 随机生成时与任意蛇珠的最小距离
  },

  ai: {
    count: 4,              // AI 蛇数量
    turnIntervalMin: 0.5,
    turnIntervalMax: 2.2,
    maxTurnDelta: 1.8,     // 每次随机转向的最大幅度(rad)
    lookAhead: 3.5,        // 自撞预判距离
    names: ['小青', '阿黄', '滚滚', '球球', '闪电', '芝麻', '汤圆', '弹壳'],
  },

  camera: {
    distance: 28,          // 相机到蛇头的距离
    minDistance: 16,
    maxDistance: 64,
    pitchDeg: 64,          // 俯角(90 = 正俯视)
    fov: 55,
    followLerp: 0.14,      // 焦点跟随平滑系数(每帧, 已按 60fps 归一)
  },

  graphics: {
    shadows: true,
    fogDensity: 0.009,
  },

  skins: ['glass', 'matte', 'metal', 'neon', 'candy'],
  defaultSkin: 'glass',
};

export const SKIN_LABELS = {
  glass: '玻璃珠',
  matte: '哑光陶土',
  metal: '抛光金属',
  neon: '霓虹发光',
  candy: '糖果釉面',
};
