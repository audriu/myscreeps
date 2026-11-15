# default

Self-contained Screeps colony AI. Discovers everything from live game state
(no room names in code, apart from the optional `avoidRooms` list in
`config.js`), takes over an existing colony, repairs broken bases and grows
every owned room.

Upload the files in this folder as the `default` branch (Screeps client local
folder sync, or copy them into
`%LOCALAPPDATA%\Screeps\scripts\screeps.com\default\` on Windows). Remove old
modules from the branch first; `main.js` only requires the modules listed below.

## What it does

- **Economy per room**: static miners parked on source containers, haulers
  sized by haul distance, upgraders fed from a controller container or link,
  workers for building and repairs. In the hub, and in a room without a
  storage of its own, upgrading drops to 6 WORK while sites worth more than
  20000 energy wait (labs, factory, the first storage or terminal), so the
  income goes into them; a storage above 50000 pays for one more worker. Bodies scale with the room's energy
  capacity; the spawn waits for energy instead of producing stubs, except in
  emergencies: nobody left who can carry, no hauler, or no miner at all (the
  first miner is then built from whatever is on hand, 250 energy at least,
  even while a hauler is still alive; a full-size one follows).
- **Creeps finish what they started**: a creep that has taken a real load
  (a quarter of its capacity or more) at one place only tops it up from what
  lies within 3 tiles of that place, then goes to unload; it does not walk
  on to a second source with the load on board (remote haulers take one
  source's container per trip). A worker picks its job once per load
  (build, repair, fortify, fill the spawn, upgrade) and spends the whole load
  on it; it only picks again when the job is done before the load is (the
  site got built, nothing is left to mend). The one thing that still pulls
  a worker off its job is a tower that must be rearmed while there is no
  hauler or the room is in danger.
- **Towers are rearmed first**: a tower under 70% energy outranks spawns,
  extensions, the controller container, links, storage and terminal. Haulers
  carrying energy drop what they are doing (topping up, stashing loot, a trip
  elsewhere) and go to the tower, drawing on the terminal when storage is dry.
  Workers do it before anything else, the downgrade emergency included, when
  there is no hauler or the room is in danger. Upgraders and workers leave in
  storage what the towers still need.
- **Spawn before peacetime repairs**: while the spawn lacks the energy for a
  miner, a hauler or an emergency creep, towers stop repairing roads,
  containers and ramparts (they still shoot, heal and hold ramparts under
  fire) and haulers also empty the links. A tower that repairs from 600 energy
  never reaches the 70% at which it stops outranking the spawn, so a room down
  to a stub miner used to feed its whole income to the ramparts and spawn
  nothing.
- **Base repair**: frees spawns that were boxed in by structures (destroys the
  cheapest chain of extensions/walls), opens walled pockets, removes
  unreachable extensions, prunes RCL-inactive structures that sit off the
  checkerboard grid, reconnects sources to the controller area.
- **Planner**: checkerboard layout around the first spawn, nothing non-walkable
  next to a spawn, containers at sources and controller, towers (before the
  extensions; further out when the base is cramped), storage,
  links, terminal, extractor, the hub's labs and factory, extra spawns, roads (RCL3+), ramparts on key structures
  (spawns, towers, storage, terminal) from RCL4, then a perimeter of ramparts
  (`planner.wallFromRcl`): the minimum cut between every exit and the base
  (our structures plus `planner.wallMargin` = 3 tiles where the terrain
  allows, sources and controller plus 1), found with max-flow in
  `mincut.js`. The fewest tiles that seal the base; our creeps walk through
  ramparts, hostiles have to break one. The tiles are kept in
  `Memory.rooms[r].plan.wall` and recomputed (one room per tick, ~15 CPU)
  after an RCL change or once the base has more structures than at the last
  cut, never because some were destroyed. From RCL5, once nothing else
  is left to build and the room has spare energy, it also covers labs,
  factory, power spawn, nuker, observer, links and extensions
  (`planner.coverTypes`).
- **Defense**: towers focus the most dangerous hostile they can actually
  wear down (tower falloff, boosted TOUGH and nearby HEAL are counted); when
  every hostile out-heals them they hold fire and repair the weakest rampart
  within range 3 of a hostile instead. Otherwise they heal creeps, repair
  roads/containers and ramparts (fortify only when storage is healthy). Safe
  mode only once a hostile has actually hit something of ours in the room:
  one of our creeps, one of our structures or the controller (read from the
  room's event log of the previous tick; nukes do not count). A hit that
  destroyed its target outright (a dismantler one-shots an extension or a
  link) counts too: while hostiles are in the room the ids of our structures
  and creeps are remembered for a tick. Hostiles that merely walk in, however
  many, do not trigger it. A failed activation (e.g. another room already in
  safe mode) is logged.
- **Ramparts with spare energy**: new ramparts are repaired to 3k before more
  are built (they start at 1 hit and decay), and every rampart is kept at
  20k at least. During a long build (sites worth more than 20000 energy) a
  third of the workers' loads (those picked up in 100 ticks out of every
  300) go to ramparts that are down to half of that, so a day of lab
  building does not wear the line down to the 5k the towers hold. When there is nothing to build or repair and the room holds
  spare energy (20k in storage, or 1.5k in the source containers of a room
  without storage; `defense.workerFortify`), the worker thickens ramparts
  toward `planner.rampartTarget` (RCL5 50k, RCL6 100k, RCL7 300k, RCL8 1M)
  instead of upgrading: ramparts over spawns, towers, storage and terminal
  first, weakest first, then the rest (perimeter included). A worker raises
  the rampart it picked by `defense.fortifyStep` (10k) and then picks the
  weakest again, so the whole line rises evenly. The room spawns one extra worker
  for it. It stops when the reserve drops below half the threshold.
- **Empire**: couriers carry energy from rich storages into weak neighbours;
  terminals balance energy between RCL6+ rooms; owned rooms without a spawn get
  helper workers (three from an RCL4+ room within 3 rooms, otherwise one from
  any room with a working spawn); lost rooms that still hold our spawn are claimed back first;
  claiming is gated (all rooms RCL3+, a healthy RCL5+ funder, CPU bucket high)
  and picks 2-source rooms next to owned ones. When GCL is full a lost room
  cannot be reclaimed: the console warns every 1000 ticks, and
  `Memory.empire.release = 'W1N1'` gives a room up (unclaimed, never retaken)
  so the slot goes to the lost room. Every new GCL level is logged and
  emailed with the number of free slots. See [Colonizing](#colonizing).
- **Remote mining** (`remote.js`): sources in the unowned rooms next to
  ours are mined by the neighbouring home room: a miner per source, haulers
  sized by the walk, a reserver that doubles the sources' output, guards
  against invaders and invader cores. One new room per empire pass, only
  while CPU and the home's spawn time allow. See
  [Remote mining](#remote-mining).
- **Minerals, labs, factory** (`industry.js`): one room is the hub. Rooms
  mine their mineral while the empire is short of it, terminals send
  everything that is not energy to the hub, its labs run reactions (the
  upgrade boost by default) and boost upgraders and, on request, soldiers;
  at RCL7 its factory turns batteries into energy. Stores another player
  left in a room of ours are emptied through that network and removed once
  empty. See [Minerals, labs and the factory](#minerals-labs-and-the-factory).
- **Traffic**: parked miners are routed around, jammed creeps push idle
  neighbours aside, spawns push creeps off their exits, unreachable targets are
  dropped. A creep that cannot step off an exit tile (the engine throws it
  back and forth between the two rooms) counts as jammed and paths around
  the creeps in its way; marching healers do not wait next to a fighter that
  stands on an exit tile, and healers standing around a blocked fighter are
  pushed aside like any idle creep.
- **Long trips**: a creep bound for another room walks a room route
  (`Game.map.findRoute`; highways and our rooms preferred, keeper rooms
  costly, avoided rooms left out) one exit tile at a time. The exit tile
  comes from a path search limited to the next three rooms of that route.
  The game's own `moveTo` searches 16 rooms at most and, when it gives up,
  walks the creep to the tile nearest the target, which on a long trip is
  the corner of a dead-end room. A room edge the route crosses but no path
  does is logged (`Route: no way from A into B`) and routed around for 300
  ticks. With no route at all the old direct `moveTo` is used. The
  "walled in, recycling it" suicide only applies in our own rooms now.
- **War** (`war.js`, roles `soldier` and `unclaimer`): console-driven
  offence: squads from every eligible room, a rally point, closest-first
  destruction ending in a sweep of everything destroyable, an optional
  low-energy muster and CLAIM teams that run the enemy controller down to
  neutral. See [War](#war) below.
- **Bodies**: `config.shuffleBody` randomises body part order on spawn;
  off, TOUGH goes first and MOVE last so damage eats MOVE parts last.
- **Avoided rooms**: `config.avoidRooms` lists rooms creeps must not enter,
  path through, scout, claim or reclaim (empty by default; soldiers heading
  for `Memory.war.target` ignore it). `Memory.avoidRooms = [...]` overrides
  the list from the console; `[]` disables it.

## War

Everything is driven from the console through `Memory.war`; nothing happens
while it is unset. Soldiers and unclaimers are the only creeps allowed into
an avoided room, and only into the target.

### Quick start

```js
// Attack now: build soldiers everywhere, march straight in, CLAIM teams of five on the controller
Memory.war = { muster: true, cheap: true, unclaim: 5, target: 'E11N36', go: Game.time }
```

### Stopping (read this before typing)

`Memory.war = { ... }` **replaces** the whole war state. Change one switch
with `Memory.war.x = ...` instead.

| You want | Command |
|---|---|
| No new soldiers, the living ones keep fighting | `Memory.war.muster = false` |
| Call everyone home, keep building soldiers | `delete Memory.war.target` |
| Stop the controller attack only | `delete Memory.war.unclaim` |
| End the war: soldiers and unclaimers walk home and recycle | `Memory.war = { muster: false }` |

A soldier with no target and muster off recycles itself; an unclaimer whose
target changed or whose `unclaim` switch is off does the same.

### How a war runs

1. **Muster** (`Memory.war.muster = true`): every room at RCL `minRcl` (4)+
   with an active spawn, not in bootstrap and (unless `cheap`) with at least
   `minStorage` (20k) in storage keeps `maxPerRoom` (10) soldiers and
   replaces losses: 30% healers, and of the fighters 30% ranged, the rest
   melee (ATTACK/MOVE pairs, spare energy buys TOUGH/MOVE pairs, so every
   part has its MOVE). Soldiers spawn at
   priority 480: after miners, haulers and upgraders, before workers.
   Without a target they wait at home and fight anything that enters it.
2. **Rally** (`Memory.war.target = 'E11N36'`): the squad gathers in the
   owned room nearest the target (`Memory.war.rally` overrides), walking
   around the target. The wave is the number of soldiers alive when the
   target was set (`Memory.war.wave` overrides).
3. **March**: once `gatherShare` (80%) of the wave stands at the rally point,
   or `maxGather` (600) ticks have passed with at least one there, or
   `Memory.war.go` is set, everyone marches in. Healers stick to fighters.
   Armed enemy creeps (ATTACK or RANGED_ATTACK) that come within
   `engageRange` (5) tiles on the way are fought (⚔️) before the march goes
   on; unarmed creeps are let go. The same holds on the way to the rally
   point and back home.
4. **Destroy**, closest first (`closestFirst`):
   1. hostile creeps and hostile structures that are **not** under a
      rampart (hits on a covered target only dent the rampart). "Closest"
      is counted along the way there, see *The way in* below;
   2. **final sweep** (`finalSweep`): once none is left, everything with hit
      points that is not ours: ramparts, walls, containers, whatever
      the ramparts covered, ownerless leftovers. Never roads (pointless,
      they stay), the controller, portals, keeper lairs or power banks
      (they hit back), never anything in our own rooms.
   3. **loot is kept** (`spareEnergy`): at every stage, a harmless
      structure that still holds energy or any other resource (storage,
      terminal, container, link, lab, factory, power spawn) is left
      standing so it is all there when we settle the room; once it is empty
      it goes. Towers, spawns, extensions and nukers are always destroyed,
      full or not: they shoot or build the next creeps. Ranged soldiers aim
      instead of using mass attack within 3 tiles of a spared structure.
5. **Cleared**: when nothing destroyable is left the room is marked cleared
   (emailed) and the squad holds its centre. If something new appears the
   fight resumes.

**The way in** (`breach`). Once a tick the squad works out, for every tile
of the target room, how many ticks it takes to stand next to the nearest
target, and which tile to step on next. Plains and roads cost one tick,
swamp five. A wall or a hostile rampart can be gone through as well: it
costs its hits divided by what the two strongest soldiers in the room deal
per tick. So:

- a soldier goes for the target that is nearest by that count, not the one
  nearest in a straight line behind a wall. An enemy creep standing in a
  sealed chamber no longer pulls the whole squad to the nearest dead end;
- the way leads around a wall when walking is quicker (a maze, an open back
  door) and through its weakest spot when it is not. All soldiers get the
  same answer, so they hit the same rampart: the thin one, not the thick
  wall beside it;
- whoever stands at that wall stays there and hits every tick. The rest
  queue behind without path searches or random steps, step around each other
  onto any free tile that is nearer, and hit a wall they happen to stand next
  to while they wait (it widens the gap). A stronger soldier changes places
  with a weaker one in front of it, so the strongest end up at the wall and
  damaged ones drift back;
- something of theirs within weapon reach is hit before stone: an armed creep
  first, then any creep, then a structure. Ranged soldiers shoot over the
  wall;
- when the wall falls the same count leads everybody through the hole to the
  next target, and to the next wall if there is one.

A strong squad therefore breaks the gate and a weak one walks around it. What
this does not change: towers keep shooting, and soldiers that arrive one by
one are shot one by one. Send a wave (rally first) against a room whose
towers are kept full.

With `breach: false` the old rule applies: nearest in a straight line, and a
wall is only hit by a soldier whose path search came back empty.

Safe mode in the target: the squad waits at the rally room (⏳) and marches
again when it ends. Rooms in `unrestrictedRooms` (or `Memory.war.everything =
true`) skip the waiting order: walls and covered structures are hit from the
start. With `closestFirst: false` armed creeps and loaded towers go first;
with `finalSweep: false` the old ending applies (ownerless containers, then
the whole squad on the weakest rampart, walls only when they block the
path). Roads are never hit.

### Low-energy muster (`Memory.war.cheap`)

`Memory.war.cheap = true` drops the storage gate, builds each soldier from
whatever energy the room holds once it has `cheapMin` (300; `cheap = 500`
sets another floor) instead of waiting for full extensions, and lets haulers
spend the 40k energy normally kept in each terminal. Economy roles still
spawn first. Weak rooms produce small soldiers (2-part rangers and healers);
RCL8 rooms still build full 50-part fighters.

### Controller attack (`Memory.war.unclaim`)

`Memory.war.unclaim = 5` (or `true` for one) sends unclaimers: CLAIM+MOVE
creeps as large as the room can afford (14 CLAIM at 9300 energy capacity).

- **Effect**: `attackController` takes 300 downgrade ticks per CLAIM part and
  blocks the controller for 1000 ticks. While blocked the owner can neither
  upgrade nor activate safe mode. Strikes repeat until the controller is
  neutral (emailed). Neutral is not ours: claiming it needs a free GCL slot
  (`Memory.empire.release` frees one).
- **Teams**: hits landing in the same tick all count (the engine checks the
  block from the start of the tick), so the team waits at the controller
  (🏴🤝) and strikes together. It strikes without the stragglers
  `unclaimSync` (350) ticks after the first one arrived, or when a waiting
  one is about to expire. A team of four with 18 CLAIM each takes 21,600
  ticks in one strike.
- **Where from**: rooms within `unclaimRange` (3) of the target, ranked by
  CLAIM parts; rooms with less than half the best room's parts are skipped
  and the strong rooms take turns filling the slots.
- **Timing**: a team spawns `unclaimLead` (500) ticks before the block ends
  (energy fill and travel), at priority 490 (above soldiers). Bodies shrink
  so a room's share of the team spawns within `unclaimWindow` (330) ticks
  (one spawn, five slots: 11 CLAIM each), and a member that could not reach
  the controller before the team must strike is not spawned at all.
- **Energy is the real limit**: refilling extensions takes time, so in
  practice each strong room adds about one big unclaimer per strike. A
  member costs up to ~12k energy; keep `cheap` on so the terminal reserve
  pays for them. No soldiers needed for an empty room:
  `Memory.war = { muster: false, cheap: true, unclaim: 5, target: 'E11N36' }`.
- Each creep strikes once, then stays by the controller for vision.

### What you see

| Bubble | Meaning |
|---|---|
| ⚔️ | soldier fighting an armed enemy it met on the way |
| ⏳ | soldier waiting at the rally room for safe mode to end |
| 🏴 | unclaimer on its way, or done striking |
| 🏴⏳941 | unclaimer at the controller, block still running (ticks left) |
| 🏴🤝 | unclaimer waiting for the rest of its team |

Console, every `logEvery` (100) ticks:

```
WAR: attacking E11N36 soldiers=88 inTarget=22 hostilesLeft=97 unclaim=RCL7:128994 hits=1 x5 from=E11N38+E12N39+E11N38+E12N39+E11N38
WAR: strike on E11N36 by 4 unclaimer(s), 72 CLAIM: -21600 ticks (expected -21600), 106260 left at RCL7
```

Emails: target set, marching, safe mode start and end, target cleared,
controller neutral.

### `Memory.war` fields

| Field | Set by | Meaning |
|---|---|---|
| `muster` | you | rooms build and replace soldiers |
| `boost` | you | the hub's labs hold war boosts; fresh soldiers within reach take them first |
| `target` | you | room to attack |
| `go` | you / script | march now (tick it started) |
| `rally`, `wave` | you (optional) / script | staging room; soldiers needed before marching |
| `cheap` | you | low-energy muster (`true` or an energy floor) |
| `unclaim` | you | unclaimers per strike (`true` = 1, up to 8) |
| `everything` | you | treat the target as an unrestricted room |
| `since`, `safeUntil`, `cleared` | script | target set at, safe mode end, cleared at |
| `unclaimFrom` | script | spawn room for each unclaimer slot |
| `unclaimAt`, `unclaimReady` | script | tick the block ends; first unclaimer ready at the open controller |
| `unclaimLeft`, `unclaimHits` | script | `RCL:ticksToDowngrade` last seen; strikes so far |
| `unclaimStrike`, `unclaimDone` | script | last strike (to log its real effect); controller went neutral at |

### Settings (`config.war`)

| Key | Default | |
|---|---|---|
| `maxPerRoom` | 10 | soldiers each eligible room keeps |
| `minRcl`, `minStorage` | 4, 20000 | eligibility (storage gate off with `cheap`) |
| `cheapMin` | 300 | energy floor per soldier with `cheap` |
| `priority` | 480 | spawn priority (unclaimers +10) |
| `healers`, `ranged` | 0.3, 0.3 | squad mix |
| `closestFirst` | true | nearest target first |
| `breach` | true | "nearest" is counted along the way (walking, or through the weakest wall or rampart when that is quicker); the squad breaks what stands in the way, strongest in front. `false`: straight-line distance |
| `engageRange` | 5 | on the way: fight armed enemy creeps within this many tiles (0: walk past) |
| `finalSweep` | true | destroy everything destroyable at the end (roads excepted) |
| `razeAll` | true | old ending only: ownerless containers |
| `spareEnergy` | true | outside our rooms, leave harmless structures holding energy or resources standing (not towers, spawns, extensions, nukers) |
| `unrestrictedRooms` | `[]` | rooms where nothing is spared from the start |
| `maxGather`, `gatherShare` | 600, 0.8 | when a partial squad marches |
| `unclaimRange`, `unclaimLead`, `unclaimSync`, `unclaimWindow` | 3, 500, 350, 330 | unclaimer reach, spawn lead, team wait, spawn ticks per team |

## Remote mining

Rooms next to ours that nobody owns are mined from the neighbouring home
room. Nothing has to be typed: `remote.js` picks the rooms, and
`Memory.empire.remotes` shows what is mined.

### How a remote runs

1. **Candidates**: every exit of an owned room at RCL `minRcl` (4)+ that has
   a storage, a working spawn, a miner on each of its own sources and a
   hauler. Highways, keeper rooms, avoided rooms, rooms owned by anyone,
   rooms with towers, rooms reserved by another player or holding another
   player's armed creeps are left out (and not looked at again for 3000 to
   20000 ticks).
2. **Intel**: a room is judged from `Memory.empire.intel` (sources and
   controller position included). When that is missing or older than
   `intelTtl` (10000) the home sends a 1-MOVE scout; a room known to be
   somebody's base is never scouted. No word after 600 ticks: the room is
   left alone for 5000.
3. **Taking it on** (one room per empire pass, 20 ticks): the best candidate
   (most sources; rooms held by an invader core last) is measured from the
   home storage with a path search. Sources further than `maxDist` (110)
   tiles are dropped. The room is only taken while the CPU bucket is at
   `minBucket` (6000)+, no muster is on, the home has fewer than `perRoom`
   (2, one more with a second spawn) remotes, its last remote is 600 ticks
   old, and the creeps it keeps alive plus the new ones take at most
   `maxSpawnLoad` (75%) of its spawn time. The log says `Remote W45N28 taken
   on by W46N28: 2 source(s) at 24/38 tiles, spawn load 0.23 + 0.18`.
4. **Creeps** (spawned by the home, counted against it):

   | Role | Body | Priority | What it does |
   |---|---|---|---|
   | `remoteMiner` | 6 WORK, 1 CARRY, 5 MOVE (900) | 540 | one per source; builds a container under its feet (5000 energy out of what it mines), mends it, stands on it |
   | `remoteHauler` | CARRY/MOVE pairs | 530 | loads at the containers (or off the ground) once half a load is there, unloads at home like a hauler (towers, spawn, controller container, storage); recycles when too old for another round trip |
   | `reserver` | 2–4 CLAIM/MOVE pairs | 520 | sent while the reservation has under `reserveBelow` (1500) ticks; a reserved source gives 3000 per 300 ticks instead of 1500. Against somebody else's reservation (an invader core's) it uses `attackController` |
   | `guard` | ATTACK with some RANGED_ATTACK and HEAL, MOVE for each | 560 | see below |

   These priorities sit above upgraders (500) and below a home's own miners
   and haulers. Upgraders are sized for the extra income (4 WORK per mined
   source, 8 once it is reserved).
5. **Danger**: armed creeps of anyone else in the room and every creep of
   ours walks home (the log says who and how many parts). Invaders with up
   to `guardMaxParts` (30) ATTACK, RANGED_ATTACK and HEAL parts are met by
   guards (two for more than two invaders); bigger groups are waited out
   until they die of age. Another player's creeps: ours stay away for
   `playerPause` (300) ticks and try again. `maxRaids` (6) raids within
   `raidWindow` (20000) ticks and the room is given up for 20000.
6. **Invader cores**: a lesser core reserves the controller, and the engine
   then refuses our harvest. A guard knocks the core down (it does not fight
   back), reservers wear the reservation down, miners follow. Rooms held by
   a core are taken on like any other, after the free ones.
7. **Given up** (logged with the reason): the home lost its spawn, the room
   was claimed or reserved by a player, it is on the avoid list, too many
   raids. Its haulers finish life as haulers at home, the rest recycle.

### Console

```js
JSON.stringify(Memory.empire.remotes)       // { W45N28: { home, t, src: [{ id, x, y, d, c }], res, resBy, core, unsafe, threat, raids } }
delete Memory.empire.remotes.W45N28         // give one up now (it may be picked again)
Memory.empire.remoteSkip.W45N28 = Game.time + 50000   // do not pick it again for 50000 ticks
delete Memory.empire.remoteSkip.W45N28      // allow a skipped room again
_.filter(Game.creeps, c => c.memory.remote).map(c => c.name + ' ' + c.pos)
```

`res` is the tick our reservation runs out, `resBy` who else holds one,
`unsafe` the tick until which our creeps stay out. The 100-tick summary shows
`remotes=N`.

### Settings (`config.remote`)

| Key | Default | |
|---|---|---|
| `enabled` | true | off: every remote is given up |
| `minRcl` | 4 | homes below this mine no remotes |
| `perRoom` | 2 | remote rooms per home (one more with a second spawn) |
| `maxDist` | 110 | path tiles from the home storage to a source |
| `maxSpawnLoad` | 0.75 | share of its spawn time a home's creeps may take |
| `minBucket`, `pauseBucket` | 6000, 2000 | CPU bucket to take on another room; below the second no remote creep is replaced |
| `intelTtl` | 10000 | ticks before a neighbour is scouted again |
| `reserve`, `reserveBelow`, `reserveClaims` | true, 1500, 4 | reservers, when one is sent, CLAIM parts at most (rooms that cannot afford 2 send none) |
| `containers` | true | miners build containers |
| `guardMaxParts`, `playerPause` | 30, 300 | invader group size guards take on; ticks to stay away from a player's creeps |
| `maxRaids`, `raidWindow` | 6, 20000 | raids before a room is given up |

## Minerals, labs and the factory

`industry.js` decides, creeps carry. Nothing needs typing except the war
boost switch; `Memory.empire.hub` names the hub.

### The hub

The hub is an owned room with a terminal and a storage of ours: the highest
RCL, then the most central one that lies close to where the stock is. It is
picked once (`Hub: W46N29 collects minerals and compounds ...`) and kept in
`Memory.empire.hub`; set that from the console to move it. Only the hub
gets labs and a factory. The 100-tick summary shows `hub=ROOM`.

### Minerals

- **Mining**: an RCL6+ room builds an extractor and a container next to its
  mineral, and spawns a `mineralMiner` (2 WORK per MOVE, `minerEnergy` 1500,
  priority 380) while the empire holds less than `mineralCap` (60000) of
  that mineral, the room less than `roomStock` (30000), and its storage has
  `minEnergy` (5000) energy (a poorer room builds no extractor either). The
  extractor and its container stay outside the rampart perimeter. The miner stands on the container and stops
  when it is full; haulers empty it (at 1500 before their next energy
  round). An exhausted mineral (50000 ticks) gets no miner.
- **Where things go inside a room**: away from the hub into the terminal
  while the hub still takes that resource, else into storage; in the hub
  into storage. Idle haulers carry.
- **Terminal network** (every 20 ticks, one shipment per terminal, `batch`
  5000 at most): a terminal sends what is not energy to the hub until the
  hub holds `hubCap` (60000) of that resource (`batteryCap` 300000
  batteries), the most valuable compounds first. A terminal with something
  to ship is kept at `feeEnergy` (3000): before upgrading and storage, and
  before the extensions once the spawn can pay for its next creep. Away
  from the hub a terminal holds `terminalMax` (100000) at most. Shipments
  are logged every 100 ticks (`Shipped: W46N27>W46N29 UH2O 5795, ...`).

### Stores other players left behind

A storage or terminal of a previous owner cannot be used, only emptied, and
it uses up our RCL allowance: while theirs stands, ours cannot be built.

1. Their stores get a rampart of ours once they hold 1000 of anything but
   energy: under it only we can withdraw.
2. With no storage or terminal of our own in the room, everything is
   gathered in their biggest storage (cheapest minerals first: if the game
   refuses the deposit, the log says so and nothing more is moved).
3. An empty leftover storage, terminal, extractor, lab or factory that
   blocks one of ours is removed by the planner (`removed the empty
   terminal MadDokMike left at 16,33`).
4. Our terminal is then built next to their storage. Its contents go
   through the terminal to the hub; what the hub does not take goes to the
   terminal room with the most free storage. Once their storage is empty it
   is removed and ours is built.

### Labs

Built in the hub only, in one cluster near the storage (`plan.labs`: two
reagent labs and up to six more within range 2 of both; 3 at RCL6, 6 at
RCL7, 8 at RCL8). One lab is already enough for boosting.

- **Reactions**: `goals` lists what to make and how much to keep
  (`[{ res: 'GH', keep: 3000 }]`: the upgrade boost, +50% per WORK part).
  A reagent that is missing is made first (GH needs G, G needs ZK and UL,
  and so on), `labBatch` (1000) units at a time, as long as the room holds
  `labMin` (200) of both inputs. Console: `Memory.empire.labGoals =
  [{ res: 'XGH2O', keep: 3000 }, { res: 'XLHO2', keep: 2000 }]`.
- **Upgraders** fresh from the spawn take the upgrade boost from a lab that
  holds one (the product lab itself, or a spare lab kept loaded from stock).
- **Soldiers**: `Memory.war.boost = true` stops the reactions and loads one
  boost per lab in the order of `warBoosts` (ATTACK, HEAL, TOUGH,
  RANGED_ATTACK, MOVE), each time the strongest tier in stock. Soldiers from
  rooms within `boostRange` (4) of the hub walk by the labs before they
  rally (⚗️) and wait up to 150 ticks for a lab that is being loaded.
  `delete Memory.war.boost` puts the labs back to work.
- **Chemist**: a room gets one `chemist` (CARRY/MOVE, priority 420) while
  labs or a factory need loading, or more than `chemistAt` (3000) units
  wait to be carried; a bigger one for tens of thousands.

### Factory

At RCL7 the hub builds a factory once the empire holds `factoryMin` (5000)
batteries. It opens 50 batteries into 500 energy every 10 ticks; the chemist
feeds it and carries the energy to storage.

### Console

```js
Memory.empire.hub                                   // the hub room; assign another owned room to move it
Memory.rooms.W46N29.labs                            // { a, b, job: { p, a, b, left }, mode }
Memory.empire.labGoals = [{ res: 'GH2O', keep: 3000 }]   // what the labs make (replaces config.industry.goals)
delete Memory.empire.labGoals
Memory.war.boost = true                             // labs hold war boosts, soldiers come by before they march
delete Memory.rooms.W46N27.noDeposit                // try again to gather leftovers in the storage a player left
```

### Settings (`config.industry`)

| Key | Default | |
|---|---|---|
| `enabled` | true | off: no mining, shipping, reactions or factory work |
| `mineralCap`, `roomStock` | 60000, 30000 | a mineral is mined while the empire and the room hold less |
| `minEnergy`, `minerEnergy` | 5000, 1500 | storage energy before a mineral miner is spawned; energy for its body |
| `hubCap`, `batteryCap` | 60000, 300000 | what the hub takes of each resource, and of batteries |
| `terminalMax`, `batch`, `feeEnergy` | 100000, 5000, 3000 | non-energy in a terminal away from the hub; largest shipment; energy kept for fees |
| `chemistAt` | 3000 | units waiting inside a room before it gets a chemist |
| `labBatch`, `labMin` | 1000, 200 | product per reaction run; reagent stock a reaction needs |
| `goals` | `[{ res: 'GH', keep: 3000 }]` | what the labs make |
| `warBoosts`, `boostRange` | ATTACK, HEAL, TOUGH, RANGED_ATTACK, MOVE; 4 | boost per lab in war; how far soldiers come from |
| `factoryMin` | 5000 | batteries in the empire before a factory is built |

## Colonizing

New rooms are claimed by `empire.js` through `Memory.empire.claim`. With the
defaults it happens on its own; the console can pick the room, force it or
stop it. Room names below are examples next to W49N25.

### Quick start

```js
// Free GCL slot? (owned rooms vs. slots)
Game.gcl.level - _.filter(Game.rooms, r => r.controller && r.controller.my).length

// Claim W48N25, claimer from W49N25
Memory.empire.claim = { target: 'W48N25', from: 'W49N25', t: Game.time }

// Claim several rooms one after another, all from W49N25
Memory.empire.claim = { target: ['W48N25', 'W48N24', 'W47N25'], from: 'W49N25', t: Game.time }
```

### Claim lists

`target` may be a list. The empire unpacks it at once into `target` (the
room being claimed now) and `next` (the rest, in order), and works through
it:

- When `target` is claimed, times out, has no controller or turns out to be
  owned by someone else, the claim moves on to the first room of `next` that
  is not ours or avoided (`Claim moves on to W48N24`) and `t` restarts, so
  each room gets its own `claimTimeout`. The claim is cleared after the last
  room.
- The claimer does not suicide after a claim while the list has rooms left:
  it signs the controller and walks on to the next one. If it dies on the
  way (600 ticks), `from` spawns a new one for the room the list is at.
- Rooms the list already claimed (`done`) do not count against the
  `allRoomsMinRcl` gate, so the rest of the list is not stopped by the new
  RCL1 rooms. Every room still needs a free GCL slot: when the GCL is full
  the remaining rooms are dropped with a warning.

### How a claim runs

1. **Target**: either yours (above) or picked automatically every 20 ticks
   (see [Automatic expansion](#automatic-expansion)). A running claim is
   kept until it ends; when picking a new one, lost rooms that still hold
   our buildings come before new rooms (reclaim).
2. **Claimer**: the `from` room spawns one CLAIM+MOVE creep (650 energy, so
   RCL3+) at priority 320 (reclaims 450). It signs its home controller with
   `config.signature`, walks to the target (avoided rooms are routed
   around), claims, signs and suicides (or walks on to the next room of a
   [claim list](#claim-lists)). A claimer lives 600 ticks: keep
   `from` within 2–3 rooms of the target.
3. **Claimed**: logged (`Claimed W48N25`), emailed, `Memory.empire.claim` is
   cleared (a list moves on to its next room). If the controller turns out to
   be owned the claim is dropped (a list skips the room).
4. **First spawn**: the planner of the new room places a spawn site at once
   (RCL1 allows one) and plans the rest of the base around it.
5. **Helpers**: while the room has no spawn, the nearest owned room at
   `helperMinRcl` (4)+ with a working spawn and within 3 rooms sends
   `expansion.helpers` (3) workers (bodies up to 1500 energy, priority 300)
   to build the spawn. Without such a room, the best developed room in reach
   (largest energy capacity, then nearest) sends `minHelpers` (1).
6. **Own feet**: once the spawn stands the room runs its own economy;
   couriers bring energy from storages with 150k+ within 2 rooms until it
   holds 30k.

A claim that is not done within `claimTimeout` (4000) ticks of `t` is
dropped and the room blacklisted for 20000 ticks.

### Leftovers of other players

Structures another player left in a room we claim stay theirs: they can
not be taken over, only emptied or dismantled. In every room of ours the
script empties what it may withdraw from: everything of another player
that has a store (storage, terminal, spawns, extensions, towers, labs,
links, factory...; never a nuker) and neutral containers that are not
source or controller containers, unless a non-public rampart of someone
else covers it (those stay locked, see `roomState.findLoot`).

- **Energy** counts like a ruin: workers and haulers take it for spawning,
  building and upgrading.
- **Everything else** (minerals, compounds, power...) is carried by idle
  haulers, or by a chemist when there is a lot, to where the room keeps such
  things: the terminal while the hub still takes that resource, else our
  storage. Tombstones and ruins in our rooms are emptied the same way. With
  neither a storage nor a terminal of ours, it is gathered in the biggest
  storage a player left, the emptied leftovers are removed and ours get
  built: see [Stores other players left behind](#stores-other-players-left-behind).
- **Soldiers leave them standing** while they still hold something: they
  are inactive, so harmless, and razing them would only drop the loot into
  a ruin that decays. Ranged soldiers and defenders aim single shots
  instead of a mass attack when such a structure is within range 3. Empty
  leftovers are still fair targets. A leftover tower (its owner does not own
  the controller) never counts as one that can fire back, so it no longer
  draws soldiers away from real intruders.

The engine counts every owner's structures against the RCL allowance, so
leftovers also use up our limits. An empty storage, terminal, extractor, lab
or factory that blocks one of ours is removed by the planner; other types
are not: a room holding three spawns of another player can never get a
spawn of ours (under their ramparts they cannot be removed either). The planner then places nothing there and warns `no spawn
can be placed`; helpers keep coming from the nearest RCL4 room and only
upgrade with what they loot and harvest. Release such a room unless that is
worth it.

### Gates

| Gate | Manual claim | Automatic | Reclaim / forced |
|---|---|---|---|
| free GCL slot | yes | yes | yes |
| `expansion.enabled` | yes | yes | – |
| every owned room RCL3+ with a spawn (`allRoomsMinRcl`) | yes | yes | – |
| CPU bucket `minBucket` (8000) | – | yes | – |
| a funder: RCL5+, 50k storage, no hostiles | – | yes | – |
| 2 sources, no owner, reservation, towers, keepers | – | yes | – |

Within 20 ticks the console says what became of a manual claim: `Claiming
W48N25 -> W48N24 from W49N25` when it runs, or `Claim of W48N25 dropped:
W48N26 is RCL2 (every room needs RCL3 and a spawn); add reclaim: true to
force it` (or `dropped: GCL full`) when a gate stops it, after which
`Memory.empire.claim` is `null` again. Typing the assignment itself only
echoes `[object Object]`.

### Forcing a claim

`reclaim: true` treats the target like a lost room of ours: it skips the
`enabled` and RCL gates and spawns the claimer at priority 450 (before
soldiers and workers). The log then says `Reclaimed W48N25` instead of
`Expansion W48N25 claimed`.

```js
Memory.empire.claim = { target: 'W48N25', from: 'W49N25', t: Game.time, reclaim: true }
```

### Automatic expansion

Every 20 ticks with no claim running, all gates passed and a free slot:

- **Candidates**: rooms one or two exits from each funder
  (`maxLinearDistance` 2), not owned, not abandoned, not blacklisted, not a
  highway, keeper room, avoided or novice/respawn room.
- **Scouting**: candidates without intel younger than 30000 ticks are queued
  (`Memory.empire.scoutQueue`, up to 12) and a 1-MOVE scout from the first
  funder visits them. Each room is queued at most once per 5000 ticks.
- **Score**: `sources × 100 − distance × 50 + owned neighbours × 20`; only
  2-source rooms with a free controller qualify. The best one becomes
  `Memory.empire.claim` (`Expansion target: W48N24 (from W49N25)`).

Which scouted rooms would qualify:

```js
Object.keys(Memory.empire.intel).filter(n => {
    const i = Memory.empire.intel[n];
    return i.ctrl && !i.owner && !i.reserved && !i.keeper && !i.towers && i.sources >= 2;
})
Memory.empire.intel.W48N25            // { t, sources, ctrl, owner, reserved, level, towers, keeper }
```

### Stopping and steering

| You want | Command |
|---|---|
| Drop the current claim (a new automatic one may follow in 20 ticks) | `Memory.empire.claim = null` |
| Skip the rest of a claim list, finish the current room | `Memory.empire.claim.next = []` |
| Also kill a claimer already on its way | `_.filter(Game.creeps, c => c.memory.role === 'claimer').forEach(c => c.suicide())` |
| Never pick a room automatically for 20000 ticks | `Memory.empire.blacklist.W48N24 = Game.time` |
| Never claim or reclaim a room (until deleted) | `Memory.empire.abandoned.W48N24 = Game.time` |
| Keep creeps out of a room entirely | `Memory.avoidRooms = ['W48N24']` |
| No automatic expansion at all | `expansion.enabled: false` in `config.js` and deploy |
| Free a slot for a better room | `Memory.empire.release = 'W48N26'` (unclaims it, marks it abandoned) |

`blacklist` and `abandoned` only steer the automatic pick; a manual
`Memory.empire.claim` ignores them.

### Watching progress

```js
JSON.stringify(Memory.empire.claim)   // { target, from, t[, reclaim][, next, done] } or null
_.filter(Game.creeps, c => c.memory.role === 'claimer').map(c => c.name + ' ' + c.pos + ' ttl=' + c.ticksToLive)
_.filter(Game.creeps, c => c.memory.home === 'W48N25').map(c => c.name + ' ' + c.memory.role)   // helpers in the new room
Game.rooms.W48N25.find(FIND_MY_CONSTRUCTION_SITES).map(s => s.structureType + ' ' + s.progress + '/' + s.progressTotal)
Memory.empire.wants                   // what the empire asked rooms to spawn this pass
```

The 100-tick summary shows `claim=W48N25` while a claim runs. Log lines:
`Expansion target: …`, `Claimed …`, `Expansion … claimed; helpers will
build the spawn`, `Claim of … timed out`, `… is owned by …; dropping claim`.
Email: `Claimed room …`.

### Settings (`config.expansion`, `config.reclaim`)

| Key | Default | |
|---|---|---|
| `expansion.enabled` | true | automatic and manual claims (reclaim ignores it) |
| `expansion.minBucket` | 8000 | CPU bucket for picking a new room |
| `expansion.funderMinRcl`, `funderMinStorage` | 5, 50000 | rooms that fund and scout an automatic expansion |
| `expansion.allRoomsMinRcl` | 3 | no claim while any owned room is below this |
| `expansion.maxLinearDistance` | 2 | candidate reach from a funder |
| `expansion.helpers` | 3 | workers for a claimed room without a spawn |
| `expansion.helperMinRcl`, `minHelpers` | 4, 1 | RCL a room needs to send the full team; workers sent otherwise |
| `expansion.claimTimeout` | 4000 | ticks before a claim is dropped and blacklisted |
| `reclaim.minStructures` | 5 | owned structures that make a spawnless lost room worth reclaiming |
| `reclaim.spawnerMinRcl`, `maxLinearDistance` | 3, 3 | who sends the reclaim claimer, and from how far |
| `reclaim.retry` | 20000 | ticks before a timed-out reclaim is tried again |

## Files

| File | Role |
|------|------|
| `main.js` | Game loop, error isolation, logging, pixels |
| `config.js` | Tunables |
| `util.js` | Caches, movement, room helpers, logging |
| `bodies.js` | Body plans by energy budget |
| `roomState.js` | Per-tick room snapshot and creep index |
| `planner.js` | Layout, spawn un-boxing, cleanup, perimeter ramparts |
| `mincut.js` | Minimum cut between exits and the base (perimeter tiles) |
| `spawner.js` | Population targets and spawning |
| `roles.js` | Creep behaviours |
| `war.js` | Offensive squads: muster, rally, march, the way into the target, clear, controller attack (Memory.war) |
| `defense.js` | Towers and safe mode |
| `logistics.js` | Links and terminal balancing |
| `empire.js` | Helpers, couriers, scouting, claiming |
| `remote.js` | Remote mining: picking rooms, spawn requests, danger |
| `industry.js` | Hub, mineral mining, terminal network, labs, boosts, factory |
| `adopt.js` | Memory migration and legacy creep adoption |

## Console

Every 100 ticks: `rooms=N/GCL creeps=N cpu~X/limit bucket=N` (plus `remotes=N`
while rooms are mined remotely). Every 500 ticks a
line per room (RCL, energy, storage, sites, downgrade timer, creeps by role).
Warnings in orange, errors and safe mode in red.

### Console commands

War: see [War](#war) above. Claiming rooms: see [Colonizing](#colonizing).
Remote rooms: see [Remote mining](#remote-mining). Hub, labs and boosts: see
[Minerals, labs and the factory](#minerals-labs-and-the-factory).

Rooms:

```js
Memory.avoidRooms = ['E11N36']        // creeps never enter these rooms (overrides config.avoidRooms)
Memory.avoidRooms = []                // disable avoidance without a deploy
delete Memory.avoidRooms              // back to the config list
Memory.empire.release = 'E11N39'      // give a room up when GCL is full so a lost room can be reclaimed
delete Memory.empire.abandoned.E11N39 // allow a released room to be taken again
Memory.empire                         // claim target, scout queue, blacklist, abandoned rooms
```

Status:

```js
Game.gcl.level                        // room slots; the 100-tick summary shows rooms=owned/GCL
_.filter(Game.creeps, c => c.memory.role === 'soldier').length
_.filter(Game.creeps, c => c.memory.role === 'unclaimer').map(c => c.name + ' ' + c.pos)
JSON.stringify(Memory.war)            // full war state
Game.rooms.E11N36.controller.ticksToDowngrade // controller attack progress (needs vision)
Game.rooms.E11N36.controller.safeMode // ticks of safe mode left in the target (needs vision)
```

## Tuning

`config.js`: population caps, courier/terminal thresholds, expansion gating,
planner intervals, `pixels`, `signature`, path visuals (`pathStyle`,
`pathStyleWar`) and the `war` block (see [War settings](#settings-configwar)).
