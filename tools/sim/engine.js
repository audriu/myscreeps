/* Minimal Screeps world simulator: enough API surface and mechanics to run the
 * colony script against real room snapshots. Not an exact engine. */
const fs = require('fs');
const path = require('path');
const C = require('./constants');

const metaPath = path.join(__dirname, 'data', 'time.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : {};
const ME = meta.user || '5fc126391cb8a60b1b51942b';
const MY_NAME = meta.username || 'Dzioba';
let nextId = 1;
const newId = () => 'sim' + (nextId++);

const W = {
    time: 0,
    rooms: {},
    objects: {},
    creeps: {},
    spawns: {},
    sites: {},
    gcl: 20,
    cpuLimit: 200,
    bucket: 10000,
    tickStart: 0n,
    logs: [],
    notifications: [],
    pixels: 0,
    stats: { spawned: 0, died: 0, built: {}, destroyed: 0 },
};

function roomCoords(name) {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
    return { wx: m[1], x: +m[2], wy: m[3], y: +m[4] };
}
function worldXY(name) {
    const c = roomCoords(name);
    return { x: c.wx === 'W' ? -c.x - 1 : c.x, y: c.wy === 'S' ? -c.y - 1 : c.y };
}
function roomNameFromWorld(x, y) {
    return (x < 0 ? 'W' + (-x - 1) : 'E' + x) + (y < 0 ? 'S' + (-y - 1) : 'N' + y);
}

/* ---------------- Store ---------------- */
function makeStore(capFn, init) {
    const store = Object.create(storeProto);
    Object.defineProperty(store, '_cap', { value: capFn, enumerable: false });
    if (init) for (const k in init) if (init[k] > 0) store[k] = init[k];
    return store;
}
const storeProto = {
    getCapacity(res) { return this._cap(res); },
    getUsedCapacity(res) {
        if (res) return this[res] || 0;
        let n = 0;
        for (const k in this) if (typeof this[k] === 'number') n += this[k];
        return n;
    },
    getFreeCapacity(res) { return this.getCapacity(res) - this.getUsedCapacity(); },
};

/* ---------------- Terrain ---------------- */
class Terrain {
    constructor(str) { this.str = str; }
    get(x, y) {
        if (x < 0 || x > 49 || y < 0 || y > 49) return C.TERRAIN_MASK_WALL;
        const v = +this.str[y * 50 + x];
        if (v & 1) return C.TERRAIN_MASK_WALL;
        if (v & 2) return C.TERRAIN_MASK_SWAMP;
        return 0;
    }
}

/* ---------------- RoomPosition ---------------- */
function toPos(t) {
    if (t == null) return null;
    if (t instanceof RoomPosition) return t;
    if (t.pos) return t.pos;
    return null;
}
class RoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    getRangeTo(a, b) {
        let p;
        if (typeof a === 'number') p = { x: a, y: b, roomName: this.roomName };
        else p = toPos(a);
        if (!p || p.roomName !== this.roomName) return Infinity;
        return Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    }
    inRangeTo(a, b, c) {
        if (typeof a === 'number') return this.getRangeTo(a, b) <= c;
        return this.getRangeTo(a) <= b;
    }
    isNearTo(a, b) { return typeof a === 'number' ? this.getRangeTo(a, b) <= 1 : this.getRangeTo(a) <= 1; }
    isEqualTo(a, b) {
        if (typeof a === 'number') return this.x === a && this.y === b;
        const p = toPos(a);
        return !!p && p.x === this.x && p.y === this.y && p.roomName === this.roomName;
    }
    lookFor(look) {
        const room = W.rooms[this.roomName];
        if (!room) return [];
        return room.lookForAt(look, this.x, this.y);
    }
    findInRange(what, range, opts) {
        const list = Array.isArray(what) ? what : W.rooms[this.roomName].find(what, opts);
        return list.filter(o => this.getRangeTo(o) <= range && (!opts || !opts.filter || Array.isArray(what) ? true : true));
    }
    findClosestByRange(what, opts) {
        let list = Array.isArray(what) ? what : W.rooms[this.roomName].find(what, opts);
        if (Array.isArray(what) && opts && opts.filter) list = list.filter(opts.filter);
        let best = null; let bestD = Infinity;
        for (const o of list) { const d = this.getRangeTo(o); if (d < bestD) { bestD = d; best = o; } }
        return best;
    }
    findClosestByPath(what, opts) { return this.findClosestByRange(what, opts); }
    getDirectionTo(a, b) {
        const p = typeof a === 'number' ? { x: a, y: b } : toPos(a);
        const dx = Math.sign(p.x - this.x); const dy = Math.sign(p.y - this.y);
        const map = { '0,-1': 1, '1,-1': 2, '1,0': 3, '1,1': 4, '0,1': 5, '-1,1': 6, '-1,0': 7, '-1,-1': 8 };
        return map[dx + ',' + dy] || 0;
    }
    toString() { return '[room ' + this.roomName + ' pos ' + this.x + ',' + this.y + ']'; }
}

/* ---------------- Objects ---------------- */
class RoomObject {
    constructor(x, y, roomName) { this.pos = new RoomPosition(x, y, roomName); this.id = newId(); }
    get room() { return W.rooms[this.pos.roomName]; }
}
class Source extends RoomObject {
    constructor(x, y, r, energy) { super(x, y, r); this.energy = energy; this.energyCapacity = 3000; this.ticksToRegeneration = undefined; }
}
class Mineral extends RoomObject {
    constructor(x, y, r) { super(x, y, r); this.mineralType = 'H'; this.mineralAmount = 10000; }
}
class Resource extends RoomObject {
    constructor(x, y, r, amount) { super(x, y, r); this.resourceType = 'energy'; this.amount = amount; }
}
class Tombstone extends RoomObject {
    constructor(x, y, r, store, ttl) { super(x, y, r); this.store = makeStore(() => Infinity, store); this.ticksToDecay = ttl; this.creep = null; }
}
class Ruin extends RoomObject {
    constructor(x, y, r, store) { super(x, y, r); this.store = makeStore(() => Infinity, store); this.ticksToDecay = 500; }
}
class ConstructionSite extends RoomObject {
    constructor(x, y, r, type) {
        super(x, y, r); this.structureType = type; this.progress = 0; this.progressTotal = C.CONSTRUCTION_COST[type] || 1000;
        this.my = true; this.owner = { username: MY_NAME };
    }
    remove() { removeSite(this); return C.OK; }
}

const HITS = { spawn: 5000, extension: 1000, road: 5000, constructedWall: 300000000, rampart: 300000000, link: 1000, storage: 10000, tower: 3000, terminal: 3000, container: 250000, extractor: 500, lab: 500, observer: 500, nuker: 1000, factory: 1000, powerSpawn: 5000 };
const CAPACITY = {
    spawn: () => 300, extension: s => C.EXTENSION_ENERGY_CAPACITY[s.room.controller ? s.room.controller.level : 0] || 50,
    tower: () => 1000, link: () => 800, storage: () => 1000000, terminal: () => 300000, container: () => 2000, lab: () => 2000,
};
class Structure extends RoomObject {
    constructor(x, y, r, type, opts) {
        super(x, y, r); opts = opts || {};
        this.structureType = type;
        this.hitsMax = opts.hitsMax || HITS[type] || 1000;
        this.hits = opts.hits != null ? opts.hits : this.hitsMax;
        this.owner = opts.neutral ? undefined : { username: MY_NAME };
        this.my = !opts.neutral;
        if (CAPACITY[type]) this.store = makeStore(() => CAPACITY[type](this), opts.store);
        if (type === 'link') this.cooldown = 0;
        if (type === 'terminal') this.cooldown = 0;
        if (type === 'spawn') { this.name = opts.name; this.spawning = null; }
        if (type === 'rampart') this.isPublic = false;
    }
    isActive() {
        const room = this.room; if (!room || !room.controller) return false;
        const row = C.CONTROLLER_STRUCTURES[this.structureType];
        if (!row) return true;
        const cap = row[room.controller.level] || 0;
        const list = room.structures.filter(s => s.structureType === this.structureType && s.my);
        if (list.length <= cap) return true;
        if (this._off != null && this._offLevel == null) this._offLevel = room.controller.level;
        if (this._off != null && room.controller.level === this._offLevel) return !this._off;
        // newest first (matches what the live snapshot shows)
        const sorted = list.slice().sort((a, b) => (a.id < b.id ? 1 : -1));
        return sorted.indexOf(this) < cap;
    }
    destroy() {
        if (this.room.find(C.FIND_HOSTILE_CREEPS).length) return C.ERR_BUSY;
        destroyStructure(this, true); return C.OK;
    }
    notifyWhenAttacked() { return C.OK; }
    // spawn
    spawnCreep(body, name, opts) {
        if (this.structureType !== 'spawn') return C.ERR_INVALID_TARGET;
        if (!this.isActive()) return C.ERR_RCL_NOT_ENOUGH;
        if (this.spawning) return C.ERR_BUSY;
        if (W.creeps[name]) return C.ERR_NAME_EXISTS;
        if (!body || !body.length || body.length > 50) return C.ERR_INVALID_ARGS;
        let cost = 0; for (const p of body) { if (!(p in C.BODYPART_COST)) return C.ERR_INVALID_ARGS; cost += C.BODYPART_COST[p]; }
        const room = this.room;
        if (room.energyAvailable < cost) return C.ERR_NOT_ENOUGH_ENERGY;
        // deduct: spawns then extensions (active only)
        let left = cost;
        const pool = room.structures.filter(s => (s.structureType === 'spawn' || s.structureType === 'extension') && s.my && s.isActive());
        for (const s of pool) { const take = Math.min(left, s.store.energy || 0); s.store.energy = (s.store.energy || 0) - take; left -= take; if (!left) break; }
        if (opts && opts.memory) { Memory.creeps = Memory.creeps || {}; Memory.creeps[name] = JSON.parse(JSON.stringify(opts.memory)); }
        const creep = new Creep(this.pos.x, this.pos.y, this.pos.roomName, name, body.map(t => ({ type: t, hits: 100 })));
        creep.spawning = true; creep.ticksToLive = undefined;
        W.creeps[name] = creep; W.objects[creep.id] = creep;
        this.spawning = { name, needTime: body.length * 3, remainingTime: body.length * 3, directions: opts && opts.directions, creep };
        W.stats.spawned++;
        return C.OK;
    }
    recycleCreep(creep) {
        if (!this.pos.isNearTo(creep)) return C.ERR_NOT_IN_RANGE;
        killCreep(creep, true); return C.OK;
    }
    renewCreep() { return C.ERR_BUSY; }
    // tower
    attack(t) { return this._towerAct(t, () => { if (t.hits != null) t.hits -= 300; }); }
    heal(t) { return this._towerAct(t, () => { t.hits = Math.min(t.hitsMax, t.hits + 200); }); }
    repair(t) { return this._towerAct(t, () => { t.hits = Math.min(t.hitsMax, t.hits + 400); W.stats.towerRepairs = (W.stats.towerRepairs || 0) + 1; }); }
    _towerAct(t, fn) {
        if (this.structureType !== 'tower') return C.ERR_INVALID_TARGET;
        if (!this.isActive()) return C.ERR_RCL_NOT_ENOUGH;
        if ((this.store.energy || 0) < 10) return C.ERR_NOT_ENOUGH_ENERGY;
        if (!t || !t.pos || t.pos.roomName !== this.pos.roomName) return C.ERR_INVALID_TARGET;
        if (this._acted === W.time) return C.ERR_BUSY;
        this._acted = W.time; this.store.energy -= 10; fn(); return C.OK;
    }
    // link
    transferEnergy(target, amount) {
        if (this.structureType !== 'link') return C.ERR_INVALID_TARGET;
        if (!this.isActive()) return C.ERR_RCL_NOT_ENOUGH;
        if (this.cooldown > 0) return C.ERR_TIRED;
        amount = amount || this.store.energy || 0;
        if ((this.store.energy || 0) < amount) return C.ERR_NOT_ENOUGH_RESOURCES;
        if (target.store.getFreeCapacity('energy') < amount) return C.ERR_FULL;
        this.store.energy -= amount; target.store.energy = (target.store.energy || 0) + Math.floor(amount * 0.97);
        this.cooldown = this.pos.getRangeTo(target); return C.OK;
    }
    // terminal
    send(res, amount, dest) {
        if (this.structureType !== 'terminal') return C.ERR_INVALID_TARGET;
        const fee = Game.market.calcTransactionCost(amount, this.pos.roomName, dest);
        if ((this.store.energy || 0) < amount + fee) return C.ERR_NOT_ENOUGH_RESOURCES;
        this.store.energy -= amount + fee;
        const room = W.rooms[dest]; if (room && room.terminal) room.terminal.store.energy = (room.terminal.store.energy || 0) + amount;
        this.cooldown = 10; return C.OK;
    }
}
class Controller extends RoomObject {
    constructor(x, y, r, o) {
        super(x, y, r); this.structureType = 'controller';
        this.level = o.level || 0; this.progress = o.progress || 0;
        this.my = o.user === ME; this.owner = o.user ? { username: o.user === ME ? MY_NAME : 'other' } : undefined;
        this.ticksToDowngrade = o.downgradeTime ? Math.max(1, o.downgradeTime - W.time) : C.CONTROLLER_DOWNGRADE[this.level];
        this.safeModeAvailable = o.safeModeAvailable || 0; this.safeMode = undefined; this.safeModeCooldown = undefined;
        this.sign = o.sign ? { text: o.sign.text, username: MY_NAME } : undefined;
        this.reservation = undefined; this.hits = undefined;
    }
    get progressTotal() { return C.CONTROLLER_LEVELS[this.level]; }
    unclaim() { if (!this.my) return C.ERR_NOT_OWNER; this.my = false; this.owner = undefined; this.level = 0; this.progress = 0; W.logs.push('UNCLAIMED ' + this.pos.roomName); return C.OK; }
    activateSafeMode() { if (!this.safeModeAvailable) return C.ERR_NOT_ENOUGH_RESOURCES; this.safeModeAvailable--; this.safeMode = 20000; W.logs.push('SAFE MODE in ' + this.pos.roomName); return C.OK; }
}

class Creep extends RoomObject {
    constructor(x, y, r, name, body) {
        super(x, y, r); this.name = name; this.body = body; this.my = true; this.owner = { username: MY_NAME };
        this.hitsMax = body.length * 100; this.hits = this.hitsMax; this.fatigue = 0; this.spawning = false; this.ticksToLive = 1500;
        const carry = body.filter(p => p.type === 'carry').length * 50;
        this.store = makeStore(() => carry, {});
        this._acts = {}; this._moveIntent = null;
    }
    get memory() { Memory.creeps = Memory.creeps || {}; return Memory.creeps[this.name] || (Memory.creeps[this.name] = {}); }
    set memory(v) { Memory.creeps[this.name] = v; }
    getActiveBodyparts(type) { return this.body.filter(p => p.type === type && p.hits > 0).length; }
    say() { return C.OK; }
    suicide() { killCreep(this, false); return C.OK; }
    _group(g) { if (this.spawning) return C.ERR_BUSY; if (this._acts[g] === W.time) return C.ERR_BUSY; this._acts[g] = W.time; return C.OK; }
    harvest(src) {
        if (!this.getActiveBodyparts('work')) return C.ERR_NO_BODYPART;
        if (!src || !(src instanceof Source)) return C.ERR_INVALID_TARGET;
        if (!this.pos.isNearTo(src)) return C.ERR_NOT_IN_RANGE;
        if (src.energy <= 0) return C.ERR_NOT_ENOUGH_RESOURCES;
        const g = this._group('work'); if (g !== C.OK) return g;
        const amount = Math.min(src.energy, this.getActiveBodyparts('work') * 2);
        src.energy -= amount; if (src.ticksToRegeneration == null) src.ticksToRegeneration = 300;
        const free = this.store.getFreeCapacity('energy');
        const into = Math.min(free, amount);
        if (into > 0) this.store.energy = (this.store.energy || 0) + into;
        const spill = amount - into;
        if (spill > 0) dropEnergy(this.pos, spill);
        W.stats.harvested = (W.stats.harvested || 0) + amount;
        return C.OK;
    }
    transfer(target, res, amount) {
        if (!target || !target.store) return C.ERR_INVALID_TARGET;
        if (!this.pos.isNearTo(target)) return C.ERR_NOT_IN_RANGE;
        const have = this.store[res] || 0; if (!have) return C.ERR_NOT_ENOUGH_RESOURCES;
        const g = this._group('carry'); if (g !== C.OK) return g;
        const free = target.store.getFreeCapacity(res);
        if (free <= 0) return C.ERR_FULL;
        const n = Math.min(have, free, amount || Infinity);
        this.store[res] -= n; if (!this.store[res]) delete this.store[res];
        target.store[res] = (target.store[res] || 0) + n; return C.OK;
    }
    withdraw(target, res, amount) {
        if (!target || !target.store) return C.ERR_INVALID_TARGET;
        if (!this.pos.isNearTo(target)) return C.ERR_NOT_IN_RANGE;
        const have = target.store[res] || 0; if (!have) return C.ERR_NOT_ENOUGH_RESOURCES;
        const free = this.store.getFreeCapacity(res); if (free <= 0) return C.ERR_FULL;
        const g = this._group('carry'); if (g !== C.OK) return g;
        const n = Math.min(have, free, amount || Infinity);
        target.store[res] -= n; this.store[res] = (this.store[res] || 0) + n; return C.OK;
    }
    pickup(r) {
        if (!(r instanceof Resource)) return C.ERR_INVALID_TARGET;
        if (!this.pos.isNearTo(r)) return C.ERR_NOT_IN_RANGE;
        const free = this.store.getFreeCapacity('energy'); if (free <= 0) return C.ERR_FULL;
        const g = this._group('carry'); if (g !== C.OK) return g;
        const n = Math.min(free, r.amount); r.amount -= n; this.store.energy = (this.store.energy || 0) + n;
        if (r.amount <= 0) removeResource(r); return C.OK;
    }
    drop(res, amount) { const g = this._group('carry'); if (g !== C.OK) return g; const n = Math.min(this.store[res] || 0, amount || Infinity); this.store[res] -= n; dropEnergy(this.pos, n); return C.OK; }
    build(site) {
        if (!(site instanceof ConstructionSite) || site._done) return C.ERR_INVALID_TARGET;
        if (!this.pos.inRangeTo(site, 3)) return C.ERR_NOT_IN_RANGE;
        const work = this.getActiveBodyparts('work'); if (!work) return C.ERR_NO_BODYPART;
        const e = this.store.energy || 0; if (!e) return C.ERR_NOT_ENOUGH_RESOURCES;
        const g = this._group('work'); if (g !== C.OK) return g;
        const n = Math.min(work * 5, e, site.progressTotal - site.progress);
        this.store.energy -= n; site.progress += n; W.stats.buildEnergy = (W.stats.buildEnergy || 0) + n;
        if (site.progress >= site.progressTotal) completeSite(site);
        return C.OK;
    }
    repair(s) {
        if (!s || s.hits == null) return C.ERR_INVALID_TARGET;
        if (!this.pos.inRangeTo(s, 3)) return C.ERR_NOT_IN_RANGE;
        const work = this.getActiveBodyparts('work'); if (!work) return C.ERR_NO_BODYPART;
        const e = this.store.energy || 0; if (!e) return C.ERR_NOT_ENOUGH_RESOURCES;
        const g = this._group('work'); if (g !== C.OK) return g;
        const n = Math.min(work, e); this.store.energy -= n; s.hits = Math.min(s.hitsMax, s.hits + n * 100); return C.OK;
    }
    upgradeController(ctrl) {
        if (!(ctrl instanceof Controller) || !ctrl.my) return C.ERR_INVALID_TARGET;
        if (!this.pos.inRangeTo(ctrl, 3)) return C.ERR_NOT_IN_RANGE;
        const work = this.getActiveBodyparts('work'); if (!work) return C.ERR_NO_BODYPART;
        const e = this.store.energy || 0; if (!e) return C.ERR_NOT_ENOUGH_RESOURCES;
        const g = this._group('work'); if (g !== C.OK) return g;
        let n = Math.min(work, e);
        if (ctrl.level === 8) { ctrl._up = ctrl._up || {}; const used = ctrl._up[W.time] || 0; n = Math.min(n, 15 - used); if (n <= 0) return C.ERR_FULL; ctrl._up[W.time] = used + n; }
        this.store.energy -= n; ctrl.progress += n; W.stats.upgraded = (W.stats.upgraded || 0) + n;
        ctrl.ticksToDowngrade = Math.min(C.CONTROLLER_DOWNGRADE[ctrl.level], ctrl.ticksToDowngrade + 100);
        if (ctrl.level < 8 && ctrl.progress >= ctrl.progressTotal) { ctrl.progress -= ctrl.progressTotal; ctrl.level++; ctrl.ticksToDowngrade = C.CONTROLLER_DOWNGRADE[ctrl.level]; W.logs.push(ctrl.pos.roomName + ' reached RCL' + ctrl.level + ' at tick ' + W.time); }
        return C.OK;
    }
    signController(ctrl, text) { if (!this.pos.isNearTo(ctrl)) return C.ERR_NOT_IN_RANGE; ctrl.sign = { text, username: MY_NAME }; return C.OK; }
    claimController(ctrl) { if (!this.pos.isNearTo(ctrl)) return C.ERR_NOT_IN_RANGE; if (!this.getActiveBodyparts('claim')) return C.ERR_NO_BODYPART; ctrl.my = true; ctrl.level = 1; ctrl.owner = { username: MY_NAME }; ctrl.ticksToDowngrade = 20000; return C.OK; }
    reserveController(ctrl) { if (!this.pos.isNearTo(ctrl)) return C.ERR_NOT_IN_RANGE; return C.OK; }
    attack(t) { if (!this.pos.isNearTo(t)) return C.ERR_NOT_IN_RANGE; const g = this._group('work'); if (g !== C.OK) return g; t.hits -= 30 * this.getActiveBodyparts('attack'); return C.OK; }
    rangedAttack(t) { if (!this.pos.inRangeTo(t, 3)) return C.ERR_NOT_IN_RANGE; t.hits -= 10 * this.getActiveBodyparts('ranged_attack'); return C.OK; }
    rangedMassAttack() { return C.OK; }
    heal(t) { t.hits = Math.min(t.hitsMax, t.hits + 12); return C.OK; }
    move(dir) {
        if (this.spawning) return C.ERR_BUSY;
        if (this.fatigue > 0) return C.ERR_TIRED;
        const d = { 1: [0, -1], 2: [1, -1], 3: [1, 0], 4: [1, 1], 5: [0, 1], 6: [-1, 1], 7: [-1, 0], 8: [-1, -1] }[dir];
        if (!d) return C.ERR_INVALID_ARGS;
        this._moveIntent = { x: this.pos.x + d[0], y: this.pos.y + d[1] }; return C.OK;
    }
    moveTo(a, b, c) {
        let target, opts;
        if (typeof a === 'number') { target = new RoomPosition(a, b, this.pos.roomName); opts = c || {}; }
        else { target = toPos(a); opts = b || {}; }
        if (!target) return C.ERR_INVALID_TARGET;
        if (this.spawning) return C.ERR_BUSY;
        const range = opts.range || 0;
        if (target.roomName === this.pos.roomName && this.pos.inRangeTo(target, range)) return C.OK;
        if (this.fatigue > 0) return C.ERR_TIRED;
        W.stats.moveToCalls = (W.stats.moveToCalls || 0) + 1;
        let goal = target;
        if (target.roomName !== this.pos.roomName) {
            goal = exitToward(this.pos.roomName, target.roomName, this.pos);
            if (!goal) return C.ERR_NO_PATH;
        }
        const key = goal.x + ',' + goal.y + ',' + goal.roomName + ',' + range;
        const reuse = opts.reusePath != null ? opts.reusePath : 5;
        let cached = this._path;
        if (!cached || cached.key !== key || cached.until < W.time || !cached.path.length) {
            const res = PathFinder.search(this.pos, { pos: goal, range: target.roomName === this.pos.roomName ? range : 0 }, {
                roomCallback: () => { let m = roomMatrix(this.room, opts.ignoreCreeps !== false ? null : this); if (opts.costCallback) { m = m.clone(); const r = opts.costCallback(this.room.name, m); if (r instanceof CostMatrix) m = r; } return m; },
                plainCost: opts.plainCost || 2, swampCost: opts.swampCost || 10, maxOps: opts.maxOps || 2000,
            });
            W.stats.pathSearches = (W.stats.pathSearches || 0) + 1;
            cached = this._path = { key, path: res.path, until: W.time + reuse, incomplete: res.incomplete };
            if (!res.path.length) return res.incomplete ? C.ERR_NO_PATH : C.OK;
        }
        const next = cached.path[0];
        this._moveIntent = { x: next.x, y: next.y, fromPath: true };
        return C.OK;
    }
}

/* ---------------- Room ---------------- */
class Room {
    constructor(name, terrain) {
        this.name = name; this.terrain = terrain;
        this.structures = []; this.creeps = []; this.sites = []; this.resources = []; this.tombstones = []; this.ruins = [];
        this.sources = []; this.minerals = []; this.controller = null;
        this.visual = { text() { }, circle() { }, line() { }, rect() { } };
    }
    get memory() { Memory.rooms = Memory.rooms || {}; return Memory.rooms[this.name] || (Memory.rooms[this.name] = {}); }
    get storage() { return this.structures.find(s => s.structureType === 'storage'); }
    get terminal() { return this.structures.find(s => s.structureType === 'terminal'); }
    get energyAvailable() { let n = 0; for (const s of this.structures) if ((s.structureType === 'spawn' || s.structureType === 'extension') && s.my && s.isActive()) n += s.store.energy || 0; return n; }
    get energyCapacityAvailable() { let n = 0; for (const s of this.structures) if ((s.structureType === 'spawn' || s.structureType === 'extension') && s.my && s.isActive()) n += s.store.getCapacity('energy'); return n; }
    getTerrain() { return this.terrain; }
    find(type, opts) {
        let list;
        switch (type) {
            case C.FIND_SOURCES: list = this.sources; break;
            case C.FIND_SOURCES_ACTIVE: list = this.sources.filter(s => s.energy > 0); break;
            case C.FIND_MINERALS: list = this.minerals; break;
            case C.FIND_STRUCTURES: list = this.structures.concat(this.controller ? [this.controller] : []); break;
            case C.FIND_MY_STRUCTURES: list = this.structures.filter(s => s.my).concat(this.controller && this.controller.my ? [this.controller] : []); break;
            case C.FIND_HOSTILE_STRUCTURES: list = this.structures.filter(s => s.owner && !s.my); break;
            case C.FIND_MY_SPAWNS: list = this.structures.filter(s => s.structureType === 'spawn' && s.my); break;
            case C.FIND_CREEPS: list = this.creeps; break;
            case C.FIND_MY_CREEPS: list = this.creeps.filter(c => c.my); break;
            case C.FIND_HOSTILE_CREEPS: list = this.creeps.filter(c => !c.my); break;
            case C.FIND_CONSTRUCTION_SITES: case C.FIND_MY_CONSTRUCTION_SITES: list = this.sites; break;
            case C.FIND_DROPPED_RESOURCES: list = this.resources; break;
            case C.FIND_TOMBSTONES: list = this.tombstones; break;
            case C.FIND_RUINS: list = this.ruins; break;
            case C.FIND_FLAGS: case C.FIND_NUKES: case C.FIND_POWER_CREEPS: case C.FIND_HOSTILE_SPAWNS: list = []; break;
            default: throw new Error('find type not supported: ' + type);
        }
        W.stats.finds = (W.stats.finds || 0) + 1;
        list = list.slice();
        if (opts && opts.filter) list = list.filter(opts.filter);
        return list;
    }
    lookForAt(look, x, y) {
        const at = o => o.pos.x === x && o.pos.y === y;
        switch (look) {
            case C.LOOK_STRUCTURES: return this.structures.filter(at).concat(this.controller && at(this.controller) ? [this.controller] : []);
            case C.LOOK_CONSTRUCTION_SITES: return this.sites.filter(at);
            case C.LOOK_CREEPS: return this.creeps.filter(at);
            case C.LOOK_RESOURCES: case C.LOOK_ENERGY: return this.resources.filter(at);
            case C.LOOK_TERRAIN: return [this.terrain.get(x, y) === 1 ? 'wall' : this.terrain.get(x, y) === 2 ? 'swamp' : 'plain'];
            default: return [];
        }
    }
    createConstructionSite(x, y, type) {
        if (x < 0 || x > 49 || y < 0 || y > 49) return C.ERR_INVALID_ARGS;
        if (Object.keys(W.sites).length >= 100) return C.ERR_FULL;
        if (this.terrain.get(x, y) === 1 && type !== 'extractor') return C.ERR_INVALID_TARGET;
        const here = this.lookForAt(C.LOOK_STRUCTURES, x, y);
        if (type !== 'rampart' && here.some(s => s.structureType !== 'rampart' && s.structureType !== 'road')) return C.ERR_INVALID_TARGET;
        if (type === 'road' && here.some(s => s.structureType === 'road')) return C.ERR_INVALID_TARGET;
        if (type === 'rampart' && here.some(s => s.structureType === 'rampart')) return C.ERR_INVALID_TARGET;
        // roads do not block construction in the real game
        if (this.sites.some(s => s.pos.x === x && s.pos.y === y)) return C.ERR_INVALID_TARGET;
        if (C.OBSTACLE_OBJECT_TYPES.includes(type) && this.creeps.some(c => c.pos.x === x && c.pos.y === y)) return C.ERR_INVALID_TARGET;
        const row = C.CONTROLLER_STRUCTURES[type];
        const level = this.controller ? this.controller.level : 0;
        if (row) {
            const cap = row[level] || 0;
            const n = this.structures.filter(s => s.structureType === type).length + this.sites.filter(s => s.structureType === type).length;
            if (n >= cap) return C.ERR_RCL_NOT_ENOUGH;
        }
        if (this.sources.some(s => s.pos.x === x && s.pos.y === y) || this.minerals.some(m => m.pos.x === x && m.pos.y === y) && type !== 'extractor') return C.ERR_INVALID_TARGET;
        if (this.controller && this.controller.pos.x === x && this.controller.pos.y === y) return C.ERR_INVALID_TARGET;
        
        const site = new ConstructionSite(x, y, this.name, type);
        this.sites.push(site); W.sites[site.id] = site; W.objects[site.id] = site;
        W.stats.sitesCreated = (W.stats.sitesCreated || 0) + 1;
        return C.OK;
    }
}

/* ---------------- helpers ---------------- */
function dropEnergy(pos, amount) {
    const room = W.rooms[pos.roomName];
    const cont = room.structures.find(s => s.structureType === 'container' && s.pos.x === pos.x && s.pos.y === pos.y);
    if (cont) { const free = cont.store.getFreeCapacity('energy'); const n = Math.min(free, amount); cont.store.energy = (cont.store.energy || 0) + n; amount -= n; }
    if (amount <= 0) return;
    let r = room.resources.find(r => r.pos.x === pos.x && r.pos.y === pos.y);
    if (r) r.amount += amount; else { r = new Resource(pos.x, pos.y, pos.roomName, amount); room.resources.push(r); W.objects[r.id] = r; }
}
function removeResource(r) { const room = W.rooms[r.pos.roomName]; room.resources = room.resources.filter(x => x !== r); delete W.objects[r.id]; }
function removeSite(site) { const room = W.rooms[site.pos.roomName]; room.sites = room.sites.filter(s => s !== site); delete W.sites[site.id]; delete W.objects[site.id]; }
function completeSite(site) {
    site._done = true;
    removeSite(site);
    const room = W.rooms[site.pos.roomName];
    const neutral = ['road', 'container', 'constructedWall'].includes(site.structureType);
    const opts = { neutral };
    if (site.structureType === 'rampart' || site.structureType === 'constructedWall') { opts.hits = 1; opts.hitsMax = site.structureType === 'rampart' ? (C.RAMPART_HITS_MAX[room.controller.level] || 300000) : 300000000; }
    if (site.structureType === 'spawn') { let n = 1; while (W.spawns['Spawn' + n]) n++; opts.name = 'Spawn' + n; }
    const s = new Structure(site.pos.x, site.pos.y, site.pos.roomName, site.structureType, opts);
    room.structures.push(s); W.objects[s.id] = s; if (s.structureType === 'spawn') W.spawns[s.name] = s;
    W.stats.built[site.structureType] = (W.stats.built[site.structureType] || 0) + 1;
}
function destroyStructure(s, ruin) {
    const room = W.rooms[s.pos.roomName];
    room.structures = room.structures.filter(x => x !== s); delete W.objects[s.id];
    if (s.structureType === 'spawn') delete W.spawns[s.name];
    W.stats.destroyed++;
    if (ruin && s.store && s.store.energy) { const r = new Ruin(s.pos.x, s.pos.y, s.pos.roomName, { energy: s.store.energy }); room.ruins.push(r); W.objects[r.id] = r; }
}
function killCreep(creep, recycled) {
    const room = W.rooms[creep.pos.roomName];
    room.creeps = room.creeps.filter(c => c !== creep);
    delete W.creeps[creep.name]; delete W.objects[creep.id];
    if (!creep.spawning) {
        const energy = creep.store.energy || 0;
        if (energy > 0 || !recycled) { const t = new Tombstone(creep.pos.x, creep.pos.y, creep.pos.roomName, { energy }, creep.body.length * 5); room.tombstones.push(t); W.objects[t.id] = t; }
    }
    W.stats.died++;
}
function blockingAt(room, x, y, ignoreCreep) {
    if (room.terrain.get(x, y) === 1) return true;
    for (const s of room.structures) if (s.pos.x === x && s.pos.y === y && C.OBSTACLE_OBJECT_TYPES.includes(s.structureType)) return true;
    for (const s of room.sites) if (s.pos.x === x && s.pos.y === y && C.OBSTACLE_OBJECT_TYPES.includes(s.structureType) && s.my) { /* sites do not block in real game */ }
    if (room.controller && room.controller.pos.x === x && room.controller.pos.y === y) return true;
    for (const s of room.sources) if (s.pos.x === x && s.pos.y === y) return true;
    for (const m of room.minerals) if (m.pos.x === x && m.pos.y === y) return true;
    return false;
}
function roomMatrix(room, creepAware) {
    const key = creepAware ? 'mc' : 'm';
    if (room._mx && room._mx[key] && room._mx[key].t === W.time) return room._mx[key].m;
    const m = new CostMatrix();
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
        if (blockingAt(room, x, y)) m.set(x, y, 255);
    }
    for (const s of room.structures) if (s.structureType === 'road' && !blockingAt(room, s.pos.x, s.pos.y)) m.set(s.pos.x, s.pos.y, 1);
    if (creepAware) for (const c of room.creeps) if (!c.spawning && c !== creepAware) m.set(c.pos.x, c.pos.y, 255);
    room._mx = room._mx || {}; room._mx[key] = { t: W.time, m };
    return m;
}
function exitToward(from, to, pos) {
    const a = worldXY(from); const b = worldXY(to);
    const dx = Math.sign(b.x - a.x); const dy = Math.sign(b.y - a.y);
    const room = W.rooms[from];
    // choose horizontal or vertical exit: prefer the axis with larger distance
    const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) && dx !== 0;
    let best = null, bestD = Infinity;
    for (let i = 1; i < 49; i++) {
        const x = horiz ? (dx > 0 ? 49 : 0) : i; const y = horiz ? i : (dy > 0 ? 0 : 49);
        if (room.terrain.get(x, y) === 1) continue;
        const d = Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y));
        if (d < bestD) { bestD = d; best = new RoomPosition(x, y, from); }
    }
    return best;
}

/* ---------------- PathFinder ---------------- */
class CostMatrix {
    constructor() { this._bits = new Uint8Array(2500); }
    set(x, y, v) { this._bits[y * 50 + x] = v; }
    get(x, y) { return this._bits[y * 50 + x]; }
    clone() { const m = new CostMatrix(); m._bits = new Uint8Array(this._bits); return m; }
}
function search(origin, goalsIn, opts) {
    opts = opts || {};
    const goals = (Array.isArray(goalsIn) ? goalsIn : [goalsIn]).map(g => g.pos ? { pos: g.pos, range: g.range || 0 } : { pos: g, range: 0 });
    const roomName = origin.roomName;
    const room = W.rooms[roomName];
    let matrix = null;
    if (opts.roomCallback) { const r = opts.roomCallback(roomName); if (r === false) return { path: [], incomplete: true, ops: 0, cost: 0 }; if (r instanceof CostMatrix) matrix = r; }
    const plain = opts.plainCost || 1, swamp = opts.swampCost || 5;
    const cost = (x, y) => {
        if (x < 0 || x > 49 || y < 0 || y > 49) return 255;
        const v = matrix ? matrix.get(x, y) : 0;
        if (v === 255) return 255;
        if (v > 0) return v;
        const t = room.terrain.get(x, y);
        if (t === 1) return 255;
        return t === 2 ? swamp : plain;
    };
    const goalDist = (x, y) => { let d = Infinity; for (const g of goals) d = Math.min(d, Math.max(Math.abs(g.pos.x - x), Math.abs(g.pos.y - y)) - g.range); return Math.max(0, d); };
    const start = origin.y * 50 + origin.x;
    const gScore = new Float64Array(2500).fill(Infinity); gScore[start] = 0;
    const came = new Int32Array(2500).fill(-1);
    const closed = new Uint8Array(2500);
    const heap = [[goalDist(origin.x, origin.y), start]];
    let ops = 0; const maxOps = opts.maxOps || 2000;
    let bestNode = start, bestH = goalDist(origin.x, origin.y);
    const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let found = -1;
    while (heap.length) {
        const [, cur] = pop();
        if (closed[cur]) continue; closed[cur] = 1; ops++;
        const cx = cur % 50, cy = (cur - cx) / 50;
        const h = goalDist(cx, cy);
        if (h < bestH) { bestH = h; bestNode = cur; }
        if (h === 0) { found = cur; break; }
        if (ops > maxOps) break;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
            const c = cost(nx, ny); if (c === 255) continue;
            const ni = ny * 50 + nx; if (closed[ni]) continue;
            const g = gScore[cur] + c;
            if (g < gScore[ni]) { gScore[ni] = g; came[ni] = cur; push([g + goalDist(nx, ny), ni]); }
        }
    }
    const end = found >= 0 ? found : bestNode;
    const path = [];
    let n = end;
    while (n !== start && n >= 0) { path.push(new RoomPosition(n % 50, Math.floor(n / 50), roomName)); n = came[n]; }
    path.reverse();
    return { path, incomplete: found < 0, ops, cost: gScore[end] };
}
const PathFinder = { search, CostMatrix };

/* ---------------- loading ---------------- */
function loadRoom(name, dir) {
    const terrainJson = JSON.parse(fs.readFileSync(path.join(dir, 'terrain', name + '.json')));
    const room = new Room(name, new Terrain(terrainJson.terrain[0].terrain));
    W.rooms[name] = room;
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'rooms', name + '.json')));
    const spawnsByName = {};
    for (const o of data.objects) {
        let obj = null;
        switch (o.type) {
            case 'source': obj = new Source(o.x, o.y, name, o.energy); room.sources.push(obj); break;
            case 'mineral': obj = new Mineral(o.x, o.y, name); room.minerals.push(obj); break;
            case 'controller': obj = new Controller(o.x, o.y, name, o); room.controller = obj; break;
            case 'energy': obj = new Resource(o.x, o.y, name, o.energy); room.resources.push(obj); break;
            case 'tombstone': obj = new Tombstone(o.x, o.y, name, o.store || {}, 50); room.tombstones.push(obj); break;
            case 'ruin': obj = new Ruin(o.x, o.y, name, o.store || {}); room.ruins.push(obj); break;
            case 'constructionSite': if (o.user !== ME) break; obj = new ConstructionSite(o.x, o.y, name, o.structureType); obj.progress = o.progress || 0; room.sites.push(obj); W.sites[obj.id] = obj; break;
            case 'creep': {
                if (o.user !== ME) break;
                obj = new Creep(o.x, o.y, name, o.name, o.body.map(b => ({ type: b.type, hits: b.hits })));
                for (const k in (o.store || {})) if (o.store[k] > 0) obj.store[k] = o.store[k];
                obj.hits = o.hits;
                if (o.ageTime) obj.ticksToLive = o.ageTime - W.time; else { obj.spawning = true; obj.ticksToLive = undefined; }
                room.creeps.push(obj); W.creeps[o.name] = obj;
                break;
            }
            case 'spawn': case 'extension': case 'tower': case 'storage': case 'terminal': case 'link': case 'lab': case 'extractor': case 'observer': case 'nuker': case 'factory': case 'powerSpawn':
            case 'container': case 'road': case 'rampart': case 'constructedWall': {
                const neutral = ['container', 'road', 'constructedWall'].includes(o.type);
                if (!neutral && o.user !== ME) break;
                obj = new Structure(o.x, o.y, name, o.type, { neutral, hits: o.hits, hitsMax: o.hitsMax, name: o.name, store: o.store });
                if (o.off != null) { obj._off = !!o.off; obj._offLevel = null; }
                room.structures.push(obj);
                if (o.type === 'spawn') { W.spawns[o.name] = obj; spawnsByName[o.name] = { obj, data: o }; }
                break;
            }
            default: break;
        }
        if (obj) { if (o._id) obj.id = o._id; W.objects[obj.id] = obj; }
    }
    // attach spawning creeps to spawns (stuck ones get remainingTime 0)
    for (const n in spawnsByName) {
        const { obj, data } = spawnsByName[n];
        if (data.spawning && W.creeps[data.spawning.name]) {
            const creep = W.creeps[data.spawning.name];
            creep.spawning = true;
            obj.spawning = { name: creep.name, needTime: data.spawning.needTime, remainingTime: 0, directions: null, creep };
        }
    }
    room.creeps = room.creeps.filter(c => !c.spawning || Object.values(spawnsByName).some(s => s.obj.spawning && s.obj.spawning.name === c.name));
    for (const n in W.creeps) if (W.creeps[n].spawning && !Object.values(W.spawns).some(s => s.spawning && s.spawning.name === n)) { delete W.creeps[n]; }
    return room;
}

/* ---------------- tick processing ---------------- */
function endTick() {
    runInvaders();
    // moves: resolved simultaneously so creeps can follow and swap like the real engine
    const pending = [];
    const occupant = {};
    for (const name in W.creeps) {
        const c = W.creeps[name];
        if (c.spawning) continue;
        occupant[c.pos.roomName + ':' + c.pos.x + ':' + c.pos.y] = c;
    }
    for (const name in W.creeps) {
        const c = W.creeps[name];
        if (!c._moveIntent || c.spawning) { c._moveIntent = null; continue; }
        const room = c.room; const { x, y } = c._moveIntent; c._moveIntent = null;
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;
        if (Math.max(Math.abs(x - c.pos.x), Math.abs(y - c.pos.y)) !== 1) { c._path = null; continue; }
        if (blockingAt(room, x, y)) { c._path = null; continue; }
        pending.push({ c, room, x, y, key: room.name + ':' + x + ':' + y, state: 'pending' });
    }
    const claimed = {};
    const byCreep = new Map(); for (const p of pending) byCreep.set(p.c, p);
    for (let pass = 0; pass < 6; pass++) {
        let progress = false;
        for (const p of pending) {
            if (p.state !== 'pending') continue;
            if (claimed[p.key]) { p.state = 'rejected'; progress = true; continue; }
            const occ = occupant[p.key];
            if (!occ || occ === p.c) { p.state = 'ok'; claimed[p.key] = true; progress = true; continue; }
            const op = byCreep.get(occ);
            if (!op || op.state === 'rejected') { p.state = 'rejected'; progress = true; continue; }
            if (op.state === 'ok') { p.state = 'ok'; claimed[p.key] = true; progress = true; continue; }
        }
        if (!progress) break;
    }
    for (const p of pending) if (p.state === 'pending') p.state = 'ok';
    for (const p of pending) {
        const c = p.c; const room = p.room; const x = p.x; const y = p.y;
        if (p.state !== 'ok') { W.stats.blockedMoves = (W.stats.blockedMoves || 0) + 1; continue; }
        const t = room.terrain.get(x, y);
        const road = room.structures.some(s => s.structureType === 'road' && s.pos.x === x && s.pos.y === y);
        const weight = c.body.filter(p => p.type !== 'move' && !(p.type === 'carry' && !(c.store.getUsedCapacity() > 0))).length;
        c.fatigue += weight * (road ? 1 : t === 2 ? 10 : 2);
        c.pos = new RoomPosition(x, y, room.name);
        if (c._path && c._path.path.length && c._path.path[0].x === x && c._path.path[0].y === y) c._path.path.shift();
        // room transition
        if (x === 0 || x === 49 || y === 0 || y === 49) {
            const w = worldXY(room.name); let nx = w.x, ny = w.y, px = x, py = y;
            if (x === 0) { nx--; px = 49; } else if (x === 49) { nx++; px = 0; } else if (y === 0) { ny++; py = 49; } else { ny--; py = 0; }
            const dest = W.rooms[roomNameFromWorld(nx, ny)];
            if (dest) { room.creeps = room.creeps.filter(o => o !== c); dest.creeps.push(c); c.pos = new RoomPosition(px, py, dest.name); c._path = null; }
        }
        W.stats.moves = (W.stats.moves || 0) + 1;
    }
    for (const name in W.creeps) {
        const c = W.creeps[name];
        if (c.spawning) continue;
        c.fatigue = Math.max(0, c.fatigue - 2 * c.getActiveBodyparts('move'));
        c.ticksToLive--;
        if (c.ticksToLive <= 0) killCreep(c, false);
    }
    for (const rn in W.rooms) {
        const room = W.rooms[rn];
        for (const s of room.structures) {
            if (s.structureType === 'spawn' && s.spawning) {
                const sp = s.spawning;
                if (sp.remainingTime > 0) sp.remainingTime--;
                if (sp.remainingTime <= 0) {
                    const dirs = sp.directions && sp.directions.length ? sp.directions : [1, 2, 3, 4, 5, 6, 7, 8];
                    const d = { 1: [0, -1], 2: [1, -1], 3: [1, 0], 4: [1, 1], 5: [0, 1], 6: [-1, 1], 7: [-1, 0], 8: [-1, -1] };
                    let placed = false;
                    for (const dir of dirs) {
                        const x = s.pos.x + d[dir][0], y = s.pos.y + d[dir][1];
                        if (blockingAt(room, x, y)) continue;
                        if (room.creeps.some(o => o.pos.x === x && o.pos.y === y && !o.spawning)) continue;
                        const creep = sp.creep || W.creeps[sp.name];
                        if (!creep) break;
                        creep.pos = new RoomPosition(x, y, rn); creep.spawning = false;
                        creep.ticksToLive = creep.body.some(p => p.type === 'claim') ? 600 : 1500;
                        if (!room.creeps.includes(creep)) room.creeps.push(creep);
                        placed = true; break;
                    }
                    if (placed) s.spawning = null; else W.stats.spawnBlockedTicks = (W.stats.spawnBlockedTicks || 0) + 1;
                }
            }
            if (s.structureType === 'spawn' && s.my && s.isActive() && !s.spawning && (s.store.energy || 0) < 300 && room.energyAvailable < 300) s.store.energy = (s.store.energy || 0) + 1;
            if (s.structureType === 'link' && s.cooldown > 0) s.cooldown--;
            if (s.structureType === 'terminal' && s.cooldown > 0) s.cooldown--;
            if (s.structureType === 'rampart' && W.time % 100 === 0) { s.hits -= 300; if (s.hits <= 0) destroyStructure(s, false); }
            if (s.structureType === 'container' && W.time % 100 === 0) { s.hits -= 5000; if (s.hits <= 0) destroyStructure(s, false); }
            if (s.structureType === 'road' && W.time % 1000 === 0) { s.hits -= 100; if (s.hits <= 0) destroyStructure(s, false); }
        }
        for (const src of room.sources) {
            if (src.energy < src.energyCapacity) {
                if (src.ticksToRegeneration == null) src.ticksToRegeneration = 300;
                src.ticksToRegeneration--;
                if (src.ticksToRegeneration <= 0) { src.energy = src.energyCapacity; src.ticksToRegeneration = undefined; }
            }
        }
        for (const r of room.resources.slice()) { r.amount -= Math.ceil(r.amount / 1000); if (r.amount <= 0) removeResource(r); }
        for (const t of room.tombstones.slice()) { t.ticksToDecay--; if (t.ticksToDecay <= 0) { room.tombstones = room.tombstones.filter(x => x !== t); delete W.objects[t.id]; } }
        for (const t of room.ruins.slice()) { t.ticksToDecay--; if (t.ticksToDecay <= 0) { room.ruins = room.ruins.filter(x => x !== t); delete W.objects[t.id]; } }
        const ctrl = room.controller;
        if (ctrl && ctrl.my) {
            ctrl.ticksToDowngrade--;
            if (ctrl.safeMode) { ctrl.safeMode--; if (ctrl.safeMode <= 0) ctrl.safeMode = undefined; }
            if (ctrl.ticksToDowngrade <= 0) {
                W.logs.push(rn + ' DOWNGRADED from RCL' + ctrl.level + ' at tick ' + W.time);
                ctrl.level--; ctrl.progress = 0;
                if (ctrl.level <= 0) { ctrl.my = false; ctrl.owner = undefined; ctrl.level = 0; }
                else ctrl.ticksToDowngrade = C.CONTROLLER_DOWNGRADE[ctrl.level];
            }
        }
    }
}

/** Spawn a hostile NPC melee creep at a room edge that walks to the nearest spawn and hits what it reaches. */
function spawnInvader(roomName, parts) {
    const room = W.rooms[roomName];
    let pos = null;
    for (let x = 1; x < 49 && !pos; x++) if (room.terrain.get(x, 1) !== 1 && !blockingAt(room, x, 1)) pos = { x, y: 1 };
    for (let y = 1; y < 49 && !pos; y++) if (room.terrain.get(1, y) !== 1 && !blockingAt(room, 1, y)) pos = { x: 1, y };
    if (!pos) return null;
    const body = (parts || ['tough', 'tough', 'attack', 'attack', 'attack', 'move', 'move', 'move']).map(t => ({ type: t, hits: 100 }));
    const c = new Creep(pos.x, pos.y, roomName, 'Invader_' + (nextId++), body);
    c.my = false; c.owner = { username: 'Invader' }; c.ticksToLive = 1500;
    room.creeps.push(c); W.objects[c.id] = c; W.hostiles = W.hostiles || []; W.hostiles.push(c);
    W.logs.push('invader entered ' + roomName + ' at tick ' + W.time);
    return c;
}
function runInvaders() {
    if (!W.hostiles) return;
    for (const c of W.hostiles.slice()) {
        if (c.hits <= 0) { const room = W.rooms[c.pos.roomName]; room.creeps = room.creeps.filter(o => o !== c); delete W.objects[c.id]; W.hostiles = W.hostiles.filter(o => o !== c); W.logs.push('invader died at tick ' + W.time); continue; }
        const room = W.rooms[c.pos.roomName];
        if (room.controller && room.controller.safeMode) continue;
        // attack adjacent my creep/structure
        const victimCreep = room.creeps.find(o => o.my && !o.spawning && c.pos.isNearTo(o));
        const victimStruct = room.structures.find(o => o.my && c.pos.isNearTo(o) && o.structureType !== 'rampart');
        const target = victimCreep || victimStruct;
        if (target) { target.hits -= 90; if (target.hits <= 0) { if (target instanceof Creep) killCreep(target, false); else destroyStructure(target, false); } continue; }
        const spawn = room.structures.find(o => o.structureType === 'spawn');
        if (!spawn) continue;
        const res = search(c.pos, { pos: spawn.pos, range: 1 }, { roomCallback: () => roomMatrix(room, null), plainCost: 2, swampCost: 10 });
        if (res.path.length) { const n = res.path[0]; if (!room.creeps.some(o => o.pos.x === n.x && o.pos.y === n.y)) c.pos = new RoomPosition(n.x, n.y, room.name); }
    }
}
/** Strip ownership from a loaded room: controller neutral, owned structures gone (as after a loss). */
function makeUnowned(roomName) {
    const room = W.rooms[roomName];
    room.controller.my = false; room.controller.owner = undefined; room.controller.level = 0; room.controller.progress = 0; room.controller.sign = undefined;
    for (const s of room.structures.slice()) if (s.my) destroyStructure(s, false);
    for (const c of room.creeps.slice()) killCreep(c, true);
    room.sites = []; for (const id in W.sites) if (W.sites[id].pos.roomName === roomName) delete W.sites[id];
}
/** Lose a room the way a downgrade does: controller neutral, creeps dead, our structures still standing (inactive). */
function makeLost(roomName) {
    const room = W.rooms[roomName];
    room.controller.my = false; room.controller.owner = undefined; room.controller.level = 0; room.controller.progress = 0; room.controller.sign = undefined;
    for (const c of room.creeps.slice()) killCreep(c, true);
}
function makeGame() {
    const rooms = {}; for (const n in W.rooms) rooms[n] = W.rooms[n];
    return {
        time: W.time,
        rooms,
        creeps: Object.assign({}, W.creeps),
        spawns: Object.assign({}, W.spawns),
        constructionSites: Object.assign({}, W.sites),
        structures: {},
        gcl: { level: W.gcl, progress: 0, progressTotal: 1 },
        cpu: {
            limit: W.cpuLimit, bucket: W.bucket, tickLimit: 500,
            getUsed() { return Number(process.hrtime.bigint() - W.tickStart) / 1e6; },
            generatePixel() { if (W.bucket < 10000) return C.ERR_NOT_ENOUGH_RESOURCES; W.bucket -= 10000; W.pixels++; return C.OK; },
        },
        getObjectById(id) { return W.objects[id] || null; },
        map: {
            describeExits(name) {
                const room = W.rooms[name]; const out = {}; const w = worldXY(name);
                const edge = (dir, check) => { if (check()) out[dir] = roomNameFromWorld(w.x + (dir === 3 ? 1 : dir === 7 ? -1 : 0), w.y + (dir === 1 ? 1 : dir === 5 ? -1 : 0)); };
                if (!room) { out[1] = roomNameFromWorld(w.x, w.y + 1); out[3] = roomNameFromWorld(w.x + 1, w.y); out[5] = roomNameFromWorld(w.x, w.y - 1); out[7] = roomNameFromWorld(w.x - 1, w.y); return out; }
                edge(1, () => { for (let x = 0; x < 50; x++) if (room.terrain.get(x, 0) !== 1) return true; return false; });
                edge(5, () => { for (let x = 0; x < 50; x++) if (room.terrain.get(x, 49) !== 1) return true; return false; });
                edge(7, () => { for (let y = 0; y < 50; y++) if (room.terrain.get(0, y) !== 1) return true; return false; });
                edge(3, () => { for (let y = 0; y < 50; y++) if (room.terrain.get(49, y) !== 1) return true; return false; });
                return out;
            },
            findRoute(from, to, opts) {
                // BFS over room exits; unloaded rooms count as open plains.
                if (from === to) return [];
                const cb = opts && opts.routeCallback;
                const prev = { [from]: null }; const queue = [from];
                while (queue.length) {
                    const cur = queue.shift();
                    const exits = this.describeExits(cur);
                    for (const dir in exits) {
                        const n = exits[dir];
                        if (n in prev) continue;
                        if (cb && cb(n, cur) === Infinity) continue;
                        prev[n] = { room: cur, exit: +dir };
                        if (n === to) { const out = []; let x = n; while (prev[x]) { out.unshift({ exit: prev[x].exit, room: x }); x = prev[x].room; } return out; }
                        if (Object.keys(prev).length > 400) return C.ERR_NO_PATH;
                        queue.push(n);
                    }
                }
                return C.ERR_NO_PATH;
            },
            getRoomLinearDistance(a, b) { const p = worldXY(a), q = worldXY(b); return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)); },
            getRoomStatus() { return { status: 'normal', timestamp: null }; },
            getRoomTerrain(name) { return W.rooms[name] ? W.rooms[name].terrain : new Terrain('0'.repeat(2500)); },
        },
        market: { calcTransactionCost(amount, a, b) { const d = this_dist(a, b); return Math.ceil(amount * (1 - Math.exp(-d / 30))); } },
        notify(msg) { W.notifications.push(msg); },
        shard: { name: 'sim' },
    };
    function this_dist(a, b) { const p = worldXY(a), q = worldXY(b); return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)); }
}

function installGlobals() {
    for (const k in C) global[k] = C[k];
    global.RoomPosition = RoomPosition;
    global.PathFinder = PathFinder;
    global.Creep = Creep; global.Structure = Structure; global.Room = Room; global.Source = Source;
    global.StructureSpawn = Structure; global.ConstructionSite = ConstructionSite; global.Resource = Resource;
    global._ = undefined;
}

module.exports = { W, C, loadRoom, endTick, makeGame, installGlobals, RoomPosition, Room, Structure, Creep, Resource, PathFinder, blockingAt, spawnInvader, runInvaders, makeUnowned, makeLost };
