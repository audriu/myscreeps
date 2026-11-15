/**
 * Remote mining: sources in the unowned rooms next to ours.
 *
 * Every empire pass (20 ticks) at most one new room is taken on: a neighbour
 * of an owned room with sources, a free controller and no towers, picked from
 * intel (a 1-MOVE scout fetches it when missing). The home room then keeps a
 * miner on each source, haulers sized by the walking distance, a reserver
 * (CLAIM) that doubles the sources' output, and guards against invaders and
 * invader cores. Everything is kept in Memory.empire.remotes.
 *
 * Creep behaviour lives in roles.js (remoteMiner, remoteHauler, reserver,
 * guard); spawning goes through Memory.empire.wants like every cross-room
 * request.
 */
const config = require('config');
const util = require('util');
const roomState = require('roomState');

const CFG = config.remote;
const INVADER = 'Invader';
const ARMED = [ATTACK, RANGED_ATTACK];

function all() {
    const e = Memory.empire || (Memory.empire = {});
    return e.remotes || (e.remotes = {});
}

/** Memory of one remote room, or null when the room is not (or no longer) mined. */
function get(name) {
    const e = Memory.empire;
    return (e && e.remotes && e.remotes[name]) || null;
}

function drop(name, why, skip) {
    const e = Memory.empire;
    const r = e.remotes[name];
    delete e.remotes[name];
    e.remoteSkip = e.remoteSkip || {};
    if (skip) e.remoteSkip[name] = Game.time + skip;
    util.warn('Remote ' + name + (r ? ' (from ' + r.home + ')' : '') + ' given up: ' + why);
}

/* ------------------------------------------------------------------ */
/* Every tick: what our creeps see in the remote rooms                  */
/* ------------------------------------------------------------------ */

function watch(name, r, room) {
    // Armed creeps of anyone else: ours leave until they are gone.
    const hostiles = util.find(room, FIND_HOSTILE_CREEPS);
    let threat = null;
    for (let i = 0; i < hostiles.length; i++) {
        const h = hostiles[i];
        if (!util.hasParts(h, ARMED)) continue;
        if (!threat) threat = { n: 0, parts: 0, npc: true, ttl: 0 };
        threat.n++;
        threat.parts += util.countParts(h, ATTACK) + util.countParts(h, RANGED_ATTACK) + util.countParts(h, HEAL);
        if (!h.owner || h.owner.username !== INVADER) threat.npc = false;
        threat.ttl = Math.max(threat.ttl, h.ticksToLive || 0);
    }
    if (threat) {
        if (!(r.unsafe > Game.time)) {
            r.raids = (r.raids || 0) + 1;
            r.raidAt = Game.time;
            util.warn('Remote ' + name + ': ' + threat.n + ' armed ' + (threat.npc ? 'invader(s)' : 'creep(s) of ' + hostiles[0].owner.username) +
                ', ' + threat.parts + ' parts; ' + r.home + ' pulls its creeps out');
        }
        r.threat = threat;
        // Invaders die of old age; a player's squad is checked on again after a while.
        r.unsafe = Game.time + (threat.npc ? Math.min(CREEP_LIFE_TIME, threat.ttl + 5) : CFG.playerPause);
    } else if (r.threat || r.unsafe) {
        delete r.threat;
        delete r.unsafe;
        util.log('Remote ' + name + ' is clear again');
    }
    if (Game.time % 10 !== 0) return;
    const ctrl = room.controller;
    const res = ctrl && ctrl.reservation;
    const me = util.myName();
    r.res = res && res.username === me ? Game.time + res.ticksToEnd : 0;
    // Somebody else's reservation: the engine refuses our harvest until it is gone.
    r.resBy = res && res.username !== me ? res.username : null;
    r.resEnd = r.resBy ? Game.time + res.ticksToEnd : 0;
    const cores = util.find(room, FIND_HOSTILE_STRUCTURES, 'core', s => s.structureType === STRUCTURE_INVADER_CORE);
    r.core = cores.length ? Game.time : 0;
    if (ctrl && ctrl.owner && !ctrl.my) r.owner = ctrl.owner.username;
    else delete r.owner;
}

function run() {
    const e = Memory.empire;
    if (!e || !e.remotes) return;
    for (const name in e.remotes) {
        const room = Game.rooms[name];
        if (room) watch(name, e.remotes[name], room);
    }
}

/* ------------------------------------------------------------------ */
/* Picking rooms                                                        */
/* ------------------------------------------------------------------ */

/** Share of its spawn time a room already spends on the creeps it keeps alive. */
function spawnLoad(st) {
    let ticks = 0;
    for (const role in st.creeps) {
        const list = st.creeps[role];
        for (let i = 0; i < list.length; i++) {
            const c = list[i];
            ticks += c.body.length * CREEP_SPAWN_TIME / (util.countParts(c, CLAIM) ? CREEP_CLAIM_LIFE_TIME : CREEP_LIFE_TIME);
        }
    }
    return ticks / Math.max(1, st.activeSpawns.length);
}

/** A home has to run its own economy before it takes on (another) remote. */
function eligibleHome(st) {
    return st.rcl >= CFG.minRcl && st.activeSpawns.length > 0 && !!st.storage && !st.bootstrap && !st.danger &&
        !st.downgrade && st.count('miner') >= st.sources.length && st.count('hauler') > 0;
}

function reservePairs(st) {
    if (!CFG.reserve) return 0;
    const pairs = Math.min(CFG.reserveClaims, Math.floor(st.cap / (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])));
    // One CLAIM only holds the timer where it is: not worth a creep.
    return pairs >= 2 ? pairs : 0;
}

/** Walking distance from the home storage to each source: d tiles, c ticks for a loaded hauler. */
function measure(st, name, intel) {
    const out = [];
    for (let i = 0; i < intel.src.length; i++) {
        const s = intel.src[i];
        const res = PathFinder.search(st.storage.pos, { pos: new RoomPosition(s.x, s.y, name), range: 1 }, {
            plainCost: 2,
            swampCost: 10,
            maxRooms: 2,
            maxOps: 8000,
            roomCallback: rn => (rn === st.name || rn === name ? util.routeMatrix(rn) : false),
        });
        if (res.incomplete || !res.path.length || res.path.length > CFG.maxDist) continue;
        out.push({ id: s.id, x: s.x, y: s.y, d: res.path.length, c: Math.ceil(res.cost / 2) });
    }
    return out;
}

/** CARRY parts that keep up with these sources at `rate` energy per tick each. */
function carryNeeded(src, rate) {
    let need = 0;
    for (let i = 0; i < src.length; i++) need += (src[i].c + src[i].d) * rate / CARRY_CAPACITY;
    return Math.ceil(need * 1.25) + 1;
}

function wantScout(wants, e, home, name) {
    e.remoteScout = e.remoteScout || {};
    const at = e.remoteScout[name];
    if (!at) e.remoteScout[name] = Game.time;
    else if (Game.time - at > 600) {
        // No word after 600 ticks (the scout died, or cannot get there): leave the room alone for a while.
        delete e.remoteScout[name];
        e.remoteSkip[name] = Game.time + 5000;
        return;
    }
    wants.push({ role: 'scout', spawnIn: home, home, count: 1, priority: 110, memory: { targetRoom: name } });
}

function adopt(wants, states, perHome, busy, record) {
    const e = Memory.empire;
    const remotes = e.remotes;
    const me = util.myName();
    const skip = e.remoteSkip || (e.remoteSkip = {});
    const scoutFor = {};
    let best = null;
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        if (!eligibleHome(st) || busy[st.name]) continue;
        if ((perHome[st.name] || 0) >= CFG.perRoom + (st.activeSpawns.length > 1 ? 1 : 0)) continue;
        const exits = util.exitRooms(st.name);
        for (let j = 0; j < exits.length; j++) {
            const name = exits[j];
            if (remotes[name] || util.isOwned(name) || util.isAvoided(name) || util.isHighway(name) || util.isKeeperRoom(name)) continue;
            if (skip[name] > Game.time) continue;
            if (Game.rooms[name]) record(Game.rooms[name], true);
            const intel = e.intel[name];
            // Somebody's base (seen at any time): no scout needs to die there to confirm it.
            if (intel && intel.owner && Game.time - intel.t < 100000) {
                skip[name] = Game.time + 20000;
                continue;
            }
            if (!intel || !intel.src || Game.time - intel.t > CFG.intelTtl) {
                if (!scoutFor[st.name]) scoutFor[st.name] = name;
                continue;
            }
            delete (e.remoteScout || {})[name];
            if (!intel.ctrl || !intel.sources || intel.owner || (intel.towers || 0) > (intel.core ? 1 : 0)) {
                skip[name] = Game.time + 20000;
                continue;
            }
            if ((intel.reserved && intel.reserved !== me && intel.reserved !== INVADER) || intel.armed) {
                skip[name] = Game.time + 3000;
                continue;
            }
            // Free rooms first; a room held by an invader core has to be cleared before it pays.
            const score = intel.sources * 100 - (intel.reserved === INVADER || intel.core ? 60 : 0) -
                (perHome[st.name] || 0) * 30 + st.rcl;
            if (!best || score > best.score) best = { score, name, st, intel };
        }
    }
    for (const home in scoutFor) wantScout(wants, e, home, scoutFor[home]);
    if (!best) return;

    const st = best.st;
    const name = best.name;
    const src = measure(st, name, best.intel);
    if (!src.length) {
        skip[name] = Game.time + 20000;
        util.log('Remote ' + name + ': no source within ' + CFG.maxDist + ' tiles of ' + st.name + '; skipped');
        return;
    }
    // Spawn time: a miner per source, the haulers, the reserver.
    const pairs = reservePairs(st);
    const parts = src.length * 12 + carryNeeded(src, pairs ? 10 : 5) * 2;
    const extra = (parts * CREEP_SPAWN_TIME / CREEP_LIFE_TIME + pairs * 2 * CREEP_SPAWN_TIME / CREEP_CLAIM_LIFE_TIME) / st.activeSpawns.length;
    const load = spawnLoad(st);
    if (load + extra > CFG.maxSpawnLoad) {
        skip[name] = Game.time + 2000;
        return;
    }
    const r = remotes[name] = { home: st.name, t: Game.time, src };
    if (best.intel.cx != null) {
        r.cx = best.intel.cx;
        r.cy = best.intel.cy;
    }
    if (best.intel.core) r.core = Game.time;
    if (best.intel.reserved && best.intel.reserved !== me) {
        r.resBy = best.intel.reserved;
        r.resEnd = best.intel.t + (best.intel.resTicks || 0);
    }
    util.log('Remote ' + name + ' taken on by ' + st.name + ': ' + src.length + ' source(s) at ' + src.map(s => s.d).join('/') +
        ' tiles, spawn load ' + load.toFixed(2) + ' + ' + extra.toFixed(2) + (r.core ? ', invader core to clear first' : ''));
}

/* ------------------------------------------------------------------ */
/* Spawn requests                                                       */
/* ------------------------------------------------------------------ */

function addWants(wants, name, r, st) {
    const index = roomState.creepIndex().byHome[r.home] || {};
    const unsafe = r.unsafe > Game.time;
    const want = (role, count, priority, memory, match, extra) => wants.push(Object.assign({
        role, spawnIn: r.home, home: r.home, count, priority, memory, match, minBucket: CFG.pauseBucket,
    }, extra || {}));

    // Guards: invaders we can beat, or a core to knock down (it does not fight back).
    const beatable = unsafe && r.threat && r.threat.npc && r.threat.parts <= CFG.guardMaxParts;
    if (beatable || r.core) {
        want('guard', beatable && r.threat.n > 2 ? 2 : 1, 560, { remote: name }, { remote: name }, { lead: 50 });
    }
    if (unsafe) return;

    const blocked = !!r.resBy;
    if (!blocked) {
        for (let i = 0; i < r.src.length; i++) {
            const s = r.src[i];
            // The replacement leaves early enough to arrive as the old miner dies.
            want('remoteMiner', 1, 540, { remote: name, sourceId: s.id }, { sourceId: s.id }, { lead: Math.ceil(s.c * 1.4) + 60, energyCap: 900 });
        }
        const miners = (index.remoteMiner || []).filter(c => c.memory.remote === name);
        if (miners.length) {
            const pairs = reservePairs(st);
            const need = carryNeeded(r.src, pairs || r.res > Game.time ? 10 : 5);
            const maxPer = Math.min(25, Math.floor(st.cap / 100));
            const count = Math.ceil(need / maxPer);
            want('remoteHauler', count, 530, { remote: name }, { remote: name },
                { lead: 120, energyCap: Math.ceil(need / count) * 100, bodyKey: 'courier' });
        }
    }
    // Reserver: tops our reservation up, or wears somebody else's (an invader core's) down.
    const pairs = reservePairs(st);
    if (pairs && !r.core && r.cx != null && (blocked || (r.res || 0) - Game.time < CFG.reserveBelow)) {
        want('reserver', 1, 520, { remote: name }, { remote: name }, { lead: 50, energyCap: pairs * 650 });
    }
}

/**
 * Empire pass: drop remotes that stopped making sense, take on at most one
 * new room, and ask the homes for the creeps each remote needs.
 * record(room, force) stores intel for a visible room (empire.record).
 */
function plan(wants, states, record) {
    const e = Memory.empire;
    const remotes = all();
    if (!CFG.enabled) {
        for (const name in remotes) drop(name, 'remote mining is switched off');
        return;
    }
    const me = util.myName();
    const byName = {};
    for (let i = 0; i < states.length; i++) byName[states[i].name] = states[i];
    const perHome = {};
    const busy = {};
    for (const name in remotes) {
        const r = remotes[name];
        const st = byName[r.home];
        if (r.raids && Game.time - (r.raidAt || 0) > CFG.raidWindow) r.raids = 0;
        // A reservation seen long ago has run out by now.
        if (r.resBy && r.resEnd && Game.time > r.resEnd && !Game.rooms[name]) r.resBy = null;
        let why = null;
        if (!st || !st.activeSpawns.length || st.rcl < CFG.minRcl) why = 'home ' + r.home + ' cannot support it';
        else if (util.isOwned(name)) why = 'the room is ours now';
        else if (util.isAvoided(name)) why = 'the room is on the avoid list';
        else if (r.owner) why = 'claimed by ' + r.owner;
        else if (r.resBy && r.resBy !== INVADER && r.resBy !== me) why = 'reserved by ' + r.resBy;
        else if ((r.raids || 0) >= CFG.maxRaids) why = r.raids + ' raids within ' + CFG.raidWindow + ' ticks';
        if (why) {
            drop(name, why, 20000);
            continue;
        }
        perHome[r.home] = (perHome[r.home] || 0) + 1;
        // One at a time: the last one has to be staffed before the next is added.
        if (Game.time - r.t < 600) busy[r.home] = true;
    }
    const war = Memory.war && Memory.war.muster;
    if (!war && Game.cpu.bucket >= CFG.minBucket) adopt(wants, states, perHome, busy, record);
    for (const name in remotes) addWants(wants, name, remotes[name], byName[remotes[name].home]);
}

/** WORK parts of upgrading the remote income of a home pays for (4 per source, 8 once reserved). */
function income(homeName) {
    return util.cache('remoteIncome|' + homeName, () => {
        const list = (roomState.creepIndex().byHome[homeName] || {}).remoteMiner || [];
        let w = 0;
        for (let i = 0; i < list.length; i++) {
            const c = list[i];
            const r = get(c.memory.remote);
            if (c.spawning || !r || r.unsafe > Game.time || r.resBy) continue;
            w += r.res > Game.time ? 8 : 4;
        }
        return w;
    });
}

/**
 * What a hauler needs to know about a remote room, shaped like the room state
 * of an owned room so the shared energy pick-up code works there too.
 */
function view(room) {
    return util.cache('remoteView|' + room.name, () => {
        const boxes = util.find(room, FIND_STRUCTURES, 'box', s => s.structureType === STRUCTURE_CONTAINER);
        const sources = util.find(room, FIND_SOURCES).map(s => {
            let container = null;
            for (let i = 0; i < boxes.length; i++) if (boxes[i].pos.isNearTo(s)) container = boxes[i];
            return { id: s.id, source: s, pos: s.pos, container };
        });
        return {
            name: room.name,
            sources,
            dropped: util.find(room, FIND_DROPPED_RESOURCES, 'e', r => r.resourceType === RESOURCE_ENERGY && r.amount >= 30),
            tombstones: util.find(room, FIND_TOMBSTONES, 'e', t => (t.store[RESOURCE_ENERGY] || 0) > 0),
            ruins: util.find(room, FIND_RUINS, 'e', x => (x.store[RESOURCE_ENERGY] || 0) > 0),
            lootEnergy: [],
            links: [],
            storage: null,
            terminal: null,
            storageLink: null,
            ctrlContainer: null,
        };
    });
}

/** Remote rooms being mined right now (for the console summary). */
function count() {
    const e = Memory.empire;
    return e && e.remotes ? Object.keys(e.remotes).length : 0;
}

module.exports = { get, run, plan, income, view, count, spawnLoad };
