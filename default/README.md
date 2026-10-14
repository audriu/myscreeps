# default

Self-contained Screeps colony AI. Discovers everything from live game state
(no room names in code), takes over an existing colony, repairs broken bases
and grows every owned room.

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
  helper workers; claiming is gated (all rooms RCL3+, a healthy RCL5+ funder,
  CPU bucket high) and picks 2-source rooms next to owned ones.
- **Traffic**: parked miners are routed around, jammed creeps push idle
  neighbours aside, spawns push creeps off their exits, unreachable targets are
  dropped.

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
