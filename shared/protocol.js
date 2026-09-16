// WebSocket message types. Every message is JSON: { t: type, ... }
export const C2S = {
  JOIN: 'join',     // { nickname, skin, title }
  INPUT: 'input',   // { dir: angle in radians, sprint: bool }
  JUMP: 'jump',     // {}
  PING: 'ping',     // { c }
};

export const S2C = {
  WELCOME: 'welcome', // { config, profile|null, hall:[], taken:[], defaultNickname, ip, firstVisit }
                      //   profile: { nickname, trophies, renamesLeft, bestStreak, weekly, medal, achievements,
                      //              title, nemesis:{nickname,n}|null, rank, overtakenBy:[] }
  JOINED: 'joined',   // { id, nickname, skin, trophies, title }
  REJECT: 'reject',   // { reason: code, suggestion, taken } entry refused: 'nickname-taken' | 'already-playing'
  STATE: 'state',     // { f:[frame,...], ev:[] } one packet carries several frames; the client only interpolates
  MAP: 'map',         // { size } the map edge changed (a player joined or left); rebuild the ground
  CONFIG: 'config',   // { config } the admin hot-reloaded the config; merge it into the live one
  PROGRESS: 'progress', // { daily, bestStreak, weekly, medal, achievements, title, unlocked:[], tasks:[], bonus }
                        //   sent only to the player it concerns, whenever their progress moved
  PONG: 'pong',       // { c }
};

/** Color id of the wild bead: counts as any color when matching */
export const WILD = -1;

// Event types, shipped alongside STATE and used by the client for effects, sound and toasts
export const EV = {
  EAT: 'eat',       // { p:[x,y,z], c, sid }
  MATCH: 'match',   // { pts:[[x,y,z]..], c, sid }
  HITBODY: 'hit',   // { p:[x,y,z], aid/an attacker, bid/bn victim, n beads actually grafted on }
  HITHEAD: 'clash', // { p:[x,y,z] }
  DEATH: 'death',   // { id, name, by, cause:'self'|'headTie'|'headLost', p:[x,y,z], beads:[[x,y,z,c]..] for the burst only,
                    //   nothing is dropped; tr trophies of the victim; streak the win streak that just ended (if >= 2) }
  RESPAWN: 'spawn', // { id, p:[x,y], tr }
  WIN: 'win',       // { id, name, trophies, gain, streak } gain = trophies this win was worth (bonuses included)
  WILD: 'wild',     // { p:[x,y] } a cluster of wild beads spawned
  REGICIDE: 'regicide', // { by, name } `by` killed the crown holder `name`
  REVENGE: 'revenge',   // { by, name } `by` got back at `name`, who had killed them moments ago
  NEARWIN: 'nearwin',   // { id, name, n } a snake is down to n beads
  ROOMEVENT: 'room',    // { kind, phase:'warn'|'on'|'idle', sec } a room event was announced, began, or ended
};
