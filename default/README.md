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
  workers for building and repairs. Bodies scale with the room's energy
  capacity; the spawn waits for energy instead of producing stubs (except in
  emergencies).
- **Base repair**: frees spawns that were boxed in by structures (destroys the
  cheapest chain of extensions/walls), opens walled pockets, removes
  unreachable extensions, prunes RCL-inactive structures that sit off the
  checkerboard grid, reconnects sources to the controller area.
- **Planner**: checkerboard layout around the first spawn, nothing non-walkable
  next to a spawn, containers at sources and controller, towers, storage,
  links, terminal, extra spawns, roads (RCL3+), ramparts on key structures
  (spawns, towers, storage, terminal) from RCL4. From RCL5, once nothing else
  is left to build and the room has spare energy, it also covers labs,
  factory, power spawn, nuker, observer, links and extensions
  (`planner.coverTypes`).
- **Defense**: towers focus the most dangerous hostile they can actually
  wear down (tower falloff, boosted TOUGH and nearby HEAL are counted); when
  every hostile out-heals them they hold fire and repair the weakest rampart
  within range 3 of a hostile instead. Otherwise they heal creeps, repair
  roads/containers and ramparts (fortify only when storage is healthy). Safe
  mode when critical structures take damage, when a tower-less room has
  hostiles at the spawn, or when the controller is attacked.
- **Ramparts with spare energy**: new ramparts are repaired to 3k before more
  are built (they start at 1 hit and decay), and every rampart is kept at
  20k at least. When there is nothing to build or repair and the room holds
  spare energy (20k in storage, or 1.5k in the source containers of a room
  without storage; `defense.workerFortify`), the worker thickens ramparts
  toward `planner.rampartTarget` (RCL5 50k, RCL6 100k, RCL7 300k, RCL8 1M)
  instead of upgrading: ramparts over spawns, towers, storage and terminal
  first, weakest first, then the rest. The room spawns one extra worker
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
- **Traffic**: parked miners are routed around, jammed creeps push idle
  neighbours aside, spawns push creeps off their exits, unreachable targets are
  dropped.
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
   melee (ATTACK/MOVE pairs, spare energy buys TOUGH). Soldiers spawn at
   priority 480: after miners, haulers and upgraders, before workers.
   Without a target they wait at home and fight anything that enters it.
2. **Rally** (`Memory.war.target = 'E11N36'`): the squad gathers in the
   owned room nearest the target (`Memory.war.rally` overrides), walking
   around the target. The wave is the number of soldiers alive when the
   target was set (`Memory.war.wave` overrides).
3. **March**: once `gatherShare` (80%) of the wave stands at the rally point,
   or `maxGather` (600) ticks have passed with at least one there, or
   `Memory.war.go` is set, everyone marches in. Healers stick to fighters.
4. **Destroy**, closest first (`closestFirst`):
   1. hostile creeps and hostile structures that are **not** under a
      rampart (hits on a covered target only dent the rampart);
   2. **final sweep** (`finalSweep`): once none is left, everything with hit
      points that is not ours: ramparts, walls, roads, containers, whatever
      the ramparts covered, ownerless leftovers. Never the controller,
      portals, keeper lairs or power banks (they hit back), never anything
      in our own rooms.
5. **Cleared**: when nothing destroyable is left the room is marked cleared
   (emailed) and the squad holds its centre. If something new appears the
   fight resumes.

Safe mode in the target: the squad waits at the rally room (⏳) and marches
again when it ends. Rooms in `unrestrictedRooms` (or `Memory.war.everything =
true`) skip the waiting order: walls and covered structures are hit from the
start. With `closestFirst: false` armed creeps and loaded towers go first;
with `finalSweep: false` the old ending applies (ownerless roads and
containers, then the whole squad on the weakest rampart, walls only when
they block the path).

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
| 💀 | soldier marching on or fighting in the target |
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
| `finalSweep` | true | destroy everything destroyable at the end |
| `razeAll` | true | old ending only: roads and containers |
| `unrestrictedRooms` | `[]` | rooms where nothing is spared from the start |
| `maxGather`, `gatherShare` | 600, 0.8 | when a partial squad marches |
| `unclaimRange`, `unclaimLead`, `unclaimSync`, `unclaimWindow` | 3, 500, 350, 330 | unclaimer reach, spawn lead, team wait, spawn ticks per team |

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
  haulers into our storage (RCL4+), else the terminal (RCL6+). Tombstones
  and ruins in our rooms are emptied the same way. Without either, it stays
  where it is.

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
| `planner.js` | Layout, spawn un-boxing, cleanup |
| `spawner.js` | Population targets and spawning |
| `roles.js` | Creep behaviours |
| `war.js` | Offensive squads: muster, rally, march, clear, controller attack (Memory.war) |
| `defense.js` | Towers and safe mode |
| `logistics.js` | Links and terminal balancing |
| `empire.js` | Helpers, couriers, scouting, claiming |
| `adopt.js` | Memory migration and legacy creep adoption |

## Console

Every 100 ticks: `rooms=N/GCL creeps=N cpu~X/limit bucket=N`. Every 500 ticks a
line per room (RCL, energy, storage, sites, downgrade timer, creeps by role).
Warnings in orange, errors and safe mode in red.

### Console commands

War: see [War](#war) above. Claiming rooms: see [Colonizing](#colonizing).

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
