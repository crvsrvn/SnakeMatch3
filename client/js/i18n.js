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

    'death.title': '被淘汰',
    'death.byPre': '败给',
    'death.byPost': '· 珠子已散落原地',
    'death.cdPre': '',
    'death.cdPost': '秒后在死亡点附近重生',

    'win.title': '珠子清空！',
    'win.trophyPre': '奖杯 +1 · 累计',
    'win.trophyPost': '座',
    'win.cdPre': '',
    'win.cdPost': '秒后换个位置重新开局',

    'login.sub': '俯视角 · 局域网对战 · 贪吃蛇三消<br>把自己的珠子全部消完就赢一座奖杯',
    'login.nickname': '昵称',
    'login.nickPlaceholder': '输入昵称',
    'login.skin': '皮肤',
    'login.connecting': '连接中…',
    'login.play': '进入战场',
    'login.joining': '进入中…',
    'login.disconnected': '连接已断开',
    'login.footIp': '你的地址 {ip} · 同一地址可以开多个网页、用不同昵称各玩各的',
    'login.footClosed': '服务器连接断开，刷新页面重新进入（不支持断线重连）',
    'login.footError': '无法连接服务器，请确认本地服务器已启动',
    'login.hintTaken': '「{name}」已经有人在用，换一个吧',
    'login.hintEmpty': '留空则自动分配一个名字',
    'login.chipTaken': '当前有人在用',
    'login.rejectTaken': '昵称「{name}」已经有人在用',
    'login.renamed': '，已替你改成「{name}」',

    'toast.welcome': '欢迎，{name}！消完全部珠子即可夺杯',
    'toast.muted': '已静音',
    'toast.unmuted': '已取消静音',
    'toast.killedBy': '你被 {by} 撞掉了',
    'toast.eliminated': '{name} 被 {by} 淘汰',
    'toast.severed': '接上了 {name} 的断尾 · +{n} 颗珠子',
    'toast.wild': '彩虹珠出现了！可当作任意颜色（看小地图）',
    'toast.winOther': '{name} 清空珠子，夺得第 {trophies} 座奖杯',

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

    'death.title': 'ELIMINATED',
    'death.byPre': 'Beaten by',
    'death.byPost': '· your beads are gone',
    'death.cdPre': 'Respawning near where you fell in',
    'death.cdPost': 's',

    'win.title': 'ALL CLEAR!',
    'win.trophyPre': 'Trophy +1 · total',
    'win.trophyPost': '',
    'win.cdPre': 'Starting over somewhere else in',
    'win.cdPost': 's',

    'login.sub': 'Top-down · LAN multiplayer · snake meets match-3<br>Clear every bead on your body to win a trophy',
    'login.nickname': 'Nickname',
    'login.nickPlaceholder': 'Enter a nickname',
    'login.skin': 'Skin',
    'login.connecting': 'Connecting…',
    'login.play': 'Enter the arena',
    'login.joining': 'Joining…',
    'login.disconnected': 'Disconnected',
    'login.footIp': 'Your address is {ip} · open several tabs from one address and play as different nicknames',
    'login.footClosed': 'Connection lost. Reload the page to rejoin (there is no reconnect).',
    'login.footError': 'Cannot reach the server. Check that it is running.',
    'login.hintTaken': '"{name}" is already taken, pick another one',
    'login.hintEmpty': 'Leave it blank and a name will be assigned',
    'login.chipTaken': 'currently in use',
    'login.rejectTaken': 'The nickname "{name}" is already taken',
    'login.renamed': ', renamed you to "{name}"',

    'toast.welcome': 'Welcome, {name}! Clear all your beads to take a trophy',
    'toast.muted': 'Muted',
    'toast.unmuted': 'Unmuted',
    'toast.killedBy': '{by} took you out',
    'toast.eliminated': '{name} was eliminated by {by}',
    'toast.severed': "Grafted {name}'s tail · +{n} beads",
    'toast.wild': 'A rainbow bead appeared! It counts as any color (see the minimap)',
    'toast.winOther': '{name} cleared their beads and took trophy #{trophies}',

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
