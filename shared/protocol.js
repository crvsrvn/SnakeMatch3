// WebSocket 消息类型常量。所有消息为 JSON: { t: 类型, ... }
export const C2S = {
  JOIN: 'join',     // { nickname, skin }
  INPUT: 'input',   // { dir: 角度, sprint: bool }
  JUMP: 'jump',     // {}
  PING: 'ping',     // { c }
};

export const S2C = {
  WELCOME: 'welcome', // { config, skinLabels, nicknames:[], ip }
  JOINED: 'joined',   // { id, nickname, skin, trophies }
  STATE: 'state',     // { f:[帧,...], ev:[] } —— 一个包携带多帧位置，客户端只做内插
  PONG: 'pong',       // { c }
};

/** 万能珠的颜色编号：可当作任意颜色参与三消 */
export const WILD = -1;

// 事件类型（随 STATE 一起下发，客户端用于特效/音效/公告）
export const EV = {
  EAT: 'eat',       // { p:[x,y,z], c }
  MATCH: 'match',   // { pts:[[x,y,z]..], c, sid }
  HITBODY: 'hit',   // { p:[x,y,z] }
  HITHEAD: 'clash', // { p:[x,y,z] }
  DEATH: 'death',   // { id, name, by, p:[x,y,z], drops:[[x,y,z,c]..] }
  RESPAWN: 'spawn', // { id, p:[x,y] }
  WIN: 'win',       // { id, name, trophies }
  WILD: 'wild',     // { p:[x,y] } 万能珠簇刷新
};
