# sim

Offline simulator for the `default` script. It mocks enough of the Screeps API
(rooms, structures, creeps, spawning, movement with fatigue, exit-tile bouncing, harvesting,
building, upgrading, links, towers, simple invaders whose hits land in `Room.getEventLog()`) to run the script against
snapshots of real rooms and catch runtime errors and logic problems before
uploading. It is an approximation, not the engine.

Path finding follows the game where it matters for getting stuck:
`PathFinder.search` crosses room edges, opens 16 rooms at most, stops after
`maxOps` and then returns the way to the tile nearest the goal; `moveTo` to
another room is one such search (not a room-by-room route), so a creep sent
far away with a bare `moveTo` ends up in a dead-end corner like in the game.
`Game.map.findRoute` honours `routeCallback` costs.

Known differences that matter when reading the numbers: towers do a flat 300
damage, 200 healing and 400 repair whatever the range (the game: 600, 400 and
800 up to range 5, falling to a quarter at range 20), and containers lose 5000
hits every 100 ticks even in owned rooms (the game: every 500 there). Towers
therefore burn several times more energy on container repairs than they do
live, and a room short of energy looks poorer than it is.

```
node tools/sim/fetch.js <username> [shard]        # snapshots into tools/sim/data (ignored by git), shard1 by default
node tools/sim/run.js default W49N25 2000          # one room, 2000 ticks
node tools/sim/run.js default E15N38,E14N38 3000 --quiet
node tools/sim/run.js default E15N38 800 --invade=E15N38:300:big
node tools/sim/run.js default W48N25 800 --invade=W48N25:300:dis   # 3 dismantlers (25 WORK) one-shotting extensions
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

`fetch.js` only saves your own rooms. For any other room (an enemy target,
neutral and highway rooms on the way) save two responses of the public API by
hand; both work without a token for every room:

```
https://screeps.com/api/game/room-objects?room=ROOM&shard=shard1             -> rooms/ROOM.json
https://screeps.com/api/game/room-terrain?room=ROOM&shard=shard1&encoded=1   -> terrain/ROOM.json
```

Creeps cannot leave the loaded rooms: load every room on the way (rally room,
transit rooms), or they stall at an exit.

`--data=DIR` runs against another snapshot set laid out like `data/`:
`rooms/`, `terrain/` and a `time.json` holding
`{"time": <tick>, "user": "<your user id>", "username": "<your name>"}`, e.g. a
block of neutral and highway rooms around a route. Rooms without a controller,
or with an unowned one, are listed as `transit` with the creeps standing in
them. `--trace=N` prints every creep's room and position.

To reproduce a movement problem seen in the live game, snapshot the rooms
around it while the creeps are still there, then run the script from before
the fix and the current one on the same set (anything under `data/` stays out
of git):

```
D=tools/sim/data/trap
ROOMS=$(ls $D/rooms | sed 's/.json//' | paste -sd,)
mkdir -p /tmp/old-ai && git archive COMMIT_BEFORE_THE_FIX default | tar -x -C /tmp/old-ai
node tools/sim/run.js /tmp/old-ai/default $ROOMS 600 --data=$D --war=W50N21:1 --go --quiet
node tools/sim/run.js default $ROOMS 600 --data=$D --war=W50N21:1 --go --quiet
```

The summary line reports exceptions, average/max milliseconds per tick,
Memory size and counters (harvested, upgraded, built, blocked moves, path
searches).
