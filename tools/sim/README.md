# sim

Offline simulator for the `default` script. It mocks enough of the Screeps API
(rooms, structures, creeps, spawning, movement with fatigue, exit-tile bouncing, harvesting,
building, upgrading, links, towers, simple invaders) to run the script against
snapshots of real rooms and catch runtime errors and logic problems before
uploading. It is an approximation, not the engine.

```
node tools/sim/fetch.js <username> [shard]        # snapshots into tools/sim/data (ignored by git), shard1 by default
node tools/sim/run.js default W49N25 2000          # one room, 2000 ticks
node tools/sim/run.js default E15N38,E14N38 3000 --quiet
node tools/sim/run.js default E15N38 800 --invade=E15N38:300:big
node tools/sim/run.js default E15N38,E16N38 5000 --unowned=E16N38   # claim + settle test
node tools/sim/run.js default E12N34,E11N34 3000 --lost=E11N34      # reclaim a room whose controller was lost
node tools/sim/run.js default E13N34,E13N35,E12N36 1500 --lost=E13N35 --gcl=2 --release=E12N36:400  # GCL full, give a room up
node tools/sim/run.js default E13N34,E13N35 1500 --lost=E13N35 --gcl=1 --gclraise=500            # GCL full, then a level up
node tools/sim/run.js default E13N34 600 --trace=50 --map
node tools/sim/run.js default E12N37,E13N36,E13N38,E12N38,E13N37 4000 --war=E13N37:1 --go --hostile=E13N37   # attack, final sweep
node tools/sim/run.js default E12N39,E12N35 1500 --cheap                   # low-energy muster (Memory.war.cheap)
node tools/sim/run.js default E11N38,E12N39,E13N37,E11N39,E13N36,E12N37,E12N36,E11N37,E12N38,E11N35,E11N36 4500 --cheap --war=E11N36:1 --unclaim=5   # controller attack, 5 per strike (needs E11N36 in data/, see below)
```

The multi-room examples above use rooms from the old shard0 snapshot (abandoned
2026-11-02); they only run with those files still in `data/`.

War flags: `--war=TARGET:TICK` (muster from tick 1, target at TICK), `--go`
(march at once), `--hostile=ROOM` (one of your snapshots turned into an enemy
room with a guard), `--cheap[=FLOOR]`, `--unclaim[=N]`, `--nomuster` (no soldiers, e.g. unclaimers only). Enemy controllers run
down, lose levels and go neutral; same-tick `attackController` hits stack like
in the engine. Hostile rooms report `structures=` (owned) and `leftovers=`
(ownerless) so the final sweep can be checked.

`fetch.js` only saves your own rooms; for an enemy target copy its
`room-objects` and `room-terrain` responses into `data/rooms/` and
`data/terrain/` by hand. Creeps cannot leave the loaded rooms: load every room
on the way (rally room, transit rooms), or they stall at an exit.

The summary line reports exceptions, average/max milliseconds per tick,
Memory size and counters (harvested, upgraded, built, blocked moves, path
searches).
