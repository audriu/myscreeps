# sim

Offline simulator for the `default` script. It mocks enough of the Screeps API
(rooms, structures, creeps, spawning, movement with fatigue, harvesting,
building, upgrading, links, towers, simple invaders) to run the script against
snapshots of real rooms and catch runtime errors and logic problems before
uploading. It is an approximation, not the engine.

```
node tools/sim/fetch.js <username> [shard]        # snapshots into tools/sim/data (ignored by git)
node tools/sim/run.js default E12N39 2000          # one room, 2000 ticks
node tools/sim/run.js default E15N38,E14N38 3000 --quiet
node tools/sim/run.js default E15N38 800 --invade=E15N38:300:big
node tools/sim/run.js default E15N38,E16N38 5000 --unowned=E16N38   # claim + settle test
node tools/sim/run.js default E13N34 600 --trace=50 --map
```

The summary line reports exceptions, average/max milliseconds per tick,
Memory size and counters (harvested, upgraded, built, blocked moves, path
searches).
