/**
 * Shared helpers: per-tick caches, movement, room math, logging.
 * Screeps globals (Game, Memory, constants) are ambient.
 */
const config = require('config');

// Heap storage survives between ticks (until a global reset) and is not serialised.
const heap = global.__heap = global.__heap || {
    cache: { time: -1, data: {} },
    lastPos: {},
    stuck: {},
    noPath: {},
    idleAt: {},
    parked: {},
    terrain: {},
    rooms: {},
};

function cache(key, fn) {
    const c = heap.cache;
    if (c.time !== Game.time) {
        c.time = Game.time;
        c.data = {};
    }
    if (!(key in c.data)) c.data[key] = fn();
    return c.data[key];
}

/** room.find wrapped in the per-tick cache; `tag` must identify the filter. */
function find(room, type, tag, filter) {
    return cache(room.name + '|' + type + '|' + (tag || ''), () =>
        filter ? room.find(type, { filter }) : room.find(type));
}

/** All structures in a room grouped by type (per-tick cache). */
function structuresByType(room) {
    return cache(room.name + '|byType', () => {
        const out = {};
        const all = room.find(FIND_STRUCTURES);
        for (let i = 0; i < all.length; i++) {
            const s = all[i];
            (out[s.structureType] || (out[s.structureType] = [])).push(s);
        }
        return out;
    });
}

function roomHeap(name) {
    return heap.rooms[name] || (heap.rooms[name] = {});
}

function terrain(roomName) {
    return heap.terrain[roomName] || (heap.terrain[roomName] = Game.map.getRoomTerrain(roomName));
}

function isWall(roomName, x, y) {
    return terrain(roomName).get(x, y) === TERRAIN_MASK_WALL;
}

const BLOCKING = {};
for (let i = 0; i < OBSTACLE_OBJECT_TYPES.length; i++) BLOCKING[OBSTACLE_OBJECT_TYPES[i]] = true;

function isBlockingStructure(s) {
    if (s.structureType === STRUCTURE_RAMPART) return !(s.my || s.isPublic);
    return !!BLOCKING[s.structureType];
}

function isBlockingType(type) {
    return !!BLOCKING[type];
}

function log(msg) {
    console.log('[' + Game.time + '] ' + msg);
}

function warn(msg) {
    console.log('<span style="color:#ffaa00">[' + Game.time + '] ' + msg + '</span>');
}

function error(msg) {
    console.log('<span style="color:#ff5555">[' + Game.time + '] ' + msg + '</span>');
}

function say(creep, text) {
    if (config.say) creep.say(text);
}

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function bodyCost(body) {
    let c = 0;
    for (let i = 0; i < body.length; i++) c += BODYPART_COST[body[i]];
    return c;
}

function countParts(creep, type) {
    let n = 0;
    const body = creep.body;
    for (let i = 0; i < body.length; i++) if (body[i].type === type) n++;
    return n;
}

function hasParts(creep, types) {
    const body = creep.body;
    for (let i = 0; i < body.length; i++) {
        if (types.indexOf(body[i].type) !== -1 && body[i].hits > 0) return true;
    }
    return false;
}

/** Is this room owned by me (controller mine)? Works without vision via Memory. */
function isOwned(roomName) {
    const room = Game.rooms[roomName];
    return !!(room && room.controller && room.controller.my);
}

function ownedRooms() {
    return cache('ownedRooms', () => {
        const out = [];
        for (const name in Game.rooms) {
            const room = Game.rooms[name];
            if (room.controller && room.controller.my) out.push(room);
        }
        out.sort((a, b) => (a.name < b.name ? -1 : 1));
        return out;
    });
}

function roomDistance(a, b) {
    return Game.map.getRoomLinearDistance(a, b);
}

function nearestOwnedRoom(roomName, pred) {
    let best = null;
    let bestD = Infinity;
    const rooms = ownedRooms();
    for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        if (pred && !pred(r)) continue;
        const d = roomDistance(r.name, roomName);
        if (d < bestD) {
            bestD = d;
            best = r;
        }
    }
    return best;
}

/** Orthogonal neighbours that actually have exits. */
function exitRooms(roomName) {
    const exits = Game.map.describeExits(roomName);
    const out = [];
    for (const dir in exits) out.push(exits[dir]);
    return out;
}

/** TEMPORARY: rooms from config.avoidRooms (or the Memory.avoidRooms override) are off limits. */
function avoidedRooms() {
    const list = Array.isArray(Memory.avoidRooms) ? Memory.avoidRooms : config.avoidRooms;
    return list || [];
}

function isAvoided(roomName) {
    return avoidedRooms().indexOf(roomName) !== -1;
}

/** Cost matrix with every tile impassable: makes PathFinder route around a room. */
function blockedMatrix() {
    if (heap.blockedMatrix) return heap.blockedMatrix;
    const m = new PathFinder.CostMatrix();
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) m.set(x, y, 255);
    return (heap.blockedMatrix = m);
}

function roomCoords(name) {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
    if (!m) return null;
    return { x: Number(m[2]), y: Number(m[4]) };
}

function isHighway(name) {
    const c = roomCoords(name);
    return !!c && (c.x % 10 === 0 || c.y % 10 === 0);
}

function isKeeperRoom(name) {
    const c = roomCoords(name);
    if (!c) return false;
    const mx = c.x % 10;
    const my = c.y % 10;
    return mx >= 4 && mx <= 6 && my >= 4 && my <= 6;
}

/** Creeps that stay put for a long time (miners on containers) register here every tick. */
function park(creep) {
    const r = heap.parked[creep.room.name] || (heap.parked[creep.room.name] = {});
    r[creep.pos.x + ':' + creep.pos.y] = Game.time;
}

/**
 * Cost matrix callback: avoided rooms are impassable (unless the creep is
 * already inside one and has to walk out), recently parked creeps too.
 */
function parkedCallback(roomName, matrix) {
    if (isAvoided(roomName) && roomName !== heap.pathingFrom && roomName !== heap.pathingTo) return blockedMatrix();
    if (heap.pathingAvoid === roomName && roomName !== heap.pathingFrom) return blockedMatrix();
    const r = heap.parked[roomName];
    if (!r) return;
    for (const key in r) {
        if (Game.time - r[key] > 1) {
            delete r[key];
            continue;
        }
        const i = key.indexOf(':');
        matrix.set(+key.slice(0, i), +key.slice(i + 1), 255);
    }
}

/**
 * Move toward target (object or RoomPosition) until within `range`.
 * Reuses paths, routes around parked creeps and recovers from traffic jams.
 * opts.avoidRoom: a room name the path must not cross (e.g. the war target
 * while the squad is still gathering).
 */
function travel(creep, target, opts) {
    opts = opts || {};
    const pos = target.pos || target;
    const range = opts.range != null ? opts.range : 1;
    if (creep.pos.roomName === pos.roomName && creep.pos.inRangeTo(pos, range)) return OK;
    if (creep.fatigue > 0) return ERR_TIRED;

    const key = creep.name;
    const here = creep.pos.x + ':' + creep.pos.y + ':' + creep.pos.roomName;
    if (heap.lastPos[key] === here) heap.stuck[key] = (heap.stuck[key] || 0) + 1;
    else heap.stuck[key] = 0;
    heap.lastPos[key] = here;

    const stuckFor = heap.stuck[key];
    const stuck = stuckFor >= 2;
    const sameRoom = pos.roomName === creep.pos.roomName;
    // While jammed alternate between creep-aware and creep-blind pathing.
    const ignoreCreeps = !stuck || stuckFor % 2 === 1;

    heap.pathingFrom = creep.pos.roomName;
    heap.pathingTo = pos.roomName;
    heap.pathingAvoid = opts.avoidRoom || null;
    const res = creep.moveTo(pos, {
        range,
        reusePath: stuck ? 4 : (opts.reusePath || (sameRoom ? 15 : 40)),
        ignoreCreeps,
        costCallback: parkedCallback,
        maxRooms: sameRoom ? 1 : 16,
        maxOps: sameRoom ? 2000 : 10000,
        plainCost: opts.plainCost,
        swampCost: opts.swampCost,
        visualizePathStyle: config.visuals ? (opts.pathStyle || (creep.memory.role === 'soldier' ? config.pathStyleWar : config.pathStyle)) : undefined,
    });
    if (stuck) shoveIdleNeighbours(creep);
    if (stuckFor >= 6 && stuckFor % 3 === 0) {
        // Still jammed: step somewhere random to break the deadlock.
        creep.move(((stuckFor * 7 + Game.time) % 8) + 1);
    }
    if (res === ERR_NO_PATH && ignoreCreeps) {
        heap.noPath[key] = (heap.noPath[key] || 0) + 1;
        if (heap.noPath[key] > 60) {
            warn(creep.name + ' is walled in at ' + creep.pos + '; recycling it');
            creep.suicide();
        }
    } else if (res === OK) {
        heap.noPath[key] = 0;
    }
    return res;
}

/** Mark a creep as idle this tick so others may push it out of the way. */
function markIdle(creep) {
    heap.idleAt[creep.name] = Game.time;
}

function isIdle(creep) {
    const t = heap.idleAt[creep.name];
    return t != null && Game.time - t <= 1;
}

/** Push idle creeps standing next to a jammed creep one step away. */
function shoveIdleNeighbours(creep) {
    const near = creep.pos.findInRange(FIND_MY_CREEPS, 1);
    for (let i = 0; i < near.length; i++) {
        const other = near[i];
        if (other === creep || !isIdle(other) || other.fatigue > 0) continue;
        const dir = stepAwayFrom(other, creep.pos);
        if (dir) other.move(dir);
    }
}

/** A direction that moves `creep` to a free tile not adjacent to `from` (or any free tile). */
function stepAwayFrom(creep, from) {
    const room = creep.room;
    let best = 0;
    let bestScore = -Infinity;
    const offsets = [[0, -1, TOP], [1, -1, TOP_RIGHT], [1, 0, RIGHT], [1, 1, BOTTOM_RIGHT],
        [0, 1, BOTTOM], [-1, 1, BOTTOM_LEFT], [-1, 0, LEFT], [-1, -1, TOP_LEFT]];
    for (let i = 0; i < offsets.length; i++) {
        const x = creep.pos.x + offsets[i][0];
        const y = creep.pos.y + offsets[i][1];
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (isWall(room.name, x, y)) continue;
        if (room.lookForAt(LOOK_CREEPS, x, y).length) continue;
        const structs = room.lookForAt(LOOK_STRUCTURES, x, y);
        let blocked = false;
        for (let j = 0; j < structs.length; j++) if (isBlockingStructure(structs[j])) blocked = true;
        if (blocked) continue;
        const d = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
        const score = d * 10 + ((x + y + Game.time) % 3);
        if (score > bestScore) {
            bestScore = score;
            best = offsets[i][2];
        }
    }
    return best;
}

function forgetCreep(name) {
    delete heap.lastPos[name];
    delete heap.stuck[name];
    delete heap.noPath[name];
    delete heap.idleAt[name];
}

/** Centre-ish position used when travelling to a room without a specific target. */
function roomCenter(roomName) {
    return new RoomPosition(25, 25, roomName);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

module.exports = {
    heap,
    cache,
    find,
    structuresByType,
    roomHeap,
    terrain,
    isWall,
    isBlockingStructure,
    isBlockingType,
    log,
    warn,
    error,
    say,
    hashString,
    bodyCost,
    countParts,
    hasParts,
    isOwned,
    ownedRooms,
    roomDistance,
    nearestOwnedRoom,
    exitRooms,
    avoidedRooms,
    isAvoided,
    roomCoords,
    isHighway,
    isKeeperRoom,
    travel,
    park,
    markIdle,
    isIdle,
    stepAwayFrom,
    forgetCreep,
    roomCenter,
    clamp,
};
