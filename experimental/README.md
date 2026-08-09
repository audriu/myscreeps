# experimental

Expansion-first Screeps colony AI. Written to take over an **existing** colony and keep claiming until you hit the GCL room cap.

Drop this folder into your Screeps client (or sync tool) as a branch named `experimental`.

## What it does

1. **Bootstraps from any state** — discovers owned rooms, spawns, and sources; no hard-coded room list.
2. **Adopts legacy creeps** — `ant` / other default-branch roles become `worker`s.
3. **Scales economy by RCL** — bootstrap generalists → miners + haulers + upgraders + builders.
4. **Plans structures** — extensions, towers, storage, containers, roads, ramparts, extra spawns as RCL allows.
5. **Defends** — towers attack/heal/repair; safe mode if a spawn is threatened.
6. **Expands** — scouts neighbors, scores claim targets (prefer 2-source rooms), spawns claimers + pioneers, remote-mines adjacent neutrals.

## Modules

| File | Role |
|------|------|
| `main.js` | Game loop |
| `config.js` | Tunables |
| `lib.js` | Shared helpers |
| `memoryManager.js` | Memory init, intel, cleanup |
| `creepManager.js` | Role dispatch |
| `roles.js` | Creep behaviors |
| `bodies.js` | Energy-scaled body plans |
| `spawnManager.js` | Population targets + spawning |
| `construction.js` | Structure planner |
| `defense.js` | Towers + safe mode |
| `expansion.js` | Claim targets + remotes |

## Switching from `default`

1. Sync/upload the `experimental` branch.
2. Switch the active branch in the Screeps client.
3. Existing creeps keep working; they are re-homed and roles normalized over a few ticks.
4. Watch console for `[exp <tick>]` logs (spawn, claim, expansion target).

## Tunables

Edit `config.js`:

- `expansion.enabled` / `expansion.maxRange` / `expansion.minHomeRcl`
- `expansion.remotes` / `maxRemotesPerRoom`
- `population.*` creep counts
- `fortify.*` wall/rampart repair ceilings
- `signature` controller sign text

## Expansion behavior

- Claims only while `ownedRooms < Game.gcl.level`.
- Needs at least one owned room at `minHomeRcl` (default 3) with a spawn to fund claimers/pioneers.
- Remotes are adjacent unowned rooms (not source-keeper); reserved with `reserver` creeps.
- New rooms: claimer → pioneers build first spawn → room enters bootstrap → develop → mature.

## Notes

- Links/labs/boosts are not automated yet (extractor/terminal sites are placed at RCL6+).
- Road planning is throttled to save CPU.
- If CPU bucket drops, scouting/construction throttle automatically.
