// UI text in Chinese and English.
//
// The language is picked from the browser -- any zh-* tag (Simplified or Traditional)
// gets Chinese, everything else English -- and can be overridden on the login screen.
// The choice is remembered in localStorage.
//
// Strings that wrap a live value (a countdown, a nickname) are split into a `Pre` and a
// `Post` half rather than interpolated, because the element in the middle carries an id
// the HUD keeps a reference to: rewriting its parent's innerHTML would invalidate it.

const STRINGS = {
  zh: {
    'app.title': 'Snake Match 3 · 贪吃蛇三消对战',

    'lang.zh': '中文',
    'lang.en': 'English',

    'hud.msPerFrame': 'ms/帧',
    'hud.latency': '延迟',
    'hud.online': '在线 {n}',
    'hud.remaining': '剩余长度',
    'hud.remainingTip': '— 归零即获胜',

    'rules.head': '规则',
    'rules.goalK': '目标',
    'rules.goalV': '把自己的珠子全部消完，夺一座奖杯',
    'rules.matchK': '三消',
    'rules.matchV': '三颗同色相连即消除，<i>彩虹珠</i>可当任意颜色',
    'rules.bodyK': '撞身体',
    'rules.bodyV': '从撞击点切断对方，断尾接到自己头前',
    'rules.headK': '撞头',
    'rules.headV': '撞得更"正"的赢，势均力敌则同归于尽',
    'rules.selfK': '撞自己',
    'rules.selfV': '死亡；地图四边可穿越到对侧',

    'hint.move': '<b>WASD</b> 移动 · <b>Shift</b> 加速（转向变钝） · <b>空格</b> 跳跃（滞空不吃珠、可越过蛇身）',
    'hint.misc': '<b>滚轮</b> 缩放 · <b>M</b> 静音',

    'tut.title': '新手教程',
    'tut.ok': '确定',

    'death.title': '被淘汰',
    // {who} is 你 or a name; {by} the other snake. English also gets {whose} (your / their)
    'death.self': '{who}撞到了自己的身体',
    'death.headTie': '{who}与 {by} 迎面撞头，势均力敌，同归于尽',
    'death.headLost': '{who}与 {by} 迎面撞头，对方撞得更正',
    'death.you': '你',
    'death.cdPre': '',
    'death.cdPost': '秒后在死亡点附近重生',

    'win.title': '珠子清空！',
    'win.trophyPre': '· 累计',
    'win.trophyPost': '座',
    'win.cdPre': '',
    'win.cdPost': '秒后换个位置重新开局',

    'login.sub': '俯视角 · 局域网对战 · 贪吃蛇三消<br>把自己的珠子全部消完就赢一座奖杯',
    'login.nickname': '昵称',
    'login.nickPlaceholder': '输入昵称',
    'login.skin': '皮肤',
    'login.skinLocked': '🏆 {n} 解锁',
    'login.connecting': '连接中…',
    'login.play': '进入战场',
    'login.joining': '进入中…',
    'login.disconnected': '连接已断开',
    'login.footIp': '你的地址 {ip} · 一个地址一个昵称，奖杯与战绩都记在它名下',
    'login.footClosed': '服务器连接断开，刷新页面重新进入（不支持断线重连）',
    'login.footError': '无法连接服务器，请确认本地服务器已启动',
    'login.hintTaken': '「{name}」已经有人在用，换一个吧',
    'login.hintEmpty': '留空则自动分配一个名字',
    'login.rejectTaken': '昵称「{name}」已经有人在用',
    'login.renamed': '，已替你改成「{name}」',

    'toast.welcome': '欢迎，{name}！消完全部珠子即可夺杯',
    'toast.muted': '已静音',
    'toast.unmuted': '已取消静音',
    'toast.severed': '接上了 {name} 的断尾 · +{n} 颗珠子',
    'toast.wild': '彩虹珠出现了！可当作任意颜色（看小地图）',
    'toast.winOther': '{name} 清空珠子，夺得第 {trophies} 座奖杯',

    // ---- 留存玩法 ----
    'login.hintRename': '还可以改名 {n} 次：改动后点「进入战场」即生效，之后不能再改',
    'login.hintLocked': '昵称已锁定，不能再改名',
    'login.rejectPlaying': '这个地址已经在游戏中，同一地址同时只能有一条蛇',
    'login.record': '战绩',
    'login.recRank': '总榜第 {rank} · 🏆 {n}',
    'login.recWeek': '本周 +{n}',
    'login.recStreak': '最高连胜 {n}',
    'login.medal1': '🥇 上周冠军',
    'login.medal2': '🥈 上周亚军',
    'login.medal3': '🥉 上周季军',
    'login.nextUnlock': '再 {n} 座奖杯解锁「{what}」',
    'login.allUnlocked': '全部里程碑已解锁',
    'login.overtaken': '你离开后被 {names} 超过了，现在总榜第 {rank}',
    'login.nemesis': '{name} 已经撞死你 {n} 次了，去报仇',
    'login.title': '称号',
    'login.noTitle': '不显示称号',
    'login.hall': '荣誉墙 · 每周前三',
    'login.hallEmpty': '还没有人登上周榜，本周第一个归零的人就是',
    'login.week': '{y} 年第 {w} 周',
    'ms.trail': '尾部拖尾粒子',
    'ms.frame': '金色名牌',
    'ms.burst': '强化死亡爆炸',
    'ms.spawn': '出生光环',

    'hud.daily': '今日任务',
    'hud.taskEat': '吃珠',
    'hud.taskSever': '截断',
    'hud.taskChain': '连锁',
    'hud.firstWin': '首胜 ×2 待领',
    'hud.firstWinDone': '首胜已领',
    'hud.streak': '{n} 连胜',

    'room.rainbow': '彩虹雨',
    'room.double': '双倍奖杯',
    'room.brawl': '大乱斗',
    'room.desc.rainbow': '彩虹珠疯狂刷新',
    'room.desc.double': '归零得 2 座奖杯',
    'room.desc.brawl': '全员截到 {n} 颗，抢！',
    'room.warn': '{sec}s 后：{kind}',
    'room.on': '{kind} · 剩余 {sec}s',
    'toast.roomWarn': '{sec} 秒后：{kind} — {desc}',
    'toast.roomOn': '{kind}开始！{desc}',
    'toast.roomEnd': '{kind}结束',

    'toast.crown': '{name} 戴上了皇冠 👑',
    'toast.crownMe': '你戴上了皇冠 👑 全场都在盯着你',
    'toast.regicide': '⚔ {by} 弑君！终结了 {name} 的统治 · 奖杯 +1',
    'toast.regicideMe': '⚔ 你弑君了！终结 {name} 的统治 · 奖杯 +1',
    'toast.revenge': '{by} 向 {name} 复仇成功 · 奖杯 +1',
    'toast.revengeMe': '复仇成功！{name} 血债血偿 · 奖杯 +1',
    'toast.nemesisMark': '{name} 撞死了你 · {sec} 秒内撞回去可得复仇奖杯',
    'toast.nearWin': '{name} 只剩 {n} 颗珠子，快去拦截！',
    'toast.nearWinMe': '只差 {n} 颗！小心别人来拦',
    'toast.streakEnd': '{by} 终结了 {name} 的 {n} 连胜',
    'toast.streakEndSelf': '{name} 的 {n} 连胜终结于自己',
    'toast.streakEndMe': '你的 {n} 连胜被 {by} 终结了',
    'toast.taskDone': '每日任务完成：{task} · 奖杯 +1',
    'toast.firstWin': '每日首胜！额外奖杯 +{n}',
    'toast.unlock': '成就解锁：{name} · 称号「{title}」可在登录页选用',

    'win.gainPre': '奖杯 +',
    'win.streak': '🔥 {n} 连胜',
    'death.stats': '这条命最短到 {min} 颗 · 吃了 {eat} 颗 · 截断 {sever} 次',
    'death.nearMiss': '离胜利只差 {min} 颗！',

    'ach.firstWin': '首胜',
    'ach.streak5': '5 连胜',
    'ach.tie': '同归于尽',
    'ach.wildMatch': '彩虹三消',
    'ach.bigGraft': '一次接上 {n} 颗断尾',
    'ach.chain3': '三重连锁',
    'ach.regicide3': '弑君 3 次',
    'ach.revenge': '复仇成功',
    'title.firstWin': '初出茅庐',
    'title.streak5': '连战连捷',
    'title.tie': '玉石俱焚',
    'title.wildMatch': '七彩',
    'title.bigGraft': '断尾大盗',
    'title.chain3': '连锁反应',
    'title.regicide3': '弑君者',
    'title.revenge': '复仇者',

    'skin.glass': '玻璃珠',
    'skin.matte': '哑光陶土',
    'skin.metal': '抛光金属',
    'skin.neon': '霓虹发光',
    'skin.candy': '糖果釉面',
    'skin.aurora': '极光虹彩',
    'skin.galaxy': '深空星河',
    'skin.magma': '熔岩裂纹',
  },

  en: {
    'app.title': 'Snake Match 3',

    'lang.zh': '中文',
    'lang.en': 'English',

    'hud.msPerFrame': 'ms/f',
    'hud.latency': 'ping',
    'hud.online': '{n} online',
    'hud.remaining': 'Beads left',
    'hud.remainingTip': '— clear them all to win',

    'rules.head': 'Rules',
    'rules.goalK': 'Goal',
    'rules.goalV': 'Clear every bead on your body to take a trophy',
    'rules.matchK': 'Match 3',
    'rules.matchV': 'Three of a color in a row clear; a <i>rainbow bead</i> counts as any color',
    'rules.bodyK': 'Hit a body',
    'rules.bodyV': 'Cut them at the impact point and graft the tail onto your head',
    'rules.headK': 'Hit a head',
    'rules.headV': 'The straighter hit wins; a dead heat kills both',
    'rules.selfK': 'Hit yourself',
    'rules.selfV': 'You die. All four map edges wrap to the opposite side',

    'hint.move': '<b>WASD</b> move · <b>Shift</b> sprint (turns get sluggish) · <b>Space</b> jump (eat nothing mid-air, clear other snakes)',
    'hint.misc': '<b>Wheel</b> zoom · <b>M</b> mute',

    'tut.title': 'How to play',
    'tut.ok': 'OK',

    'death.title': 'ELIMINATED',
    'death.self': '{who} ran into {whose} own body',
    'death.headTie': '{who} and {by} hit head-on, a dead heat: both out',
    'death.headLost': '{who} lost a head-on with {by}, who hit straighter',
    'death.you': 'You',
    'death.cdPre': 'Respawning near where you fell in',
    'death.cdPost': 's',

    'win.title': 'ALL CLEAR!',
    'win.trophyPre': '· total',
    'win.trophyPost': '',
    'win.cdPre': 'Starting over somewhere else in',
    'win.cdPost': 's',

    'login.sub': 'Top-down · LAN multiplayer · snake meets match-3<br>Clear every bead on your body to win a trophy',
    'login.nickname': 'Nickname',
    'login.nickPlaceholder': 'Enter a nickname',
    'login.skin': 'Skin',
    'login.skinLocked': 'Unlocks at 🏆 {n}',
    'login.connecting': 'Connecting…',
    'login.play': 'Enter the arena',
    'login.joining': 'Joining…',
    'login.disconnected': 'Disconnected',
    'login.footIp': 'Your address is {ip} · one nickname per address; trophies and records belong to it',
    'login.footClosed': 'Connection lost. Reload the page to rejoin (there is no reconnect).',
    'login.footError': 'Cannot reach the server. Check that it is running.',
    'login.hintTaken': '"{name}" is already taken, pick another one',
    'login.hintEmpty': 'Leave it blank and a name will be assigned',
    'login.rejectTaken': 'The nickname "{name}" is already taken',
    'login.renamed': ', renamed you to "{name}"',

    'toast.welcome': 'Welcome, {name}! Clear all your beads to take a trophy',
    'toast.muted': 'Muted',
    'toast.unmuted': 'Unmuted',
    'toast.severed': "Grafted {name}'s tail · +{n} beads",
    'toast.wild': 'A rainbow bead appeared! It counts as any color (see the minimap)',
    'toast.winOther': '{name} cleared their beads and took trophy #{trophies}',

    // ---- Retention features ----
    'login.hintRename': 'You can still rename {n} time(s): change it and press Enter the arena; after that it is locked',
    'login.hintLocked': 'Nickname locked, no more renames',
    'login.rejectPlaying': 'This address is already in the game; one snake per address at a time',
    'login.record': 'Record',
    'login.recRank': 'Rank #{rank} · 🏆 {n}',
    'login.recWeek': 'this week +{n}',
    'login.recStreak': 'best streak {n}',
    'login.medal1': "🥇 last week's champion",
    'login.medal2': "🥈 last week's runner-up",
    'login.medal3': "🥉 last week's third",
    'login.nextUnlock': '{n} more trophies unlock "{what}"',
    'login.allUnlocked': 'Every milestone unlocked',
    'login.overtaken': 'While you were away {names} overtook you; you are now #{rank}',
    'login.nemesis': '{name} has killed you {n} times. Get even',
    'login.title': 'Title',
    'login.noTitle': 'No title',
    'login.hall': 'Hall of fame · weekly top 3',
    'login.hallEmpty': 'Nobody on the weekly board yet; the first clear this week gets there',
    'login.week': '{y} week {w}',
    'ms.trail': 'tail particle trail',
    'ms.frame': 'golden name tag',
    'ms.burst': 'bigger death burst',
    'ms.spawn': 'spawn halo',

    'hud.daily': 'Daily tasks',
    'hud.taskEat': 'eat',
    'hud.taskSever': 'sever',
    'hud.taskChain': 'chain',
    'hud.firstWin': 'first win ×2 pending',
    'hud.firstWinDone': 'first win claimed',
    'hud.streak': '{n} win streak',

    'room.rainbow': 'Rainbow shower',
    'room.double': 'Double trophies',
    'room.brawl': 'Brawl',
    'room.desc.rainbow': 'rainbow beads spawn like mad',
    'room.desc.double': 'a clear is worth 2 trophies',
    'room.desc.brawl': 'everyone cut to {n} beads, scramble!',
    'room.warn': '{kind} in {sec}s',
    'room.on': '{kind} · {sec}s left',
    'toast.roomWarn': '{kind} in {sec}s — {desc}',
    'toast.roomOn': '{kind} started! {desc}',
    'toast.roomEnd': '{kind} is over',

    'toast.crown': '{name} wears the crown 👑',
    'toast.crownMe': 'You wear the crown 👑 everyone is coming for you',
    'toast.regicide': '⚔ Regicide! {by} ended the reign of {name} · trophy +1',
    'toast.regicideMe': '⚔ Regicide! You ended the reign of {name} · trophy +1',
    'toast.revenge': '{by} got even with {name} · trophy +1',
    'toast.revengeMe': 'Revenge! {name} paid for it · trophy +1',
    'toast.nemesisMark': '{name} killed you · get them back within {sec}s for a revenge trophy',
    'toast.nearWin': '{name} is down to {n} beads, intercept!',
    'toast.nearWinMe': 'Only {n} to go! Watch out for interceptors',
    'toast.streakEnd': '{by} ended the {n}-win streak of {name}',
    'toast.streakEndSelf': '{name} ended their own {n}-win streak',
    'toast.streakEndMe': '{by} ended your {n}-win streak',
    'toast.taskDone': 'Daily task done: {task} · trophy +1',
    'toast.firstWin': 'First win of the day! Bonus trophy +{n}',
    'toast.unlock': 'Achievement: {name} · title "{title}" is available on the login screen',

    'win.gainPre': 'Trophy +',
    'win.streak': '🔥 {n} win streak',
    'death.stats': 'This life: down to {min} beads · ate {eat} · severed {sever}',
    'death.nearMiss': 'Only {min} bead(s) short of a win!',

    'ach.firstWin': 'First win',
    'ach.streak5': '5 wins in a row',
    'ach.tie': 'Dead heat',
    'ach.wildMatch': 'Rainbow match',
    'ach.bigGraft': 'Graft {n} beads at once',
    'ach.chain3': 'Triple chain',
    'ach.regicide3': 'Regicide ×3',
    'ach.revenge': 'Revenge',
    'title.firstWin': 'Rookie',
    'title.streak5': 'Unstoppable',
    'title.tie': 'Mutual Ruin',
    'title.wildMatch': 'Prismatic',
    'title.bigGraft': 'Tail Thief',
    'title.chain3': 'Chain Reactor',
    'title.regicide3': 'Kingslayer',
    'title.revenge': 'Avenger',

    'skin.glass': 'Glass marble',
    'skin.matte': 'Matte clay',
    'skin.metal': 'Polished metal',
    'skin.neon': 'Neon glow',
    'skin.candy': 'Candy glaze',
    'skin.aurora': 'Aurora sheen',
    'skin.galaxy': 'Deep space',
    'skin.magma': 'Molten rock',
  },
};

const STORE_KEY = 'sm3.lang';

function detect() {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved && STRINGS[saved]) return saved;
  // Any Chinese tag -- zh, zh-CN, zh-Hant, zh-TW -- reads Chinese; everything else English.
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  return tags.some((tag) => tag.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

let lang = detect();
const listeners = new Set();

export function getLang() { return lang; }

export function setLang(next) {
  if (!STRINGS[next] || next === lang) return;
  lang = next;
  localStorage.setItem(STORE_KEY, next);
  applyStatic();
  for (const fn of listeners) fn(lang);
}

/** Called after every language change, for text this module cannot reach on its own */
export function onLangChange(fn) { listeners.add(fn); }

/** Look up a string and fill in {placeholders} */
export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function skinLabel(id) { return t(`skin.${id}`); }

/**
 * Fill in every element tagged in the markup. `data-i18n-html` values are authored here,
 * never user input, so assigning innerHTML is safe.
 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  document.title = t('app.title');
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}
