/**
 * Shared helpers: per-tick caches, movement, room math, logging.
 * Screeps globals (Game, Memory, constants) are ambient.
 */
const config = require('config');

// Heap storage survives between ticks (until a global reset) and is not serialised.
const heap = global.__heap = global.__heap || {
    cache: { time: -1, data: {} },
    lastPos: {},
    prevPos: {},
    stuck: {},
    noPath: {},
    idleAt: {},
    parked: {},
    terrain: {},
    rooms: {},
};
// Route planning (see travel): room routes, per-creep exit tiles, room edges that
// turned out to be walled off, walkability matrices.
heap.routes = heap.routes || {};
heap.way = heap.way || {};
heap.badEdges = heap.badEdges || {};
heap.routeMatrix = heap.routeMatrix || {};

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

/**
 * Memory.empire.claim.target may be one room or a list of rooms. A list is
 * unpacked into target (the room being claimed now) and next (the rest, in
 * order); an empty list drops the claim.
 */
function unpackClaim() {
    const e = Memory.empire;
    const c = e && e.claim;
    if (!c || !Array.isArray(c.target)) return;
    c.next = c.target.slice(1).concat(c.next || []);
    c.target = c.target[0];
    if (!c.target) e.claim = null;
}

/**
 * The current claim target is done (claimed or given up): move on to the next
 * room of the list, skipping owned and avoided ones, and restart the timeout.
 * Clears the claim when no room is left. Returns the new target or null.
 */
function advanceClaim() {
    unpackClaim();
    const e = Memory.empire;
    const c = e && e.claim;
    if (!c) return null;
    while (c.next && c.next.length) {
        const name = c.next.shift();
        if (isOwned(name) || isAvoided(name)) continue;
        c.target = name;
        c.t = Game.time;
        log('Claim moves on to ' + name + (c.next.length ? ' (' + c.next.length + ' more after it)' : ''));
        return name;
    }
    e.claim = null;
    return null;
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

const ROUTE_TTL = 100;      // ticks a room route is shared by every creep making the trip
const WAY_TTL = 150;        // ticks a creep keeps the exit tile it was given
const BAD_EDGE_TTL = 300;   // ticks a walled-off room edge stays out of the routes
const LOOKAHEAD = 3;        // rooms of the route planned through to pick the exit tile
const PLANS_PER_TICK = 20;  // exit-tile plans (one path search each) allowed per tick

/**
 * Rooms to cross from one room to another (Game.map.findRoute), or null.
 * Highways and our own rooms are preferred, keeper rooms cost extra; avoided
 * rooms (other than the two ends) and edges found walled off are left out.
 */
function roomRoute(from, to, avoid) {
    const key = from + '>' + to + '|' + (avoid || '');
    const hit = heap.routes[key];
    if (hit && Game.time - hit.t < ROUTE_TTL) return hit.route;
    const res = Game.map.findRoute(from, to, {
        routeCallback: (name, fromName) => {
            if (name !== to && name !== from && (name === avoid || isAvoided(name))) return Infinity;
            const bad = heap.badEdges[fromName + '>' + name];
            if (bad != null && Game.time - bad < BAD_EDGE_TTL) return Infinity;
            if (isHighway(name) || isOwned(name)) return 1;
            return isKeeperRoom(name) ? 5 : 2.5;
        },
    });
    const route = Array.isArray(res) && res.length ? res : null;
    // The caches only grow: start over now and then.
    if ((heap.routesN = (heap.routesN || 0) + 1) > 2000) {
        heap.routes = {};
        heap.badEdges = {};
        heap.routesN = 0;
    }
    heap.routes[key] = { t: Game.time, route };
    return route;
}

/**
 * Walkability for route planning: roads cheap, structures that block walking
 * impassable; with `self`, every other creep is an obstacle too. Rooms without
 * vision are planned on terrain alone (undefined).
 */
function routeMatrix(roomName, self) {
    const room = Game.rooms[roomName];
    if (!room) return undefined;
    let hit = heap.routeMatrix[roomName];
    if (!hit || Game.time - hit.t >= 50) {
        const m = new PathFinder.CostMatrix();
        const structs = room.find(FIND_STRUCTURES);
        for (let i = 0; i < structs.length; i++) {
            const st = structs[i];
            if (isBlockingStructure(st)) m.set(st.pos.x, st.pos.y, 255);
            else if (st.structureType === STRUCTURE_ROAD && m.get(st.pos.x, st.pos.y) !== 255) m.set(st.pos.x, st.pos.y, 1);
        }
        hit = heap.routeMatrix[roomName] = { t: Game.time, m };
    }
    if (!self) return hit.m;
    const m = hit.m.clone();
    const creeps = room.find(FIND_CREEPS);
    for (let i = 0; i < creeps.length; i++) {
        if (creeps[i].id !== self.id) m.set(creeps[i].pos.x, creeps[i].pos.y, 255);
    }
    return m;
}

/**
 * Plan through the first `look` rooms of a route. Returns { exit, ops }: exit is
 * the tile where that path leaves the origin room (the origin itself when it
 * already stands on it), or null when no way out toward the route was found;
 * ops is how much ground the search covered.
 */
function planExit(origin, pos, range, route, look, self) {
    const from = origin.roomName;
    const n = Math.min(route.length, look);
    const allowed = {};
    allowed[from] = true;
    for (let i = 0; i < n; i++) allowed[route[i].room] = true;
    const last = route[n - 1].room;
    // Mid-route the goal is simply "well inside that room".
    const goal = last === pos.roomName ? { pos, range: Math.max(1, range) } : { pos: roomCenter(last), range: 22 };
    const res = PathFinder.search(origin, goal, {
        roomCallback: name => (allowed[name] ? routeMatrix(name, name === from ? self : null) : false),
        plainCost: 2,
        swampCost: 10,
        maxRooms: n + 1,
        maxOps: 4000 * (n + 1),
    });
    let prev = origin;
    for (let i = 0; i < res.path.length; i++) {
        if (res.path[i].roomName !== from) return { exit: prev, ops: res.ops };
        prev = res.path[i];
    }
    return { exit: null, ops: res.ops };
}

/**
 * The exit tile of the creep's room to walk to on the way to `pos` in another
 * room; null when there is no route (the caller falls back to plain moveTo),
 * undefined when the plan has to wait for the next tick.
 *
 * The game's own path search covers 16 rooms at most and, when it runs out,
 * walks the creep to the tile nearest the target: on a long trip that is the
 * corner of a dead-end room, where the creep then sits. So trips are planned
 * on the room map first and walked one exit at a time. An edge the route
 * crosses but no path does is remembered and routed around.
 */
function exitWaypoint(creep, pos, range, avoid, replan) {
    const from = creep.pos.roomName;
    const dest = pos.roomName + '|' + (avoid || '');
    let way = heap.way[creep.name];
    if (!way || way.dest !== dest) way = heap.way[creep.name] = { dest, at: {} };
    const hit = way.at[from];
    const fresh = hit && Game.time - hit.t < (hit.x == null ? 20 : WAY_TTL);
    const known = fresh ? (hit.x == null ? null : new RoomPosition(hit.x, hit.y, from)) : undefined;
    if (fresh && !replan) return known;
    // A plan costs a path search: only so many per tick (a deploy or a whole squad
    // changing rooms at once would spike the CPU); the rest wait a tick.
    const budget = cache('travelPlans', () => ({ n: 0 }));
    if (budget.n >= PLANS_PER_TICK || Game.cpu.getUsed() > Game.cpu.tickLimit * 0.7) return known;
    budget.n++;
    let exit = null;
    for (let attempt = 0; attempt < 3 && !exit; attempt++) {
        const route = roomRoute(from, pos.roomName, avoid);
        if (!route) break;
        // Jammed: first try around the creeps in the way, then the plain plan again.
        if (replan) exit = planExit(creep.pos, pos, range, route, LOOKAHEAD, creep).exit;
        if (exit) break;
        exit = planExit(creep.pos, pos, range, route, LOOKAHEAD, null).exit;
        if (exit) break;
        // Which edge has no way through? The first one the plan cannot get past.
        let bad = 0;
        for (let k = 1; k < Math.min(route.length, LOOKAHEAD); k++) {
            if (planExit(creep.pos, pos, range, route, k, null).exit) bad = k;
            else break;
        }
        // No way out of one of our own rooms: the creep is boxed in by our buildings
        // where it stands; the exits themselves are fine for everybody else.
        if (!bad && isOwned(from)) break;
        const a = bad ? route[bad - 1].room : from;
        heap.badEdges[a + '>' + route[bad].room] = Game.time;
        delete heap.routes[from + '>' + pos.roomName + '|' + (avoid || '')];
        log('Route: no way from ' + a + ' into ' + route[bad].room + ' (' + creep.name + ' at ' + creep.pos.x + ',' + creep.pos.y + ' ' + from + ' bound for ' + pos.roomName + '); going around');
    }
    // Keep this room and the one before it (a creep may be thrown back across the edge).
    let keep = null;
    for (const name in way.at) if (name !== from && (!keep || way.at[name].t > way.at[keep].t)) keep = name;
    const at = {};
    if (keep) at[keep] = way.at[keep];
    at[from] = exit ? { x: exit.x, y: exit.y, t: Game.time } : { t: Game.time };
    way.at = at;
    return exit;
}

/**
 * Move toward target (object or RoomPosition) until within `range`.
 * Reuses paths, routes around parked creeps and recovers from traffic jams.
 * A target in another room is reached along a room route, one exit tile at
 * a time (see exitWaypoint).
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
    const prevPos = heap.prevPos || (heap.prevPos = {});
    // A creep that cannot step off an exit tile is thrown back and forth between the two
    // rooms every tick: its position changes, yet it is jammed all the same.
    const bouncing = prevPos[key] === here && heap.lastPos[key] !== here && onEdge(creep.pos);
    if (heap.lastPos[key] === here || bouncing) heap.stuck[key] = (heap.stuck[key] || 0) + 1;
    else heap.stuck[key] = 0;
    prevPos[key] = heap.lastPos[key];
    heap.lastPos[key] = here;

    const stuckFor = heap.stuck[key];
    const stuck = stuckFor >= 2;
    const sameRoom = pos.roomName === creep.pos.roomName;
    // Another room: head for the exit tile the room route leads through. Jammed for
    // a while: plan again around the creeps in the way (another exit tile may be free).
    const exit = sameRoom ? null : exitWaypoint(creep, pos, range, opts.avoidRoom, !bouncing && stuckFor >= 6 && stuckFor % 6 === 0);
    if (exit === undefined) {
        heap.stuck[key] = 0;
        return ERR_TIRED;
    }
    const local = sameRoom || !!exit;
    // Standing on the exit tile: the game carries the creep across by itself.
    if (exit && creep.pos.isEqualTo(exit)) return OK;
    // While jammed alternate between creep-aware and creep-blind pathing. A bouncing creep
    // is only on each side every other tick, so there it is creep-aware every time.
    const ignoreCreeps = !stuck || (!bouncing && stuckFor % 2 === 1);

    heap.pathingFrom = creep.pos.roomName;
    heap.pathingTo = pos.roomName;
    heap.pathingAvoid = opts.avoidRoom || null;
    const res = creep.moveTo(exit || pos, {
        range: exit ? 0 : range,
        reusePath: stuck ? 4 : (opts.reusePath || (sameRoom ? 15 : 40)),
        ignoreCreeps,
        costCallback: parkedCallback,
        maxRooms: local ? 1 : 16,
        maxOps: local ? 2000 : 10000,
        plainCost: opts.plainCost,
        swampCost: opts.swampCost,
        visualizePathStyle: config.visuals ? (opts.pathStyle || (creep.memory.role === 'soldier' ? config.pathStyleWar : config.pathStyle)) : undefined,
    });
    // Blocked last tick already: idle neighbours (parked creeps, healers shadowing this one) step aside.
    if (stuckFor >= 1) shoveIdleNeighbours(creep);
    if (!bouncing && stuckFor >= 6 && stuckFor % 3 === 0) {
        // Still jammed: step somewhere random to break the deadlock.
        creep.move(((stuckFor * 7 + Game.time) % 8) + 1);
    }
    if (res === ERR_NO_PATH && exit) {
        // The exit tile cannot be reached right now: plan again in a few ticks.
        const at = heap.way[key] && heap.way[key].at[creep.pos.roomName];
        if (at) at.t = Math.min(at.t, Game.time - WAY_TTL + 5);
    }
    if (res === ERR_NO_PATH && ignoreCreeps) {
        heap.noPath[key] = (heap.noPath[key] || 0) + 1;
        // Walled in by our own construction at home. Abroad it is a routing dead end:
        // the creep keeps trying instead of being thrown away.
        if (heap.noPath[key] > 60 && isOwned(creep.pos.roomName)) {
            warn(creep.name + ' is walled in at ' + creep.pos + '; recycling it');
            creep.suicide();
        }
    } else if (res === OK) {
        heap.noPath[key] = 0;
    }
    return res;
}

function onEdge(pos) {
    return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;
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
    if (heap.prevPos) delete heap.prevPos[name];
    delete heap.stuck[name];
    delete heap.noPath[name];
    delete heap.idleAt[name];
    delete heap.way[name];
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
    unpackClaim,
    advanceClaim,
    roomCoords,
    isHighway,
    isKeeperRoom,
    travel,
    park,
    markIdle,
    onEdge,
    isIdle,
    stepAwayFrom,
    forgetCreep,
    roomCenter,
    clamp,
};
