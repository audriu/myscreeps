# AGENTS.md

Instructions for coding agents working in this repository.

## Environment & Account

- **Game**: [Screeps](https://screeps.com/), account `Dzioba`.
- **Active shard**: `shard1` (home room `W49N25`). `shard0` was abandoned on 2026-11-02; all rooms there are gone.
- **Output rule**: Do not create or publish Artifacts. Give output in the terminal or as regular repository files only.

## Repository Layout

- `default/` — self-contained Screeps colony AI (CommonJS modules, no external runtime dependencies). See [default/README.md](default/README.md) for full behaviour, console commands, and configuration tables.
  - `main.js` — game loop (`module.exports.loop`), per-stage `guard()` error isolation, periodic console summaries, pixel generation.
  - `config.js` — all tunables (population caps, planner, defense, links, war, courier, terminal, expansion, reclaim, CPU thresholds).
  - `util.js` — caches, movement/traffic (`travel`: room routes and exit waypoints for trips to other rooms), room helpers, logging.
  - `bodies.js` — body plans scaled to room energy budget.
  - `roomState.js` — per-tick room snapshot, structure index, creep index, and loot discovery (`findLoot`).
  - `planner.js` — checkerboard layout around the first spawn, spawn un-boxing, road/rampart placement (key structures and the min-cut perimeter), cleanup of off-grid inactive structures.
  - `mincut.js` — max-flow minimum cut between room exits and the base: the perimeter rampart tiles.
  - `spawner.js` — population targets and priority-ordered spawning.
  - `roles.js` — creep behaviours (`miner`, `hauler`, `upgrader`, `worker`, `defender`, `claimer`, `courier`, `scout`, the remote roles, `mineralMiner`, `chemist`, plus war roles).
  - `war.js` — console-driven offence via `Memory.war` (`soldier` and `unclaimer` roles, muster, rally, march, the squad's way into the target (`plan`: walk around or break the weakest wall), closest-first clearing, final sweep, controller strikes).
  - `defense.js` — tower targeting/healing/repairing, safe mode triggers, worker rampart fortification thresholds.
  - `logistics.js` — source/controller/storage links and cross-room terminal energy balancing.
  - `empire.js` — cross-room helpers, couriers, scouting, automatic and manual claiming (`Memory.empire.claim`), reclaiming lost rooms, room release (`Memory.empire.release`).
  - `remote.js` — remote mining of unowned neighbour rooms (`Memory.empire.remotes`): room choice, spawn requests for `remoteMiner`, `remoteHauler`, `reserver` and `guard`, retreat from invaders.
  - `industry.js` — the hub (`Memory.empire.hub`), mineral mining, the terminal network, labs (reactions, upgrade and war boosts), the factory, and the carry jobs for `chemist` and idle haulers (`moves`).
  - `adopt.js` — one-time `Memory` migration and legacy creep adoption.
- `tools/sim/` — offline simulator (`fetch.js`, `run.js`, `engine.js`, `constants.js`) that runs `default/` against real room snapshots in `tools/sim/data/` (gitignored). See [tools/sim/README.md](tools/sim/README.md).
- `README.md` — top-level overview and quick commands.

## Coding & Architecture Rules

- **No hard-coded room names** in `default/` (discover everything from live game state; only optional overrides in `config.avoidRooms` / `Memory` are room-specific).
- **Error isolation**: keep per-room and per-subsystem work wrapped so an exception in one room or creep never halts the tick for the rest of the empire.
- **Tower priority**: towers below 70% energy outrank spawns, extensions, upgrading, links, storage, and terminal. Preserve this invariant when touching `roles.js`, `roomState.js`, or `spawner.js`.
- **Creeps finish what they started**: a creep decides when it loads or empties, not on a timer in between. One that has taken a real load at one place (a quarter of its capacity) unloads it before visiting another source; a worker keeps the job it picked (build, repair, fortify, fill, upgrade) until the load is gone or the job is done. The only interrupt is the tower priority above. Preserve this when touching `roles.js`.
- **Leftover structures**: structures belonging to previous owners in our rooms cannot be taken over, only looted (when uncovered by hostile ramparts) or dismantled; soldiers leave loot-holding leftovers standing while they still contain resources. The planner removes every leftover that holds nothing (ramparts included) and cancels other players' construction sites (`planner.leftoversPerPass`); never one that still holds something.
- **Documentation**: when changing behaviour, `Memory` console commands, or `config.js` keys, update [default/README.md](default/README.md) (and [README.md](README.md) / [tools/sim/README.md](tools/sim/README.md) if relevant) in the same commit.

## Testing Before Deploying

Run the offline simulator against local snapshots before committing code changes:

```bash
# Refresh room snapshots from shard1 (saved to tools/sim/data/, gitignored)
node tools/sim/fetch.js Dzioba shard1

# Run the AI for 2000 ticks and verify 0 exceptions
node tools/sim/run.js default W49N25 2000
```

Additional scenario flags (`--quiet`, `--invade`, `--core`, `--unowned`, `--lost`, `--gcl`, `--release`, `--war`, `--go`, `--hostile`, `--cheap`, `--unclaim`, `--nomuster`, `--give`, `--rcl`, `--hub`, `--boost`, `--trace`, `--map`, `--data`) are documented in [tools/sim/README.md](tools/sim/README.md).

After a change to soldiers, also run them against a real enemy room: a snapshot of another player's room loads with its creeps, and its towers, defenders and wall menders act (see "Enemy rooms" in the simulator README).

## Lessons From Live Incidents

Found the hard way on 2026-11-14 (a raid on the home room, then a war party stranded in a dead-end room). Read them before diagnosing something that happened in the live game.

- **Check the cause in live data before fixing it**: the public web API returns the objects of any room without a token (`https://screeps.com/api/game/room-objects?room=ROOM&shard=shard1`; also `game/room-terrain`, `game/time`, `user/find`, `user/rooms`): creeps with bodies and boosts, tombstones, ruins, stores, the controller's `safeMode` and `safeModeAvailable`, nukes. It works for other players' rooms too. `Memory` and the console need an auth token, which this repository does not have, so ask the user for those. The first explanation of the raid, made from the code alone, was wrong; the attackers' tombstones and our controllers showed the real cause.
- **Safe mode is one room at a time**: `activateSafeMode()` returns `ERR_BUSY` (-4) while any other room of ours is in safe mode (20,000 ticks), so a poke at a minor room can leave the home room without it. When safe mode "did not fire", look at every owned controller first; the script logs `safe mode failed (<code>) after <reason>`.
- **The event log names targets that may be gone**: a hit that destroys its target cannot be looked up with `Game.getObjectById` a tick later, which is why `defense.js` remembers our ids while hostiles are in the room. `EVENT_ATTACK_TYPE_DISMANTLE` is 4 (5 is hit-back, 6 is nuke).
- **The room replay shows who did what**: `https://screeps.com/room-history/shard1/ROOM/TICK.json` (`TICK` a multiple of 100, no token, gzip) holds 100 ticks of every object in the room, with each creep's and tower's `actionLog` (what it hit, healed or repaired, and where). On 2026-11-15 it showed in minutes why 100 soldiers died in W49N17 without breaking anything: 426 hits on eleven walls, none on the two thin ramparts they stood in front of.
- **Nearest in a straight line is not nearest**: soldiers picked the closest enemy by range. In a walled room that was a creep in a sealed chamber behind the gate, so the path search ended at the gate and the squad stood there; walls were only hit by a soldier whose search came back empty, and `util.travel` took a soldier standing still at a wall for a traffic jam and stepped it away. Targets in a hostile room are now chosen by the way there (`war.plan`); keep it that way when touching soldier targeting.
- **A wall is not the whole defence**: with the fix the same squad breaks the gate rampart in 15 ticks in the simulator and still dies, because two towers that are kept full deal 600 to 1000 damage a tick. Soldiers that arrive one by one are shot one by one. Before telling the user a room can be taken, run the squad against a snapshot of it (`tools/sim/data/gate-W49N17` is the set from that day).
- **`moveTo` does not cross the map**: its path search opens 16 rooms at most and, when it runs out, returns the path to the tile nearest the target, so the creep walks into a corner of a dead-end room and stays there. All movement goes through `util.travel`, which follows a room route one exit tile at a time; do not call `creep.moveTo` anywhere else.
- **Never recycle a creep for being stuck outside our rooms**: abroad, "no path" means the route is wrong, not that the creep is walled in.
- **"0 errors" is not "healthy"**: the standard run only proves the script does not throw. Read the `[start]`/`[end]` lines and the spawn log as well. After the raid the home room spawned nothing for 1,100 ticks (a hauler was alive, no miner, the spawn stuck at 300 energy because every delivery went to the towers); every standard run of that day showed it, three spawns in 2000 ticks, and it went unnoticed.
- **A live bug the simulator does not show is a simulator bug first**: its `moveTo` used to route room by room, which hid the stranding above. Make `tools/sim/engine.js` behave like the game, reproduce the problem with the old script on snapshots of the real rooms (`--data=DIR`), then fix the AI and compare old and new on the same snapshot.

## Commit & Deploy Workflow

- **Pushing to `main` deploys**: the Screeps GitHub integration syncs `default/*.js` from `main` directly into the in-game `default` branch.
- **Always commit and push finished changes**: once a change in this repository is complete and verified with the simulator, commit it and run `git push` to `main` right away without leaving it uncommitted or asking first, then report the commit hash.
- **Commit message style**: concise one-line subject in the form `Area: what changed.` (for example, `Towers: rearm them before anything else.` or `Claims: log when a claim starts and why one is dropped.`).
