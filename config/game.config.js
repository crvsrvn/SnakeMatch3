// 可调参数，服务端与客户端共用（客户端在 welcome 消息里收到一份快照）。
// 服务器运行中修改后双击 run/6-reload.cmd 即可热更新；net 段（端口、tick）需重启，
// 客户端构建期字段（graphics.shadows/bloom/beadSegments 等）需刷新页面。

export const CONFIG = {
  net: {
    port: 3000,
    tickRate: 60,          // 服务端模拟频率（Hz）
    framesPerPacket: 2,    // 每次广播打包的帧数：客户端只做插值，所以位置流必须足够密，
                           // 才能在其间插值
    interpDelayMs: 80,     // 客户端渲染时钟落后多少毫秒；必须大于包间隔 + 抖动
  },

  map: {
    size: 100,             // 无玩家时的正方形地图边长（世界单位）；四边都可穿越
    // 每位真人玩家追加的面积（世界单位²）。100² / 10 个机器人 = 每条蛇 1000 是基准密度，
    // 因此每位玩家自带一份场地；算出的边长向上取整到 gridStep 的倍数。道具数也随面积缩放。
    areaPerPlayer: 1000,
    gridStep: 5,           // 地面网格间距；必须能整除 size
    borderHeight: 3.2,     // 边界光墙高度（世界单位）
    borderBand: 0.9,       // 地面发光带的半宽
  },

  snake: {
    beadRadius: 0.6,
    beadSpacing: 0.92,     // 珠心距，略小于直径，让珠子相接
    initialLength: 30,      // 出生时的长度
    maxLength: 300,         // 硬上限，接上断尾时生效
    baseSpeed: 8,          // 单位/秒
    sprintMultiplier: 2,// 按住 Shift 时的速度倍数
    turnRate: 5,         // 最大角速度（rad/s）-> 最小转弯半径 = baseSpeed/turnRate
    sprintTurnFactor: 0.3, // 加速时角速度乘以此系数：更快，但笨拙得多——加速必须有代价
    jumpHeight: 2.4,
    jumpDuration: 0.6,
    jumpCooldown: 1.0,
    jumpClearance: 1.1,    // 高度差超过此值视为越过，不发生碰撞
    hitFactor: 0.92,       // 碰撞距离 = (r1+r2)*hitFactor
    spawnInvulnerable: 1.5,// 出生保护，秒
    invulnGraceMax: 2,     // 保护到期时若仍在重叠，最多再延长这么久
    selfCollision: 'die',  // 'die' = 撞到自己即死亡 | 'none' = 不判定自撞
    selfCollisionMinIndex: 4, // 从第几颗珠子起算自撞
    headOnTieEpsilon: 0.08,   // 撞头"正度"之差小于此值视为势均力敌，双方同归于尽

    deathPauseSec: 3,      // 死亡后原地停留的秒数，之后重生
    respawnNearRadius: 12, // 在死亡点这个半径内重生，让死亡标记看得见
    deathMarkerSec: 3,     // 重生后死亡标记再停留多久
    winPauseSec: 3,        // 获胜后原地停留的秒数，之后重新开局
  },

  // 珠子调色板：增减条目即可改变参与的颜色数
  colors: ['#ff4d5a', '#ffae43', '#e9ff3f', '#4ce060', '#4cd6e0', '#3d49f0', '#cc4ce0'],

  items: {
    count: 25,             // 普通道具补足到这个数量（不含彩虹珠）
    maxOnMap: 50,          // 道具硬上限，避免边缘情况下堆积
    radius: 0.55,
    minSpawnDistance: 6,   // 生成点离任何珠子至少这么远
    // 彩虹珠：按计时成簇生成，三消时可当任意颜色，清除前一直保持彩虹色
    wild: {
      intervalSec: 30,     // 两簇之间的秒数
      clusterSize: 2,      // 每簇的珠子数
      spread: 5,         // 簇半径
      maxOnMap: 5,        // 彩虹珠上限；超过则跳过本次生成
    },
  },

  ai: {
    count: 10,              // 无玩家时的机器人数；每位玩家顶替一个，直到没有为止，
                            // 玩家离开时再补回。固定命名为 bot1 / bot2 / ...
    turnIntervalMin: 0.5,
    turnIntervalMax: 2.2,
    maxTurnDelta: 1.8,     // 每次决策的最大随机转向（弧度）
    lookAhead: 3.5,        // 机器人向前探测自身身体的距离
  },

  camera: {
    distance: 28,          // 相机到蛇头的距离
    minDistance: 16,
    maxDistance: 64,
    pitchDeg: 64,          // 俯仰角（度，90 = 正俯视）
    fov: 55,
    followLerp: 0.14,      // 焦点每帧平滑系数，按 60fps 归一化
    severGlideSec: 1,      // 接上断尾时头部会瞬移到断尾另一端：相机用这么长时间滑过去，而不是直接吸附
  },

  board: {
    maxRows: 30,           // 排行榜行数（你自己总在其中）
    updateHz: 5,           // 排行榜刷新频率；没必要跟随渲染循环
  },

  minimap: {
    size: 184,             // 小地图边长（CSS 像素）
    dotSize: 3.4,
  },

  graphics: {
    maxFps: 60,            // 客户端渲染上限，高刷屏不至于失控
    cullMargin: 12,        // 可见半径 = 相机距离 * 1.5 + 此值；超出者不进入渲染队列
    labelRadius: 30,       // 超过此距离不再绘制名牌，否则满地图都是名字
    beadSegments: [16, 11],// 球体分段：三角形数量随珠子数成倍增长，
                           // 地图拥挤时这是最敏感的开关
    shadows: true,
    fogDensity: 0.009,
    auraScale: 1,          // 珠子光晕粒子数倍率；0 关闭光晕
    flowSpeed: 1.6,        // 流动皮肤的花纹沿身体移动的速度（周期/秒）
    flowSpacing: 1.2,      // 相邻珠子之间的相位步长；越大波长越短
    severFlashSec: 1,    // 接上断尾后扫描波与相机抖动的持续秒数
    eatFlashSec: 0.45,     // 吃珠后新头珠上同样的扫描波，用珠子自身颜色
    eatFlashScale: 1.2,      // 扫描波期间该珠子的峰值放大倍数，1 = 不放大（断尾拼接用 1.55）
    eatFlashOrb: 1.5,        // 该珠子上的发光球半径（单位：珠子半径）；0 = 无光球（断尾拼接用 2）
    // 泛光是让发光皮肤（neon、magma、galaxy、aurora）和边界光墙真正"发光"的关键。
    // 它是一道额外的后处理；GPU 吃力时关掉 `enabled`。
    // strength / radius / threshold 支持热更新；enabled / scale 需刷新页面。
    bloom: {
      enabled: true,
      strength: 0.22,      // 泛光强度：过高会让发光皮肤糊成一团白，刺眼
      radius: 0.4,         // 扩散半径：收窄扩散，光晕更贴合物体轮廓
      // 亮度阈值。EffectComposer 下场景是线性 HDR，被阳光照到的地面约在 0.6-1.0，
      // 所以阈值必须高于 1.0，泛光才只落在发光珠子和边界光墙上。
      threshold: 1.6,
      scale: 0.5,          // 泛光金字塔的分辨率倍率：模糊从不需要全分辨率，
                           // 0.5 把像素数削减到四分之一
    },
  },

  // 按绚丽度分三组排列：免费 / 2 座奖杯 / 5 座奖杯。未列入 skinUnlock 的皮肤免费。
  // 门槛由服务端按玩家档案的奖杯数校验，客户端只负责显示锁。
  skins: ['glass', 'matte', 'metal', 'candy', 'neon', 'aurora', 'galaxy', 'magma'],
  skinUnlock: { candy: 2, neon: 2, aurora: 5, galaxy: 5, magma: 5 },
  defaultSkin: 'glass',

  profiles: {
    maxRenames: 1,         // 一个 IP 一个昵称；允许改名的次数，改完即锁定
  },

  // 留存与在线时长相关的玩法：皇冠、连胜、归零警报、复仇、房间事件、每日/周榜、里程碑
  retention: {
    nearWinBeads: 3,       // 剩余珠子 ≤ 此数时全场警报
    revengeSec: 60,        // 被谁撞死后，多少秒内撞回去算复仇（奖杯 +1）
    regicideBonus: 1,      // 撞死皇冠持有者的奖杯奖励
    revengeBonus: 1,       // 复仇成功的奖杯奖励
    firstWinBonus: 1,      // 每日首胜的额外奖杯
    // 每日任务：达到阈值各 +1 奖杯；chain = 一次消除触发 ≥2 组连锁
    dailyTasks: { eat: 30, sever: 2, chain: 1 },
    // 房间事件：每 intervalSec 一轮，先预告 warnSec，再持续 durationSec
    roomEvents: {
      intervalSec: 300,
      warnSec: 30,
      durationSec: 90,
      kinds: ['rainbow', 'double', 'brawl'],   // 彩虹雨 / 双倍奖杯 / 大乱斗
      rainbowRate: 5,      // 彩虹雨期间彩虹珠生成频率与上限的倍率
      brawlLength: 10,     // 大乱斗开始时全员截到这么长
    },
    // 累计奖杯里程碑解锁的外观：尾部拖尾粒子 / 金色名牌 / 强化死亡爆炸 / 出生光环
    milestones: { trail: 10, frame: 20, burst: 30, spawn: 50 },
    hallWeeks: 8,          // 登录页荣誉墙保留多少周
    bigGraft: 20,          // 成就 bigGraft：一次接上这么多颗断尾
  },
};

// 压测用的临时覆盖，正常游玩不需要：SM3_AI=100 SM3_MAP=380 npm start
if (typeof process !== 'undefined' && process.env) {
  if (process.env.SM3_AI) CONFIG.ai.count = Number(process.env.SM3_AI);
  if (process.env.SM3_MAP) CONFIG.map.size = Number(process.env.SM3_MAP);
  if (process.env.SM3_ITEMS) CONFIG.items.count = Number(process.env.SM3_ITEMS);
}
