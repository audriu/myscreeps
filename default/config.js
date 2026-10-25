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
        rampartsFromRcl: 4,
        rampartTarget: { 4: 20000, 5: 50000, 6: 100000, 7: 300000, 8: 1000000 },
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
    },

    links: { minSend: 400 },

    // Offensive squads, driven from the console through Memory.war:
    //   Memory.war = { muster: true }        every room accumulates soldiers (up to maxPerRoom)
    //   Memory.war.target = 'E11N36'         gather at the rally room, then march in and kill everything
    //   Memory.war.go = true                 skip the gathering wait and march now
    //   delete Memory.war.target             soldiers return home (still kept while muster is on)
    //   Memory.war.muster = false            stop spawning; idle soldiers recycle themselves
    // Optional: Memory.war.rally = 'W1N1' (owned staging room, else the one nearest the target),
    // Memory.war.wave = N (soldiers that must gather before marching; default: all alive).
    war: {
        maxPerRoom: 10,         // soldiers each room keeps while mustering
        minRcl: 4,
        minStorage: 20000,      // rooms with less stored energy sit the war out
        priority: 480,          // below miners/haulers/upgraders, above builders
        healers: 0.3,           // share of the squad that heals
        ranged: 0.3,            // share of the fighters that shoot (the rest are melee)
        razeAll: true,          // after the owned structures: also flatten roads and containers (walls are kept)
        closestFirst: true,     // hit whatever uncovered creep or structure is nearest (false: towers/armed creeps first)
        // Rooms where nothing is spared: walls and rampart-covered structures join the
        // closest-first pool instead of being skipped. Console: Memory.war.everything = true.
        unrestrictedRooms: ['E11N31'],
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
