# default

Self-contained Screeps colony AI. Discovers everything from live game state
(no room names in code, apart from the temporary `avoidRooms` list in
`config.js`), takes over an existing colony, repairs broken bases and grows
every owned room.

Upload the files in this folder as the `default` branch (Screeps client local
folder sync, or copy them into
`%LOCALAPPDATA%\Screeps\scripts\screeps.com\default\` on Windows). Remove old
modules from the branch first; `main.js` only requires the modules listed below.

## What it does

- **Economy per room**: static miners parked on source containers, haulers
  sized by haul distance, upgraders fed from a controller container or link,
  workers for building and repairs. Bodies scale with the room's energy
  capacity; the spawn waits for energy instead of producing stubs (except in
  emergencies).
- **Base repair**: frees spawns that were boxed in by structures (destroys the
  cheapest chain of extensions/walls), opens walled pockets, removes
  unreachable extensions, prunes RCL-inactive structures that sit off the
  checkerboard grid, reconnects sources to the controller area.
- **Planner**: checkerboard layout around the first spawn, nothing non-walkable
  next to a spawn, containers at sources and controller, towers, storage,
  links, terminal, extra spawns, roads (RCL3+), ramparts on key structures.
- **Defense**: towers focus the most dangerous hostile, heal creeps, repair
  roads/containers and ramparts (fortify only when storage is healthy). Safe
  mode when critical structures take damage, when a tower-less room has
  hostiles at the spawn, or when the controller is attacked.
- **Empire**: couriers carry energy from rich storages into weak neighbours;
  terminals balance energy between RCL6+ rooms; owned rooms without a spawn get
  helper workers; lost rooms that still hold our spawn are claimed back first;
  claiming is gated (all rooms RCL3+, a healthy RCL5+ funder, CPU bucket high)
  and picks 2-source rooms next to owned ones. When GCL is full a lost room
  cannot be reclaimed: the console warns every 1000 ticks, and
  `Memory.empire.release = 'W1N1'` gives a room up (unclaimed, never retaken)
  so the slot goes to the lost room. Every new GCL level is logged and
  emailed with the number of free slots.
- **Traffic**: parked miners are routed around, jammed creeps push idle
  neighbours aside, spawns push creeps off their exits, unreachable targets are
  dropped.
- **War** (`war.js`, role `soldier`): console-driven offence. `Memory.war =
  { muster: true }` makes every room at RCL4+ with a stocked storage keep a
  squad of `config.war.maxPerRoom` soldiers (melee, ranged and healers) and
  replace losses; they idle at home and help defend it. `Memory.war.target =
  'E11N36'` sends them to a rally room (the owned room nearest the target,
  or `Memory.war.rally`), and once most of the wave stands there (or
  `maxGather` ticks pass, or `Memory.war.go = true`) they march in showing a
  public 💀, kill creeps first (healers before fighters), then towers, spawns
  and every other hostile structure, breaching walls when nothing is
  reachable, and hold the room when it is clear. `delete Memory.war.target`
  brings them home; `Memory.war.muster = false` stops spawning and idle
  soldiers recycle. Progress is logged every `logEvery` ticks and the big
  steps (target set, marching, cleared) are emailed. The target may be an
  avoided room: soldiers are the only creeps allowed to path into it.
- **Avoided rooms (temporary)**: `config.avoidRooms` lists rooms creeps must
  not enter, path through, scout, claim or reclaim (currently E11N36, another
  player's tower room between E11N35 and E11N37). `Memory.avoidRooms = [...]`
  overrides the list from the console; `[]` disables it. Remove the config
  entry once the room is safe again.

## Files

| File | Role |
|------|------|
| `main.js` | Game loop, error isolation, logging, pixels |
| `config.js` | Tunables |
| `util.js` | Caches, movement, room helpers, logging |
| `bodies.js` | Body plans by energy budget |
| `roomState.js` | Per-tick room snapshot and creep index |
| `planner.js` | Layout, spawn un-boxing, cleanup |
| `spawner.js` | Population targets and spawning |
| `roles.js` | Creep behaviours |
| `war.js` | Offensive squads: muster, rally, march, clear (Memory.war) |
| `defense.js` | Towers and safe mode |
| `logistics.js` | Links and terminal balancing |
| `empire.js` | Helpers, couriers, scouting, claiming |
| `adopt.js` | Memory migration and legacy creep adoption |

## Console

Every 100 ticks: `rooms=N/GCL creeps=N cpu~X/limit bucket=N`. Every 500 ticks a
line per room (RCL, energy, storage, sites, downgrade timer, creeps by role).
Warnings in orange, errors and safe mode in red.

## Tuning

`config.js`: population caps, courier/terminal thresholds, expansion gating,
planner intervals, `pixels`, `signature`.
