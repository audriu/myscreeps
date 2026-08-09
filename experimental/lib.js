/**
 * Shared helpers. Screeps globals (Game, Memory, _, FIND_*, etc.) are ambient.
 */

const config = require('config');

const BODY_COST = {
    move: 50,
    work: 100,
    attack: 80,
    carry: 50,
    heal: 250,
    ranged_attack: 150,
    tough: 10,
    claim: 600,
};

function bodyCost(parts) {
    let cost = 0;
    for (let i = 0; i < parts.length; i++) {
        cost += BODYPART_COST[parts[i]] || BODY_COST[parts[i]] || 0;
    }
    return cost;
}

/**
 * Repeat a pattern until budget / part limit reached.
 * pattern: array of body parts (one "unit")
 */
function scaleBody(pattern, energy, maxParts) {
    maxParts = maxParts || 50;
    const unitCost = bodyCost(pattern);
    if (unitCost <= 0 || energy < unitCost) return null;

    const maxUnitsByEnergy = Math.floor(energy / unitCost);
    const maxUnitsByParts = Math.floor(maxParts / pattern.length);
    const units = Math.max(1, Math.min(maxUnitsByEnergy, maxUnitsByParts));

    const body = [];
    for (let u = 0; u < units; u++) {
        for (let i = 0; i < pattern.length; i++) body.push(pattern[i]);
    }
    return body;
}

/** Sort parts so MOVE/TOUGH are arranged reasonably (WORK/CARRY first, MOVE last). */
function orderBody(parts) {
    const priority = {
        tough: 0,
        work: 1,
        attack: 2,
        ranged_attack: 3,
        carry: 4,
        claim: 5,
        heal: 6,
        move: 7,
    };
    return parts.slice().sort((a, b) => (priority[a] || 5) - (priority[b] || 5));
}

function ownedRooms() {
    const rooms = [];
    for (const name in Game.rooms) {
        const room = Game.rooms[name];
        if (room.controller && room.controller.my) rooms.push(room);
    }
    return rooms;
}

function roomSpawns(room) {
    return room.find(FIND_MY_SPAWNS);
}

function isHostileRoom(room) {
    if (!room) return false;
    if (room.find(FIND_HOSTILE_CREEPS).length) return true;
    if (room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType !== STRUCTURE_CONTROLLER,
    }).length) return true;
    return false;
}

function hasKeeperLairs(room) {
    return room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_KEEPER_LAIR,
    }).length > 0;
}

/** Parse "E12N39" → {x:12,y:39,wx:'E',wy:'N'} */
function parseRoomName(name) {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
    if (!m) return null;
    return {
        wx: m[1],
        x: Number(m[2]),
        wy: m[3],
        y: Number(m[4]),
    };
}

function roomNameFromParts(p) {
    return `${p.wx}${p.x}${p.wy}${p.y}`;
}

/** Orthogonal neighbors of a room. */
function adjacentRooms(roomName) {
    const p = parseRoomName(roomName);
    if (!p) return [];

    const deltas = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
    ];

    const out = [];
    for (const d of deltas) {
        const np = {
            wx: p.wx,
            x: p.x,
            wy: p.wy,
            y: p.y,
        };
        // Convert to world coords, apply delta, convert back
        let wx = p.wx === 'W' ? -p.x - 1 : p.x;
        let wy = p.wy === 'S' ? -p.y - 1 : p.y;
        wx += d.dx;
        wy += d.dy;
        np.wx = wx < 0 ? 'W' : 'E';
        np.x = wx < 0 ? -wx - 1 : wx;
        np.wy = wy < 0 ? 'S' : 'N';
        np.y = wy < 0 ? -wy - 1 : wy;
        out.push(roomNameFromParts(np));
    }
    return out;
}

/** Manhattan room-distance between two room names. */
function roomDistance(a, b) {
    const pa = parseRoomName(a);
    const pb = parseRoomName(b);
    if (!pa || !pb) return Infinity;

    const ax = pa.wx === 'W' ? -pa.x - 1 : pa.x;
    const ay = pa.wy === 'S' ? -pa.y - 1 : pa.y;
    const bx = pb.wx === 'W' ? -pb.x - 1 : pb.x;
    const by = pb.wy === 'S' ? -pb.y - 1 : pb.y;
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

function moveTo(creep, target, opts) {
    opts = opts || {};
    return creep.moveTo(target, {
        reusePath: opts.reusePath != null ? opts.reusePath : 20,
        ignoreCreeps: opts.ignoreCreeps || false,
        maxRooms: opts.maxRooms,
        visualizePathStyle: opts.visualizePathStyle || { stroke: opts.stroke || '#88aaff', opacity: 0.3, lineStyle: 'dotted' },
    });
}

/** Travel to another room via exit chain / route. */
function goToRoom(creep, roomName) {
    if (creep.room.name === roomName) return OK;
    creep.say('→' + roomName.slice(-4));

    const route = Game.map.findRoute(creep.room.name, roomName, {
        routeCallback(name) {
            const parsed = parseRoomName(name);
            // Soft-avoid highways (coord % 10 === 0) — still allowed
            if (parsed && (parsed.x % 10 === 0 || parsed.y % 10 === 0)) return 1.5;
            const mem = Memory.rooms && Memory.rooms[name];
            if (mem && mem.avoid) return Infinity;
            if (mem && mem.owner && !mem.my) return 5;
            return 1;
        },
    });

    if (route === ERR_NO_PATH || !route.length) {
        // Fallback: toward room linear
        const exitDir = creep.room.findExitTo(roomName);
        if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return ERR_NO_PATH;
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) moveTo(creep, exit, { stroke: '#aaaaaa' });
        return ERR_NO_PATH;
    }

    const exitDir = creep.room.findExitTo(route[0].room);
    const exit = creep.pos.findClosestByRange(exitDir);
    if (exit) moveTo(creep, exit, { stroke: '#00ff88' });
    return OK;
}

function getEnergy(creep) {
    // Prefer dropped, then tombstones, then containers/storage/links, then harvest
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return false;

    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) moveTo(creep, dropped, { stroke: '#ffaa00' });
        return true;
    }

    const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: t => t.store[RESOURCE_ENERGY] > 0,
    });
    if (tomb) {
        if (creep.withdraw(tomb, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveTo(creep, tomb, { stroke: '#ffaa00' });
        return true;
    }

    const ruin = creep.pos.findClosestByPath(FIND_RUINS, {
        filter: r => r.store && r.store[RESOURCE_ENERGY] > 0,
    });
    if (ruin) {
        if (creep.withdraw(ruin, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveTo(creep, ruin, { stroke: '#ffaa00' });
        return true;
    }

    const store = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s =>
            (s.structureType === STRUCTURE_CONTAINER ||
                s.structureType === STRUCTURE_STORAGE ||
                s.structureType === STRUCTURE_LINK) &&
            s.store[RESOURCE_ENERGY] > 50,
    });
    if (store) {
        if (creep.withdraw(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveTo(creep, store, { stroke: '#ffaa00' });
        return true;
    }

    // Active sources as last resort (workers / pioneers)
    if (creep.getActiveBodyparts(WORK) > 0) {
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) moveTo(creep, source, { stroke: '#ffff00' });
            return true;
        }
    }

    return false;
}

function deliverEnergy(creep, opts) {
    opts = opts || {};
    const room = creep.room;

    const fillSpawnExt = !opts.skipSpawn;
    const fillTower = !opts.skipTower;
    const fillStorage = opts.allowStorage !== false;

    let targets = [];

    if (fillSpawnExt) {
        targets = targets.concat(room.find(FIND_MY_STRUCTURES, {
            filter: s =>
                (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        }));
    }

    if (fillTower) {
        targets = targets.concat(room.find(FIND_MY_STRUCTURES, {
            filter: s =>
                s.structureType === STRUCTURE_TOWER &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 200,
        }));
    }

    if (targets.length) {
        const t = creep.pos.findClosestByPath(targets) || targets[0];
        if (creep.transfer(t, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveTo(creep, t, { stroke: '#ffffff' });
        return true;
    }

    if (fillStorage) {
        const containers = room.find(FIND_STRUCTURES, {
            filter: s =>
                (s.structureType === STRUCTURE_STORAGE || s.structureType === STRUCTURE_CONTAINER) &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        if (containers.length) {
            // Prefer storage
            containers.sort((a, b) => {
                const score = s => (s.structureType === STRUCTURE_STORAGE ? 0 : 1);
                return score(a) - score(b) || creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
            });
            const t = containers[0];
            if (creep.transfer(t, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveTo(creep, t, { stroke: '#ffffff' });
            return true;
        }
    }

    return false;
}

function countCreeps(filterFn) {
    let n = 0;
    for (const name in Game.creeps) {
        if (filterFn(Game.creeps[name])) n++;
    }
    return n;
}

function creepsBy(filterFn) {
    const out = [];
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (filterFn(c)) out.push(c);
    }
    return out;
}

function roleOf(creep) {
    const role = creep.memory.role;
    if (!role) return 'worker';
    // Only remap true legacy aliases — never experimental roles like builder/upgrader
    if (config.legacyWorkerRoles.indexOf(role) !== -1) return 'worker';
    return role;
}

function homeOf(creep) {
    return creep.memory.home || creep.memory.targetRoom || (creep.room.controller && creep.room.controller.my ? creep.room.name : null);
}

function ensureCreepHome(creep) {
    if (!creep.memory.home) {
        if (creep.memory.targetRoom && Game.rooms[creep.memory.targetRoom] &&
            Game.rooms[creep.memory.targetRoom].controller &&
            Game.rooms[creep.memory.targetRoom].controller.my) {
            creep.memory.home = creep.memory.targetRoom;
        } else if (creep.room.controller && creep.room.controller.my) {
            creep.memory.home = creep.room.name;
        }
    }
    // Migrate legacy aliases only (ant/harvester/repairer). Never rewrite
    // first-class experimental roles — that zeroes spawn counts and floods.
    if (creep.memory.role && config.legacyWorkerRoles.indexOf(creep.memory.role) !== -1) {
        creep.memory.role = 'worker';
    }
}

function bucketOk(level) {
    const bucket = Game.cpu.bucket;
    if (level === 'critical') return bucket >= config.cpu.criticalBucket;
    if (level === 'low') return bucket >= config.cpu.lowBucket;
    return true;
}

function log(msg) {
    console.log(`[exp ${Game.time}] ${msg}`);
}

/**
 * Upgrade owned controller; if the sign is wrong and we're in range, sign
 * instead this tick (same range as upgrade — no extra travel).
 * Returns true if the creep spent its intent on sign/upgrade/move.
 */
function upgradeMyController(creep) {
    const ctrl = creep.room.controller;
    if (!ctrl || !ctrl.my) return false;

    if (!creep.pos.inRangeTo(ctrl, 3)) {
        creep.say('⬆');
        moveTo(creep, ctrl, { stroke: '#3333ff' });
        return true;
    }

    const want = config.signature;
    if (!ctrl.sign || ctrl.sign.text !== want) {
        creep.say('🐸');
        creep.signController(ctrl, want);
        return true;
    }

    creep.say('⬆');
    creep.upgradeController(ctrl);
    return true;
}

module.exports = {
    bodyCost,
    scaleBody,
    orderBody,
    ownedRooms,
    roomSpawns,
    isHostileRoom,
    hasKeeperLairs,
    parseRoomName,
    adjacentRooms,
    roomDistance,
    moveTo,
    goToRoom,
    getEnergy,
    deliverEnergy,
    countCreeps,
    creepsBy,
    roleOf,
    homeOf,
    ensureCreepHome,
    bucketOk,
    log,
    upgradeMyController,
};
