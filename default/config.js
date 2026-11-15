/**
 * Tunables. Everything else is discovered from live game state.
 * Room names are never hard-coded.
 */
module.exports = {
    // Rooms our creeps must never enter, path through, scout, claim or
    // reclaim. Empty by default; the war squad (Memory.war.target) may still
    // attack a listed room. Console override without a deploy:
    // Memory.avoidRooms = [...] (replaces this list; [] disables it).
    avoidRooms: [],

    // Bump to re-run the one-time Memory migration (old branch data is dropped).
    version: 3,
    signature: '🐸',
    // Shuffle body part order on spawn. Off: TOUGH first, MOVE last (damage eats parts front to back).
    shuffleBody: true,
    // Speech bubbles cost CPU; keep off unless debugging.
    say: false,
    visuals: true,
    // Draw each walking creep's path ahead of it (needs visuals). Soldiers use pathStyleWar.
    pathStyle: { stroke: '#ffffff', opacity: 0.25, lineStyle: 'dashed', strokeWidth: 0.1 },
    pathStyleWar: { stroke: '#ff3333', opacity: 0.5, lineStyle: 'dashed', strokeWidth: 0.15 },
    // Console summary interval (ticks).
    logEvery: 100,
    // Generate pixels when the bucket is full and average CPU is comfortable.
    pixels: true,

    planner: {
        version: 1,
        interval: 100,          // ticks between planning passes per room (staggered)
        maxPassesPerTick: 3,    // planner passes allowed empire-wide per tick (CPU spikes)
        maxSitesPerRoom: 10,    // soft cap, further limited by the 100-site account limit
        spawnFreeTiles: 3,      // destroy cheap blockers until every active spawn has this many exits
        pruneInactive: true,    // remove RCL-inactive extensions/towers that sit off the checkerboard
        roadsFromRcl: 3,
        rampartsFromRcl: 4,     // ramparts over spawns, towers, storage and terminal
        // Once nothing else is left to build and the room has spare energy
        // (defense.workerFortify), cover these too.
        coverFromRcl: 5,
        coverTypes: ['lab', 'factory', 'powerSpawn', 'nuker', 'observer', 'link', 'extension'],
        rampartTarget: { 4: 20000, 5: 50000, 6: 100000, 7: 300000, 8: 1000000 },
        // Perimeter: a rampart line on the fewest tiles that cut every exit off
        // from the base (min-cut), keeping this many tiles of room around our
        // structures where the terrain allows. Recomputed when the base grows.
        wallFromRcl: 4,
        wallMargin: 3,
    },

    population: {
        maxBootstrapWorkers: 3,
        maxHaulers: 4,
        maxUpgraders: 4,
        maxWorkers: 3,
        maxDefenders: 2,
        // Treat a controller as endangered below this fraction of its downgrade timer.
        downgradeAlarm: 0.5,
    },

    defense: {
        towerRepairMinEnergy: 600,
        // Towers only grow ramparts toward the target when storage holds this much.
        fortifyMinStorage: 50000,
        // Repair non-rampart structures (roads, containers) below this fraction of max hits.
        repairBelow: 0.5,
        // With nothing to build or repair, workers thicken ramparts toward
        // planner.rampartTarget instead of upgrading, once this much energy sits in
        // storage (or in the source containers of a room without storage). They stop
        // when it falls below half. Ramparts over spawns, towers, storage and terminal
        // go first, then the rest; the room gets one extra worker for it.
        workerFortify: { storage: 20000, containers: 1500 },
        // A fortifying worker raises the weakest rampart by this many hits, then
        // moves on to whichever is weakest now, so the whole line rises evenly.
        fortifyStep: 10000,
    },

    links: { minSend: 400 },

    // Offensive squads, driven from the console through Memory.war:
    //   Memory.war = { muster: true }        every room accumulates soldiers (up to maxPerRoom)
    //   Memory.war.target = 'W1N1'           gather at the rally room, then march in and kill everything
    //   Memory.war.go = true                 skip the gathering wait and march now
    //   delete Memory.war.target             soldiers return home (still kept while muster is on)
    //   Memory.war.muster = false            stop spawning; idle soldiers recycle themselves
    // Optional: Memory.war.rally = 'W1N1' (owned staging room, else the one nearest the target),
    // Memory.war.wave = N (soldiers that must gather before marching; default: all alive).
    war: {
        maxPerRoom: 10,         // soldiers each room keeps while mustering
        minRcl: 4,
        minStorage: 20000,      // rooms with less stored energy sit the war out (ignored with Memory.war.cheap)
        // Memory.war.cheap = true: low-energy muster. No storage gate, each soldier is
        // built from the energy on hand once the room holds this much (capped at the
        // room's capacity), and haulers spend the terminal reserve. A number instead
        // of true sets the floor: Memory.war.cheap = 500.
        cheapMin: 300,
        priority: 480,          // below miners/haulers/upgraders, above builders
        healers: 0.3,           // share of the squad that heals
        ranged: 0.3,            // share of the fighters that shoot (the rest are melee)
        // Last stage in the target: once no uncovered enemy is left, hit the closest thing with
        // hit points that is not ours: ramparts, walls, containers, covered and ownerless
        // structures (not the controller, roads, portals, keeper lairs or power banks).
        finalSweep: true,
        razeAll: true,          // finalSweep off: after the owned structures also flatten containers
        // Outside our rooms, harmless structures (not towers, spawns, extensions or nukers) that
        // still hold energy or other resources are left standing so it is all there when we
        // settle the room.
        spareEnergy: true,
        closestFirst: true,     // hit whatever uncovered creep or structure is nearest (false: towers/armed creeps first)
        // "Nearest" is counted along the way there, not in a straight line: one search per tick gives
        // every tile its cost in ticks to the nearest target, walking around walls where that is
        // quicker and going through a wall or hostile rampart where it is not (its hits divided by
        // what the two strongest soldiers in the room deal per tick). A wall on the way is broken by
        // whoever stands at it, strongest in front, the rest queue. false: straight-line distance, and
        // walls are only hit by a soldier whose path search came back empty.
        breach: true,
        // On the way (march, rally, walk home) soldiers turn on armed enemy creeps (ATTACK or
        // RANGED_ATTACK) that come within this many tiles; unarmed creeps are let go. 0: walk past.
        engageRange: 5,
        // Rooms where nothing is spared: walls and rampart-covered structures join the
        // closest-first pool instead of being skipped. Console: Memory.war.everything = true.
        unrestrictedRooms: [],
        // Memory.war.unclaim = true (or a number of creeps per strike, up to 8): CLAIM creeps hit the target's controller every time
        // its 1000-tick attack block runs out (-300 downgrade ticks per CLAIM part; the owner
        // cannot upgrade or start safe mode while it is blocked) until it goes neutral.
        unclaimRange: 3,        // linear rooms from the spawning room (a CLAIM creep lives 600 ticks)
        unclaimSync: 350,       // ticks the first unclaimer at an open controller waits for the rest of the team
        unclaimWindow: 330,     // spawn ticks a room may spend on one team; bodies shrink to fit (more spawns, bigger bodies)
        unclaimLead: 500,       // spawn this many ticks before the controller can be attacked again (energy fill + travel)
        maxGather: 600,         // ticks after the target is set before a partial squad marches anyway
        gatherShare: 0.8,       // fraction of the wave that must stand at the rally point
    },

    // Long-distance haulers moving energy from rich storages into weak neighbours.
    courier: {
        donorMinStorage: 150000,
        donorStopStorage: 80000,
        recipientMaxStorage: 30000,
        maxLinearDistance: 2,
        perRecipient: 2,
    },

    // Remote mining: sources in the unowned rooms next to ours (remote.js).
    // One new room per empire pass at most, and only while the CPU bucket is
    // comfortable; a home pays for the miners, haulers, reserver and guards
    // out of its own spawn. Memory.empire.remotes holds what is mined.
    remote: {
        enabled: true,
        minRcl: 4,              // homes below this (or without storage) mine no remotes
        perRoom: 2,             // remote rooms per home (one more with a second spawn)
        maxDist: 110,           // path tiles from the home storage to a source
        maxSpawnLoad: 0.75,     // share of a home's spawn time its creeps may take, remotes included
        minBucket: 6000,        // CPU bucket needed to take on another remote
        pauseBucket: 2000,      // below this no remote creep is replaced (they die out, the load drops)
        intelTtl: 10000,        // ticks before a neighbour is scouted again
        reserve: true,          // CLAIM creeps reserve the controller: sources give 3000 instead of 1500
        reserveBelow: 1500,     // send a reserver when the reservation has fewer ticks left
        reserveClaims: 4,       // CLAIM parts per reserver at most (2 at least, else none is sent)
        containers: true,       // miners build and maintain a container under their feet
        guardMaxParts: 30,      // invader groups with more ATTACK/RANGED/HEAL parts are waited out, not fought
        playerPause: 300,       // ticks our creeps stay out after another player's armed creeps were seen
        maxRaids: 6,            // this many raids within raidWindow and the room is given up for 20000 ticks
        raidWindow: 20000,
    },

    // Minerals, labs, factory and the terminal network (industry.js). One room
    // is the hub (Memory.empire.hub, picked automatically; set it from the
    // console to move it): terminals send everything that is not energy there.
    industry: {
        enabled: true,
        // Mining: an extractor and a miner only while the empire holds less than
        // mineralCap of that mineral and the room less than roomStock.
        mineralCap: 60000,
        roomStock: 30000,
        minEnergy: 5000,        // storage energy a room needs before it spawns a mineral miner
        minerEnergy: 1500,      // energy for the miner's body (2 WORK : 1 MOVE)
        // Terminal network.
        hubCap: 60000,          // the hub takes each resource up to this much (storage + terminal)
        batteryCap: 300000,     // ... and this many batteries
        terminalMax: 100000,    // non-energy a terminal away from the hub holds at most
        batch: 5000,            // largest single shipment
        feeEnergy: 3000,        // energy kept in a terminal that has something to ship
        chemistAt: 3000,        // units waiting to be carried inside a room before it gets a chemist
        // Labs (hub only).
        labBatch: 1000,         // units of product per reaction run
        labMin: 200,            // a reaction needs this much of each reagent in the room
        // What the labs make, in this order, until the room holds `keep` of it. Reagents that
        // are missing are made first. Console override: Memory.empire.labGoals = [{ res, keep }].
        goals: [{ res: 'GH', keep: 3000 }],
        // Memory.war.boost = true: one lab per body part in this order, loaded with the
        // strongest boost in stock; soldiers from within boostRange rooms come by before they march.
        warBoosts: [ATTACK, HEAL, TOUGH, RANGED_ATTACK, MOVE],
        boostRange: 4,
        factoryMin: 5000,       // batteries in the empire before the hub builds a factory (RCL7)
    },

    terminal: {
        interval: 100,
        keep: 40000,            // energy haulers keep in each active terminal
        donorStorage: 400000,
        receiverStorage: 150000,
        amount: 25000,
    },

    expansion: {
        enabled: true,
        minBucket: 8000,
        funderMinRcl: 5,
        funderMinStorage: 50000,
        allRoomsMinRcl: 3,      // never claim while any owned room is weaker than this
        maxLinearDistance: 2,
        helpers: 3,             // workers sent to a claimed room without a spawn
        helperMinRcl: 4,        // the full team only comes from a room at least this developed
        minHelpers: 1,          // otherwise any room with a working spawn sends this many
        claimTimeout: 4000,
    },

    // Rooms whose controller was lost while our buildings still stand are
    // claimed back before any new expansion, from the nearest capable room.
    reclaim: {
        enabled: true,
        minStructures: 5,       // without a surviving spawn, this many owned structures still qualify
        spawnerMinRcl: 3,       // a claimer costs 650 energy
        maxLinearDistance: 3,   // a CLAIM creep lives 600 ticks
        retry: 20000,           // ticks before a timed-out reclaim is tried again
    },

    cpu: {
        plannerMinBucket: 1000,
        empireMinBucket: 3000,
    },
};
