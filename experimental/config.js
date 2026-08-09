/**
 * Tunables for the expansion-focused colony AI.
 * No room names hard-coded — everything discovers live game state.
 */

module.exports = {
    signature: '🐸 experimental',

    // Soft CPU guard: skip scouting/construction when bucket is low
    cpu: {
        lowBucket: 2000,
        criticalBucket: 500,
    },

    // Max construction sites to keep open per owned room
    maxSitesPerRoom: 8,

    // Road building (CPU heavy — place sparingly)
    roads: {
        enabled: true,
        // Only plan roads once room has storage or RCL >= this
        minRcl: 3,
    },

    // Rampart/wall repair ceilings (keep towers busy but not forever)
    fortify: {
        wallHits: 20000,
        rampartHits: 20000,
        // Raise ceiling once RCL is high
        wallHitsLate: 500000,
        rampartHitsLate: 500000,
        lateRcl: 6,
    },

    // Population targets scale with sources and RCL (see spawnManager)
    population: {
        // Always keep at least this many generalist workers in young rooms
        minWorkers: 2,
        maxWorkers: 8,
        // Haulers per source once miners exist
        haulersPerSource: 1,
        // Extra haulers when storage exists
        storageHaulers: 1,
        upgraders: {
            1: 2,
            2: 2,
            3: 2,
            4: 2,
            5: 3,
            6: 3,
            7: 3,
            8: 1, // RCL8: trickle only
        },
        builders: 2,
        defendersPerThreat: 2,
        scouts: 1,
        // Pioneers sent to claim targets / spawnless rooms
        pioneersPerTarget: 3,
        remoteMinersPerSource: 1,
        remoteHaulersPerSource: 1,
        reserversPerRemote: 1,
    },

    expansion: {
        // Claim when owned rooms < GCL and a home room is healthy
        enabled: true,
        // Home room must be at least this RCL before funding expansion
        minHomeRcl: 3,
        // Prefer rooms with this many sources
        preferSources: 2,
        // Max claim distance in room-hops from any owned room
        maxRange: 3,
        // How often (ticks) to re-evaluate expansion targets
        replanInterval: 500,
        // Scout refresh
        scoutInterval: 300,
        // Remote mining adjacent neutrals
        remotes: true,
        maxRemotesPerRoom: 2,
        // Hard cap across the whole empire (important when you already own many rooms)
        maxRemotesTotal: 8,
    },

    // Legacy role names from the default branch — treat as workers
    legacyWorkerRoles: ['ant', 'builder', 'harvester', 'upgrader', 'repairer'],
};
