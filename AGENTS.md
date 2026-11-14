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
  - `util.js` — caches, movement/traffic, room helpers, logging.
  - `bodies.js` — body plans scaled to room energy budget.
  - `roomState.js` — per-tick room snapshot, structure index, creep index, and loot discovery (`findLoot`).
  - `planner.js` — checkerboard layout around the first spawn, spawn un-boxing, road/rampart placement (key structures and the min-cut perimeter), cleanup of off-grid inactive structures.
  - `mincut.js` — max-flow minimum cut between room exits and the base: the perimeter rampart tiles.
  - `spawner.js` — population targets and priority-ordered spawning.
  - `roles.js` — creep behaviours (`miner`, `hauler`, `upgrader`, `worker`, `defender`, `claimer`, `courier`, `scout`, plus war roles).
  - `war.js` — console-driven offence via `Memory.war` (`soldier` and `unclaimer` roles, muster, rally, march, closest-first clearing, final sweep, controller strikes).
  - `defense.js` — tower targeting/healing/repairing, safe mode triggers, worker rampart fortification thresholds.
  - `logistics.js` — source/controller/storage links and cross-room terminal energy balancing.
  - `empire.js` — cross-room helpers, couriers, scouting, automatic and manual claiming (`Memory.empire.claim`), reclaiming lost rooms, room release (`Memory.empire.release`).
  - `adopt.js` — one-time `Memory` migration and legacy creep adoption.
- `tools/sim/` — offline simulator (`fetch.js`, `run.js`, `engine.js`, `constants.js`) that runs `default/` against real room snapshots in `tools/sim/data/` (gitignored). See [tools/sim/README.md](tools/sim/README.md).
- `README.md` — top-level overview and quick commands.

## Coding & Architecture Rules

- **No hard-coded room names** in `default/` (discover everything from live game state; only optional overrides in `config.avoidRooms` / `Memory` are room-specific).
- **Error isolation**: keep per-room and per-subsystem work wrapped so an exception in one room or creep never halts the tick for the rest of the empire.
- **Tower priority**: towers below 70% energy outrank spawns, extensions, upgrading, links, storage, and terminal. Preserve this invariant when touching `roles.js`, `roomState.js`, or `spawner.js`.
- **Leftover structures**: structures belonging to previous owners in our rooms cannot be taken over, only looted (when uncovered by hostile ramparts) or dismantled; soldiers leave loot-holding leftovers standing while they still contain resources.
- **Documentation**: when changing behaviour, `Memory` console commands, or `config.js` keys, update [default/README.md](default/README.md) (and [README.md](README.md) / [tools/sim/README.md](tools/sim/README.md) if relevant) in the same commit.

## Testing Before Deploying

Run the offline simulator against local snapshots before committing code changes:

```bash
# Refresh room snapshots from shard1 (saved to tools/sim/data/, gitignored)
node tools/sim/fetch.js Dzioba shard1

# Run the AI for 2000 ticks and verify 0 exceptions
node tools/sim/run.js default W49N25 2000
```

Additional scenario flags (`--quiet`, `--invade`, `--unowned`, `--lost`, `--gcl`, `--release`, `--war`, `--go`, `--hostile`, `--cheap`, `--unclaim`, `--nomuster`, `--trace`, `--map`) are documented in [tools/sim/README.md](tools/sim/README.md).

## Commit & Deploy Workflow

- **Pushing to `main` deploys**: the Screeps GitHub integration syncs `default/*.js` from `main` directly into the in-game `default` branch.
- **Always commit and push finished changes**: once a change in this repository is complete and verified with the simulator, commit it and run `git push` to `main` right away without leaving it uncommitted or asking first, then report the commit hash.
- **Commit message style**: concise one-line subject in the form `Area: what changed.` (for example, `Towers: rearm them before anything else.` or `Claims: log when a claim starts and why one is dropped.`).
