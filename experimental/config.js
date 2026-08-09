/**
 * Tunables for the expansion-focused colony AI.
 * No room names hard-coded — everything discovers live game state.
 */

module.exports = {
    // Applied on owned controllers while upgrading (one intent/tick, no extra trips)
    signature: '🐸',

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
        // One scout per mature room — flood the frontier
        scouts: 1,
        // Pioneers sent to claim targets / spawnless rooms
        pioneersPerTarget: 4,
        // Race claims: send a spare claimer per target
        claimersPerTarget: 2,
        remoteMinersPerSource: 1,
        remoteHaulersPerSource: 2,
        reserversPerRemote: 1,
    },

    expansion: {
        // Claim when owned rooms < GCL and a home room is healthy
        enabled: true,
        // Expand as soon as a neighbor room can fund a claimer
        minHomeRcl: 2,
        // Prefer rooms with this many sources (1-source neighbors still claimed)
        preferSources: 2,
        // Stay glued to the border — claim outwards from current rooms
        maxRange: 2,
        // Strongly prefer orthogonally adjacent rooms over anything further
        preferAdjacent: true,
        // Claim every free GCL slot in parallel
        parallelClaims: true,
        // How often (ticks) to re-evaluate expansion targets
        replanInterval: 50,
        // Scout refresh
        scoutInterval: 100,
        // Remote mining adjacent neutrals — pressure every border
        remotes: true,
        maxRemotesPerRoom: 4,
        // Cap remotes empire-wide (raise if CPU allows)
        maxRemotesTotal: 24,
    },

    // Legacy role names from the default branch — treat as workers
    legacyWorkerRoles: ['ant', 'builder', 'harvester', 'upgrader', 'repairer'],
};
