/**
 * Tunables. Everything else is discovered from live game state.
 * Room names are never hard-coded.
 */
module.exports = {
    // Bump to re-run the one-time Memory migration (old branch data is dropped).
    version: 3,
    signature: '🐸',
    // Speech bubbles cost CPU; keep off unless debugging.
    say: false,
    visuals: true,
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

    cpu: {
        plannerMinBucket: 1000,
        empireMinBucket: 3000,
    },
};
