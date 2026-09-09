// WebSocket 消息类型常量。所有消息为 JSON: { t: 类型, ... }
export const C2S = {
  JOIN: 'join',     // { nickname, skin }
  INPUT: 'input',   // { dir: 角度或 null(不动方向保持), sprint: bool }
  JUMP: 'jump',     // {}
  PING: 'ping',     // { c }
};

export const S2C = {
  WELCOME: 'welcome', // { config, skinLabels, suggestedNickname, ip }
  JOINED: 'joined',   // { id, nickname, skin, trophies }
  STATE: 'state',     // { st, snakes:[], items:[], ev:[] }
  PONG: 'pong',       // { c }
};

// 事件类型（随 STATE 一起下发，客户端用于特效/音效/公告）
export const EV = {
  EAT: 'eat',       // { p:[x,y,z], c: colorIndex }
  MATCH: 'match',   // { pts:[[x,y,z]..], c, sid }
  HITBODY: 'hit',   // { p:[x,y,z] }
  HITHEAD: 'clash', // { p:[x,y,z] }
  DEATH: 'death',   // { name, by }
  WIN: 'win',       // { name, trophies }
};
