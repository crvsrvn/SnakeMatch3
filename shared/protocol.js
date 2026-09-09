// WebSocket message types. Every message is JSON: { t: type, ... }
export const C2S = {
  JOIN: 'join',     // { nickname, skin }
  INPUT: 'input',   // { dir: angle in radians, sprint: bool }
  JUMP: 'jump',     // {}
  PING: 'ping',     // { c }
};

export const S2C = {
  WELCOME: 'welcome', // { config, nicknames:[], taken:[], defaultNickname, ip }
  JOINED: 'joined',   // { id, nickname, skin, trophies }
  REJECT: 'reject',   // { reason: code, suggestion, taken } entry refused, e.g. nickname taken
  STATE: 'state',     // { f:[frame,...], ev:[] } one packet carries several frames; the client only interpolates
  PONG: 'pong',       // { c }
};

/** Color id of the wild bead: counts as any color when matching */
export const WILD = -1;

// Event types, shipped alongside STATE and used by the client for effects, sound and toasts
export const EV = {
  EAT: 'eat',       // { p:[x,y,z], c }
  MATCH: 'match',   // { pts:[[x,y,z]..], c, sid }
  HITBODY: 'hit',   // { p:[x,y,z], aid/an attacker, bid/bn victim, n beads actually grafted on }
  HITHEAD: 'clash', // { p:[x,y,z] }
  DEATH: 'death',   // { id, name, by, p:[x,y,z], beads:[[x,y,z,c]..] for the burst only, nothing is dropped }
  RESPAWN: 'spawn', // { id, p:[x,y] }
  WIN: 'win',       // { id, name, trophies }
  WILD: 'wild',     // { p:[x,y] } a cluster of wild beads spawned
};
