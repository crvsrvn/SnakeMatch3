// 全局可调配置：服务端与客户端共用同一份（客户端在 welcome 消息里收到快照）。
// 修改后重启服务器即可生效。

export const CONFIG = {
  net: {
    port: 3000,
    tickRate: 60,          // 服务器模拟频率(Hz)
    framesPerPacket: 2,    // 每个广播包携带的帧数：客户端只做内插，密集的位置流才不会插值到空
    interpDelayMs: 80,     // 客户端渲染时钟落后量，需大于收包间隔 + 抖动
  },

  map: {
    size: 50,             // 正方形地图边长(世界单位)，四边穿越到对侧
    gridStep: 5,           // 地面网格线间距，必须能整除 size
  },

  snake: {
    beadRadius: 0.6,
    beadSpacing: 0.92,     // 相邻球心距(略小于直径 -> 视觉相连)
    initialLength: 30,      // 出生长度
    maxLength: 300,         // 长度上限(吞并断尾时截断)
    baseSpeed: 8,          // 单位/秒
    sprintMultiplier: 2,// Shift 加速倍率
    turnRate: 5,         // 最大角速度(rad/s) -> 最小转弯半径 = baseSpeed/turnRate
    sprintTurnFactor: 0.3, // 冲刺时角速度乘这个系数：速度更快、转向更钝，冲刺要付出代价
    jumpHeight: 2.4,
    jumpDuration: 0.6,
    jumpCooldown: 1.0,
    jumpClearance: 1.1,    // 两颗珠高度差超过此值视为跨过，不判碰撞
    hitFactor: 0.92,       // 碰撞距离 = (r1+r2)*hitFactor
    spawnInvulnerable: 1.5,// 出生保护(秒)
    selfCollision: 'die',  // 'die' 撞自己死亡重生 | 'none' 不判定
    selfCollisionMinIndex: 4, // 从第几节开始算自撞
    headOnTieEpsilon: 0.08,   // 头对头"正前方程度"差小于此值视为势均力敌，双方同归于尽

    deathPauseSec: 3,      // 死亡后原地停顿多久再重生
    respawnNearRadius: 12, // 在死亡点多大半径内重生（要保证能看见死亡点标记）
    deathMarkerSec: 3,     // 重生后死亡点标记还显示多久
  },

  // 珠子颜色种类：增删这个数组即可改变颜色数量
  colors: ['#ff4d5a', '#ffae43', '#e9ff3f', '#4ce060', '#4cd6e0', '#3d49f0', '#cc4ce0'],

  items: {
    count: 25,             // 地图上随机补充到的普通道具数量（不含万能珠与死亡掉落）
    maxOnMap: 50,          // 场上道具总上限，防止极端情况堆积
    radius: 0.55,
    minSpawnDistance: 6,   // 随机生成时与任意蛇珠的最小距离
    // 万能珠：定时成簇刷新，可当作任意颜色参与三消，未被消除前一直是彩虹色
    wild: {
      intervalSec: 30,     // 每隔多久刷一簇
      clusterSize: 2,      // 一簇几颗
      spread: 5,         // 簇的半径
      maxOnMap: 5,        // 场上万能珠上限，超过则跳过本次刷新
    },
  },

  ai: {
    count: 10,              // AI 蛇数量，昵称固定为 bot1 / bot2 ...
    turnIntervalMin: 0.5,
    turnIntervalMax: 2.2,
    maxTurnDelta: 1.8,     // 每次随机转向的最大幅度(rad)
    lookAhead: 3.5,        // 自撞预判距离
  },

  camera: {
    distance: 28,          // 相机到蛇头的距离
    minDistance: 16,
    maxDistance: 64,
    pitchDeg: 64,          // 俯角(90 = 正俯视)
    fov: 55,
    followLerp: 0.14,      // 焦点跟随平滑系数(每帧, 已按 60fps 归一)
  },

  board: {
    maxRows: 30,           // 排行榜最多显示几行（自己一定在内）
    updateHz: 5,           // 排行榜刷新频率，没必要跟着渲染帧走
  },

  minimap: {
    size: 184,             // 小地图边长(px)
    dotSize: 3.4,
  },

  graphics: {
    maxFps: 60,            // 客户端渲染上限，高刷屏也不会跑超
    cullMargin: 12,        // 可见半径 = 相机距离*1.5 + 该值；之外的蛇与道具不进渲染队列
    labelRadius: 30,       // 超出这个距离就不画昵称牌，人一多屏幕会被名字糊满
    beadSegments: [16, 11],// 珠子球体的经纬分段：面数直接乘在珠子总数上，人多时最敏感
    shadows: true,
    fogDensity: 0.009,
  },

  skins: ['glass', 'matte', 'metal', 'neon', 'candy', 'aurora', 'galaxy', 'magma'],
  defaultSkin: 'glass',

  profiles: {
    historyPerIp: 8,       // 每个 IP 记住多少个历史昵称供快捷选择
  },
};

export const SKIN_LABELS = {
  glass: '玻璃珠',
  matte: '哑光陶土',
  metal: '抛光金属',
  neon: '霓虹发光',
  candy: '糖果釉面',
  aurora: '极光虹彩',
  galaxy: '深空星河',
  magma: '熔岩裂纹',
};

// 压测用的临时覆盖，正常游玩不需要：SM3_AI=100 SM3_MAP=380 npm start
if (typeof process !== 'undefined' && process.env) {
  if (process.env.SM3_AI) CONFIG.ai.count = Number(process.env.SM3_AI);
  if (process.env.SM3_MAP) CONFIG.map.size = Number(process.env.SM3_MAP);
  if (process.env.SM3_ITEMS) CONFIG.items.count = Number(process.env.SM3_ITEMS);
}
