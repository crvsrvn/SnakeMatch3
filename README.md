# SnakeMatch3

Top-down · LAN multiplayer · **snake meets match-3**. Runs locally; everyone in the house joins from a browser.

> The goal is not to grow. It is to **clear every bead off your own body**. First to zero takes a trophy.

*[中文说明](README.zh-CN.md)*

The interface ships in English and Chinese. It follows the browser language — any Chinese
locale gets Chinese, everything else English — and there is a switch on the login screen.

## Running it

```bash
npm install
```

After that, **the three scripts in `run/` work by double-click** if you would rather not use a terminal:

| Double-click | What it does |
|---|---|
| `run/1-start-server.cmd` | Starts the server. One instance per machine; a busy port fails loudly and explains what to do |
| `run/2-open-game.cmd` | Opens the game in your default browser; tells you to start the server first if it is down |
| `run/3-start-and-play.cmd` | Starts the server, waits until it really answers, then opens the browser |

The command-line equivalents:

```bash
npm start                    # server only
node run/run.js client   # browser only
node run/run.js both     # server, then browser
npm test                     # regression tests
npm run stress               # server load test
```

On start it prints the local and LAN addresses. Anything on the same network can join:

```
local: http://localhost:3000
LAN:   http://192.168.x.x:3000
```

No sign-up: type a nickname and you are in (leave it blank and you get `Snake 1`, `Snake 2`, …).
**One address, one profile, one nickname**: trophies and every record belong to the address, nicknames are
unique server-wide, and the login screen warns before you press the button. You may **rename once**
(then it locks) without losing anything; one address can only have one snake on the field at a time.

## What keeps you coming back

The login screen shows your **record card**: overall rank, this week's trophies, best streak, how far the
next unlock is, who overtook you while you were away and who kills you the most. In the arena:

| Mechanic | What it does |
|---|---|
| 👑 Crown | The player with the most trophies in the room wears a crown (ties go to whoever got there last). Killing the crown holder is **regicide**: trophy +1 |
| 🔥 Streak | Wins without dying in between show on the name tag; death resets it, and ending someone's streak is announced to the room |
| Near-win alert | A snake down to 3 beads is announced, lit by a beacon and blinks red on the minimap |
| ⚔ Revenge | Whoever killed you is marked red on the name tag and minimap for 60 s; get them back for a trophy |
| Room events | Every 5 minutes, announced 30 s ahead: **rainbow shower** (wild beads spawn like mad), **double trophies**, **brawl** (everyone cut to 10 beads) |
| Daily tasks | Eat 30 beads / sever 2 tails / one chain, each worth a trophy; the first win of the day pays an extra one |
| Weekly board | Trophies are also counted per week; last week's top three wear 🥇🥈🥉 for a week, and the login screen keeps a hall of fame |
| Milestones | 10 / 20 / 30 / 50 trophies unlock a tail trail, a golden name tag, a bigger death burst and a spawn halo |
| Achievements & titles | Dead heat, rainbow match, triple chain, grafting 20 beads at once, 5-win streak, regicide ×3 … each one unlocks a title you can wear on the name tag |

Every threshold lives in the `retention` section of `config/game.config.js`.

To let people outside your LAN in, see [`docs/networking.md`](docs/networking.md).

## How to play

| Control | Effect |
|---|---|
| `W` `A` `S` `D` | Move (world directions, not relative to your heading) |
| `Shift` | Sprint — but **turning gets noticeably sluggish**; speed has to cost something |
| `Space` | Jump — **eat nothing** mid-air, and clear other snakes' bodies |
| Wheel | Zoom the camera |
| `M` | Mute |

**Rules**

- The map is square and all four edges wrap to the opposite side. The boundary is marked by a glowing wall you simply pass through.
- Eating a colored item **adds** a bead of that color at your head.
- **Three or more of one color in a row clear**, and clears can chain; cleared beads blink in place before they go.
- **Length zero wins.** Trophy +1, a settlement panel for 3 seconds, then you start again somewhere else.
- **Rainbow beads** spawn in clusters on a timer (marked on the minimap) and **count as any color** when matching.
- **Hitting another body** severs them at the point of impact and grafts their tail onto your head — their tail tip becomes your new head, so you drive back out along their old path. A toast tells you whose tail you took and how many beads you gained.
- **Hitting another head** is won by whoever hit more squarely. The winner loses one head bead, the loser dies; a dead heat kills both.
- **Hitting yourself** kills you. Your body can only reach your own head once it is longer than the circumference of your minimum turning circle, so short snakes can circle safely and long ones cannot.
- **Dying** takes your beads with you (only a burst is left behind). You pause in place for 3 seconds behind a panel, then respawn **near where you fell**; the spot is marked with a beam that lingers a few seconds so you can tell what happened.
- **Spawn protection** takes you out of collision entirely — you cannot hit anyone and nobody can hit you. It is shown by a shield around your head, blinking when it is about to run out. If it expires while you are still overlapping someone, it is extended until you are clear.
- No reconnect. Rejoin and you start fresh (trophies are kept).

Eight bead skins to pick from before you enter: glass marble, matte clay, polished metal, neon glow, candy glaze, aurora sheen, deep space, molten rock.

## Technical choices

| Area | Choice | Why |
|---|---|---|
| Rendering | **three.js** (WebGL) | Opens in a browser, nothing to install; PBR materials get the marble look |
| Skin patterns | **Procedural GLSL** | Injected through `onBeforeCompile`; no hand-drawn textures to author or ship |
| Server | **Node.js** + express + ws | Same language as the client, so the rules can be one shared file |
| Network model | **Authoritative server** + pure client interpolation | Positions come only from the server, with no prediction, so nobody sees a different game |
| Transport | **WebSocket / JSON** | A LAN has bandwidth to spare; readability beats compression here |
| Build | **No build step** | Native ES modules plus an import map: edit, reload, done. No bundler |
| Config | **One shared file** | Server and client both read `config/game.config.js`; the client receives it on connect |
| Persistence | **A JSON file** | One record per address (nickname, trophies, weekly, daily, achievements, nemeses); trophies are written atomically at once, counters are coalesced into a write every 2 s. Not worth a database |
| Tests | **Plain Node, headless** | Rules, simulation and interpolation, with no test framework |

## More

- Tunables: [`config/game.config.js`](config/game.config.js) (restart the server to apply)
- Design notes and trade-offs: [`docs/design.md`](docs/design.md) *(Chinese)*
- Protocol, going public, cross-border deployment: [`docs/networking.md`](docs/networking.md) *(Chinese)*
