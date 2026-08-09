/**
 * Spawning: discover needs from live room state, scale bodies, no hard-coded rooms.
 */

const config = require('config');
const lib = require('lib');
const bodies = require('bodies');

function creepsHome(roomName, role) {
    return lib.creepsBy(c => lib.roleOf(c) === role && lib.homeOf(c) === roomName);
}

function creepsTarget(roomName, role) {
    return lib.creepsBy(c => lib.roleOf(c) === role && c.memory.targetRoom === roomName);
}

function energyBudget(room) {
    // Prefer capacity for proper bodies; fall back to available when starving
    const cap = room.energyCapacityAvailable;
    const avail = room.energyAvailable;
    if (avail < 200) return avail;
    // If we have very few creeps, spawn whatever we can afford
    const myCreeps = lib.creepsBy(c => lib.homeOf(c) === room.name).length;
    if (myCreeps < 3) return avail;
    // Otherwise wait for fuller extensions (at least 50% or miner-sized)
    if (avail >= Math.min(cap, Math.max(550, Math.floor(cap * 0.5)))) return avail;
    if (avail >= cap) return avail;
    return avail; // still allow — spawnCreep checks cost
}

function wantedForRoom(room) {
    const mem = Memory.rooms[room.name] || {};
    const sources = room.find(FIND_SOURCES);
    const sourceCount = sources.length || (mem.sources && mem.sources.length) || 1;
    const rcl = room.controller.level;
    const phase = mem.phase || 'bootstrap';
    const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    const hasStorage = !!room.storage;

    const wanted = [];

    // Defenders first under threat
    if (hostiles > 0) {
        wanted.push({
            role: 'defender',
            count: Math.min(4, hostiles * config.population.defendersPerThreat),
            targetRoom: room.name,
            priority: 100,
            body: bodies.defender,
        });
    }

    if (phase === 'bootstrap' || phase === 'pioneer') {
        // Generalists until economy stands up
        const workers = Math.min(
            config.population.maxWorkers,
            Math.max(config.population.minWorkers, sourceCount * 3)
        );
        wanted.push({
            role: 'worker',
            count: workers,
            targetRoom: room.name,
            priority: 90,
            body: bodies.worker,
        });
        return wanted;
    }

    // Miners: one per source
    wanted.push({
        role: 'miner',
        count: sourceCount,
        targetRoom: room.name,
        priority: 95,
        body: bodies.miner,
        assignSources: true,
    });

    // Haulers
    let haulers = sourceCount * config.population.haulersPerSource;
    if (hasStorage) haulers += config.population.storageHaulers;
    if (rcl >= 5) haulers += 1;
    wanted.push({
        role: 'hauler',
        count: haulers,
        targetRoom: room.name,
        priority: 85,
        body: bodies.hauler,
    });

    // Upgraders
    const upCount = (config.population.upgraders[rcl] != null)
        ? config.population.upgraders[rcl]
        : 2;
    wanted.push({
        role: 'upgrader',
        count: upCount,
        targetRoom: room.name,
        priority: 50,
        body: bodies.upgrader,
    });

    // Builders when sites exist or low RCL development
    const builderCount = sites > 0
        ? Math.min(4, Math.max(config.population.builders, Math.ceil(sites / 4)))
        : (rcl < 4 ? 1 : 0);
    if (builderCount > 0) {
        wanted.push({
            role: 'builder',
            count: builderCount,
            targetRoom: room.name,
            priority: 60,
            body: bodies.builder,
        });
    }

    // Keep a couple workers as flexible glue
    wanted.push({
        role: 'worker',
        count: phase === 'develop' ? 2 : 1,
        targetRoom: room.name,
        priority: 40,
        body: bodies.worker,
    });

    // Scout
    if (config.expansion.enabled && rcl >= 2) {
        wanted.push({
            role: 'scout',
            count: config.population.scouts,
            targetRoom: null,
            priority: 20,
            body: () => bodies.scout(),
        });
    }

    return wanted;
}

function empireWants() {
    const wanted = [];
    if (!config.expansion.enabled) return wanted;

    const owned = lib.ownedRooms();
    const gcl = Game.gcl.level;
    const targets = (Memory.empire && Memory.empire.expansionTargets && Memory.empire.expansionTargets.length)
        ? Memory.empire.expansionTargets
        : ((Memory.empire && Memory.empire.expansionTarget) ? [Memory.empire.expansionTarget] : []);

    const claimersWanted = config.population.claimersPerTarget || 2;
    const freeSlots = Math.max(0, gcl - owned.length);

    // Claim every open target in parallel (up to free GCL slots)
    for (const target of targets.slice(0, Math.max(freeSlots, targets.length))) {
        if (freeSlots <= 0) break;

        wanted.push({
            role: 'claimer',
            count: claimersWanted,
            targetRoom: target,
            priority: 92,
            body: () => bodies.claimer(),
            fromNearestTo: target,
        });

        const targetRoom = Game.rooms[target];
        const needsPioneer = !targetRoom ||
            !targetRoom.controller ||
            !targetRoom.controller.my ||
            targetRoom.find(FIND_MY_SPAWNS).length === 0;

        if (needsPioneer) {
            wanted.push({
                role: 'pioneer',
                count: config.population.pioneersPerTarget,
                targetRoom: target,
                priority: 86,
                body: bodies.pioneer,
                fromNearestTo: target,
            });
        }
    }

    // Also pioneer any owned room missing a spawn
    for (const room of owned) {
        if (room.find(FIND_MY_SPAWNS).length === 0) {
            wanted.push({
                role: 'pioneer',
                count: config.population.pioneersPerTarget,
                targetRoom: room.name,
                priority: 94,
                body: bodies.pioneer,
                fromNearestTo: room.name,
            });
        }
    }

    // Remotes — pressure every assigned border room
    if (config.expansion.remotes && Memory.empire && Memory.empire.remotes) {
        for (const remoteName in Memory.empire.remotes) {
            const remote = Memory.empire.remotes[remoteName];
            if (!remote || !remote.home) continue;
            const sourceCount = remote.sources || 1;

            wanted.push({
                role: 'remoteMiner',
                count: sourceCount * config.population.remoteMinersPerSource,
                targetRoom: remoteName,
                home: remote.home,
                priority: 70,
                body: bodies.remoteMiner,
                spawnIn: remote.home,
                assignSources: true,
            });
            wanted.push({
                role: 'remoteHauler',
                count: sourceCount * config.population.remoteHaulersPerSource,
                targetRoom: remoteName,
                home: remote.home,
                priority: 69,
                body: bodies.remoteHauler,
                spawnIn: remote.home,
            });
            wanted.push({
                role: 'reserver',
                count: config.population.reserversPerRemote,
                targetRoom: remoteName,
                home: remote.home,
                priority: 60,
                body: bodies.reserver,
                spawnIn: remote.home,
            });
        }
    }

    return wanted;
}

function pickSpawn(roomName) {
    const room = Game.rooms[roomName];
    if (!room) return null;
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (!spawns.length) return null;
    // Prefer spawn with most adjacent free energy? just first
    return spawns[0];
}

function nearestOwnedRoom(roomName, minRcl) {
    minRcl = minRcl || 1;
    let best = null;
    let bestDist = Infinity;
    for (const room of lib.ownedRooms()) {
        if (room.controller.level < minRcl) continue;
        if (!room.find(FIND_MY_SPAWNS).length) continue;
        const d = lib.roomDistance(room.name, roomName);
        if (d < bestDist) {
            bestDist = d;
            best = room;
        }
    }
    return best;
}

function countMatching(want) {
    return lib.countCreeps(c => {
        if (lib.roleOf(c) !== want.role) return false;
        if (want.home && lib.homeOf(c) !== want.home) return false;
        if (want.targetRoom && c.memory.targetRoom !== want.targetRoom) return false;
        if (!want.targetRoom && !want.home && want.role === 'scout') {
            return lib.homeOf(c) != null;
        }
        if (!want.home && want.targetRoom && want.role !== 'claimer' && want.role !== 'pioneer' &&
            want.role !== 'remoteMiner' && want.role !== 'remoteHauler' && want.role !== 'reserver') {
            return lib.homeOf(c) === want.targetRoom || c.memory.targetRoom === want.targetRoom;
        }
        if (!want.targetRoom && want.role === 'scout') {
            // counted per home separately — see below
            return true;
        }
        return true;
    });
}

function countForWant(want, homeRoom) {
    return lib.countCreeps(c => {
        if (lib.roleOf(c) !== want.role) return false;
        if (want.role === 'scout') return lib.homeOf(c) === homeRoom.name;
        if (want.role === 'claimer' || want.role === 'pioneer') {
            return c.memory.targetRoom === want.targetRoom;
        }
        if (want.role === 'remoteMiner' || want.role === 'remoteHauler' || want.role === 'reserver') {
            return c.memory.targetRoom === want.targetRoom && lib.homeOf(c) === (want.home || homeRoom.name);
        }
        // Local roles
        return lib.homeOf(c) === homeRoom.name;
    });
}

function assignSourceId(roomName, role) {
    const room = Game.rooms[roomName];
    if (!room) return null;
    const sources = room.find(FIND_SOURCES);
    const taken = {};
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if ((c.memory.role === role || (role === 'remoteMiner' && c.memory.role === 'remoteMiner')) &&
            c.memory.sourceId) {
            taken[c.memory.sourceId] = true;
        }
    }
    const free = sources.find(s => !taken[s.id]);
    return free ? free.id : (sources[0] && sources[0].id);
}

function trySpawn(spawn, want, homeRoom) {
    if (spawn.spawning) return false;

    const energy = spawn.room.energyAvailable;
    const bodyFn = want.body;
    const body = typeof bodyFn === 'function' ? bodyFn(energy) : bodyFn;
    if (!body || !body.length) return false;

    const cost = lib.bodyCost(body);
    if (energy < cost) return false;

    // Prefer full static miners when the room can afford them
    if (want.role === 'miner' && spawn.room.energyCapacityAvailable >= 600 && energy < 600) {
        return false;
    }

    const memory = {
        role: want.role,
        home: want.home || homeRoom.name,
        targetRoom: want.targetRoom || homeRoom.name,
        working: false,
    };

    if (want.assignSources) {
        memory.sourceId = assignSourceId(want.targetRoom || homeRoom.name, want.role);
    }

    // Scout wanders — don't lock target
    if (want.role === 'scout') memory.targetRoom = null;

    const name = `${want.role}-${memory.home}-${Game.time}`;
    const res = spawn.spawnCreep(body, name, { memory });
    if (res === OK) {
        lib.log(`Spawn ${name} @ ${spawn.room.name} (${cost}e)`);
        spawn.room.visual.text(`🥚${want.role}`, spawn.pos.x + 1, spawn.pos.y, { align: 'left', opacity: 0.7 });
        return true;
    }
    return false;
}

function runRoom(room) {
    const spawn = pickSpawn(room.name);
    if (!spawn) return;

    const localWants = wantedForRoom(room);
    localWants.sort((a, b) => b.priority - a.priority);

    for (const want of localWants) {
        const have = countForWant(want, room);
        if (have >= want.count) continue;
        if (trySpawn(spawn, want, room)) return;
    }
}

function runEmpire() {
    const empire = empireWants();
    empire.sort((a, b) => b.priority - a.priority);

    for (const want of empire) {
        let homeRoom = null;
        if (want.spawnIn) homeRoom = Game.rooms[want.spawnIn];
        else if (want.fromNearestTo) {
            homeRoom = nearestOwnedRoom(want.fromNearestTo, config.expansion.minHomeRcl);
        }
        if (!homeRoom) continue;

        const have = countForWant(want, homeRoom);
        if (have >= want.count) continue;

        const spawn = pickSpawn(homeRoom.name);
        if (!spawn) continue;

        // Require healthy home for expansion creeps — keep the bar low for aggression
        if (want.role === 'claimer' || want.role === 'pioneer') {
            if (homeRoom.controller.level < config.expansion.minHomeRcl &&
                homeRoom.energyCapacityAvailable < 650) continue;
            // Claimer only needs 650; don't wait for a full refill
            if (want.role === 'claimer' && homeRoom.energyAvailable < 650) continue;
            if (want.role === 'pioneer' &&
                homeRoom.energyAvailable < Math.min(400, homeRoom.energyCapacityAvailable * 0.3)) continue;
        }

        if (trySpawn(spawn, Object.assign({}, want, { home: want.home || homeRoom.name }), homeRoom)) {
            return;
        }
    }
}

function run() {
    // Local spawning every tick (cheap)
    for (const room of lib.ownedRooms()) {
        runRoom(room);
    }
    // Empire requests
    runEmpire();
}

module.exports = {
    run,
    wantedForRoom,
    empireWants,
};
