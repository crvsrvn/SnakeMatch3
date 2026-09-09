# SnakeMatch3

俯视角 · 局域网多人 · **贪吃蛇 × 三消** 对战。three.js 渲染 + Node 权威服务器，跑在本地即可全屋联机。

> 目标不是变长，而是**把自己身上的珠子全部消完**。先归零者夺得一座奖杯，随即重生。

## 快速开始

```bash
npm install
```

装好之后，**`run/` 里的三个脚本双击就能用**（不想用命令行的话）：

| 双击 | 作用 |
|---|---|
| `run/1-启动服务器.cmd` | 起服务器。本机只允许一个实例，端口被占会直接报错并说明怎么办 |
| `run/2-打开游戏.cmd` | 用默认浏览器打开游戏；服务器没起会提示先去起服务器 |
| `run/3-启动服务器并打开游戏.cmd` | 起服务器，等它真的能连上了再自动开浏览器 |

命令行等价物：`npm start` / `node scripts/run.js client` / `node scripts/run.js both`。

`npm start` 会先复制一份 `node.exe` 成 `.run/SnakeMatch3_Server.exe`，用 `rcedit` 改写它的
**PE 版本资源与图标**，再用它启动。任务管理器有两处名字、来源不同，两处都得改：

| 显示位置 | 取自 | 结果 |
|---|---|---|
| 详细信息页 / `Get-Process` | 文件名 | `SnakeMatch3_Server` |
| 进程页 | 版本资源里的 `FileDescription` | `SnakeMatch3 Server` |

（这是 Electron 把 `electron.exe` 变成自家应用名的同一套做法。只改文件名的话，
进程页仍然显示 "Node.js JavaScript Runtime"。）
只在 Node 版本变化时重做一次；不需要这层包装时用 `npm run start:plain`。

启动后终端会打印本机与局域网地址，同一网络下的任何设备打开即可加入：

```
本机:   http://localhost:3000
局域网: http://192.168.x.x:3000
```

无需注册，填个昵称就进（留空则自动分配 `贪吃蛇1号`、`贪吃蛇2号`…）。
**昵称在场上唯一**：登录框会即时提示已被占用的名字，历史昵称里被占用的会划掉；
即使抢在同一瞬间提交，服务器也会再判一次并把你改名成一个空闲的变体。奖杯按 `IP + 昵称` 记录在 `database/players.json`；
**同一个 IP 开多个网页、用不同昵称，就是多个各自独立的玩家**，可以同时游玩、各记各的奖杯。
每个 IP 用过的昵称会记在登录界面，下次点一下就能选。

## 玩法

| 操作 | 作用 |
|---|---|
| `W` `A` `S` `D` | 移动（世界方向，非相对朝向） |
| `Shift` | 加速 —— 但**转向会明显变钝**（`sprintTurnFactor`），冲刺要付出代价 |
| `空格` | 跳跃 —— 滞空时**不吃道具**、可从别人身上跨过去 |
| 滚轮 | 拉近/拉远相机 |
| `M` | 静音 |

**规则**

- 地图是正方形，四边穿越到对侧。
- 吃到彩色道具，头部**增加**一颗同色珠。
- 身上出现 **3 颗及以上相连同色**即消除，可连锁；被消掉的珠子会先原地闪几下再消失。
- **长度归零 = 获胜**，奖杯 +1 并重新出生。
- **彩虹万能珠**：每隔 30 秒在随机位置成簇刷新（小地图上有标记），**可当作任意颜色**参与三消；没被消掉之前一直保持彩虹色。
- **头撞别人身体**：对方从撞击点断尾，断尾接到你头前，对方的尾端变成你的新头（你会顺着他的旧路径倒着开出去）。
- **头撞头**：比谁撞得更"正"（朝向与指向对方的夹角更小）。胜者头部直接消掉一颗珠，败者死亡；**正得一样则同归于尽**。
- **撞到自己**：死亡。最小转弯半径 = `baseSpeed / turnRate`，**蛇身长度超过这个圆的周长时才可能咬到自己**——短蛇转圈是安全的，长蛇才需要小心。冲刺时半径还会再乘 `1/sprintTurnFactor`。
- **死亡**：珠子随蛇一起消失（只留一圈炸开的特效），原地停顿 3 秒并弹出死亡面板，然后在**死亡点附近**重生；死亡点会用光柱标记，重生后再保留 3 秒，方便你判断刚才发生了什么。
- 断线不重连，重进即重新开始（奖杯保留）。

## 配置

所有可调参数集中在根目录的 [`config/game.config.js`](config/game.config.js)，改完重启服务器生效（客户端会随 welcome 消息自动拿到同一份）：

```
map.size              地图边长
snake.baseSpeed       速度          snake.sprintMultiplier  冲刺倍率
snake.turnRate        转向角速度    snake.sprintTurnFactor  冲刺时角速度打几折
snake.initialLength   初始长度      snake.maxLength         长度上限
snake.deathPauseSec   死亡停顿      snake.respawnNearRadius 重生半径
colors[]              颜色种类（增删数组即可）
items.count           普通道具数量  items.wild.*            万能珠刷新间隔/簇大小/上限
ai.count              AI 数量（昵称固定为 bot1 / bot2 …）
camera.distance       相机距离      camera.pitchDeg         俯角
minimap.size          小地图大小    board.maxRows           排行榜行数上限
net.tickRate          模拟频率      net.framesPerPacket     每包携带几帧位置
net.interpDelayMs     客户端插值缓冲
graphics.maxFps       客户端帧率上限（高刷屏也不会跑超）
graphics.cullMargin   可见半径余量：范围外的蛇与道具不进渲染队列
graphics.labelRadius  超出这个距离就不画昵称牌
graphics.beadSegments 珠子球体分段数（人多时最影响渲染开销）
graphics.shadows      阴影开关（性能不足时关掉）
```

默认值按"平均同时 4 人在线"调校，取舍理由见 [设计文档](docs/design.md#7-平衡性初值预计同时-4-人在线)。

## 皮肤

8 种，进场前选择，万能珠在任何皮肤下都是彩虹色：

| 皮肤 | 做法 |
|---|---|
| 玻璃珠 | 半透外壳 + 一枚压扁的内芯，模仿真弹珠里的"猫眼" |
| 哑光陶土 / 抛光金属 / 糖果釉面 | 纯 PBR 参数（粗糙度、金属度、清漆、绒感）|
| 霓虹发光 | 本体压暗 + 自发光拉满 |
| **极光虹彩** | `iridescence` 薄膜干涉，颜色随视角在虹彩间滑动 |
| **深空星河** | 程序生成的星点/星云贴图做自发光，珠子缓慢自转 |
| **熔岩裂纹** | 程序生成的分叉裂纹贴图，裂纹按珠子本色发光 |

## 测试

```bash
npm test            # 规则 + 模拟 + 插值三组回归测试
npm run stress      # 100 条 AI 的服务器压测（可加参数：node tests/stress.js 蛇数 地图边长）
```

- `tests/sim.js` — 无头压力测试：12 条 AI 挤在缩小的地图里跑 120 秒，校验坐标、珠间距连续性、
  长度上限、死亡停顿状态、死亡/重生配对等不变量，并统计各类事件与带宽峰值。
- `tests/interp.js` — 客户端插值测试：用到达时刻带抖动的合成包流驱动真实的 `client/js/net.js`，
  校验渲染时钟单调、无突跳帧/卡顿帧（历史上这两条各对应一个真实 bug）。
- `tests/stress.js` — 服务器压测：量单帧耗时分布、各阶段占比、真实时钟下的 tick 率与带宽。
  结论见 [设计文档 §12](docs/design.md#12-性能与压测)。

## 目录

```
config/    game.config.js —— 所有可调参数
run/       双击即用的启动脚本
scripts/   run.js 单实例检查与开浏览器 / start.js + serverExe.js 进程改名
database/  players.json   —— 昵称与奖杯（运行时生成）
shared/    协议、环面数学（服务端与浏览器共用）
server/    world 权威模拟 / snake 轨迹模型 / match3 / ai / profiles
client/    three.js 渲染、皮肤、特效、音效、小地图、HUD
docs/      设计文档与 PlantUML 图
tests/     无头回归测试
```

- 实现细节与设计取舍：[`docs/design.md`](docs/design.md)
- 双端通信协议详解、公网化方案、跨境部署、公网可达最小清单：[`docs/networking.md`](docs/networking.md)
