/**
 * Creep behaviours. Each role is a function (creep, memory) => void.
 * Shared pieces: energy acquisition with per-tick reservations, delivery with
 * target chaining, idling out of the way.
 */
const config = require('config');
const util = require('util');
const roomState = require('roomState');
const war = require('war');

const heap = util.heap;

const SITE_PRIORITY = {
    [STRUCTURE_SPAWN]: 10,
    [STRUCTURE_EXTENSION]: 8,
    [STRUCTURE_TOWER]: 9,
    [STRUCTURE_CONTAINER]: 7,
    [STRUCTURE_STORAGE]: 7,
    [STRUCTURE_LINK]: 6,
    [STRUCTURE_TERMINAL]: 5,
    [STRUCTURE_ROAD]: 3,
    [STRUCTURE_RAMPART]: 2,
    [STRUCTURE_WALL]: 1,
};

/* ------------------------------------------------------------------ */
/* Per-tick reservations so creeps do not all chase the same pile.     */
/* ------------------------------------------------------------------ */

function prepare() {
    heap.reserved = {};
    heap.fill = {};
    heap.harvesters = {};
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        const m = c.memory;
        if (!m.t || !m.tk) continue;
        if (m.tk === 'pickup' || m.tk === 'withdraw') {
            heap.reserved[m.t] = (heap.reserved[m.t] || 0) + c.store.getFreeCapacity(RESOURCE_ENERGY);
        } else if (m.tk === 'transfer') {
            heap.fill[m.t] = (heap.fill[m.t] || 0) + (c.store[RESOURCE_ENERGY] || 0);
        } else if (m.tk === 'harvest') {
            heap.harvesters[m.t] = (heap.harvesters[m.t] || 0) + 1;
        }
    }
}

function freeSpotsAround(source) {
    const rh = util.roomHeap(source.room.name);
    rh.spots = rh.spots || {};
    if (rh.spots[source.id] == null) {
        let n = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                if (!util.isWall(source.room.name, x, y)) n++;
            }
        }
        rh.spots[source.id] = n;
    }
    return rh.spots[source.id];
}

function homeState(creep) {
    const room = Game.rooms[creep.memory.home];
    if (!room || !room.controller || !room.controller.my) return null;
    return roomState.get(room);
}

function toggleWorking(creep, m) {
    if (m.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        m.working = false;
        delete m.t;
        delete m.tk;
        delete m.task;
        delete m.src;
    } else if (!m.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        m.working = true;
        delete m.t;
        delete m.tk;
    }
}

function nearSpawn(creep, st) {
    for (let i = 0; i < st.spawns.length; i++) {
        if (creep.pos.isNearTo(st.spawns[i])) return true;
    }
    return false;
}

/** Wait somewhere harmless: near the idle spot and never on a spawn exit. */
function idle(creep, st) {
    if (!st) return;
    util.markIdle(creep);
    if (nearSpawn(creep, st)) {
        util.travel(creep, st.idle, { range: 0 });
        return;
    }
    if (!creep.pos.inRangeTo(st.idle, 3)) util.travel(creep, st.idle, { range: 3 });
}

function recycle(creep) {
    const m = creep.memory;
    const room = Game.rooms[m.home] || creep.room;
    const spawn = room.find(FIND_MY_SPAWNS)[0] || creep.pos.findClosestByRange(FIND_MY_SPAWNS);
    if (!spawn) {
        creep.suicide();
        return;
    }
    if (creep.pos.isNearTo(spawn)) spawn.recycleCreep(creep);
    else util.travel(creep, spawn);
}

/* ------------------------------------------------------------------ */
/* Energy acquisition                                                  */
/* ------------------------------------------------------------------ */

function markBad(id) {
    heap.bad = heap.bad || {};
    heap.bad[id] = Game.time;
}

function isBad(id) {
    return !!(heap.bad && heap.bad[id] && Game.time - heap.bad[id] < 300);
}

/**
 * Travel helper that drops targets the creep cannot get to: no path, or no
 * progress for a while (an unreachable structure, a hopeless jam).
 */
function go(creep, m, target, opts) {
    const res = util.travel(creep, target, opts);
    const stuckFor = heap.stuck[creep.name] || 0;
    if (res === ERR_NO_PATH || (res !== ERR_TIRED && stuckFor >= 25)) {
        markBad(target.id || (target.pos && target.pos.x + ':' + target.pos.y));
        delete m.t;
        delete m.tk;
        heap.stuck[creep.name] = 0;
        return ERR_NO_PATH;
    }
    return res;
}

function sourceStillGood(tgt, kind) {
    if (!tgt) return false;
    if (kind === 'pickup') return tgt.amount > 0;
    if (kind === 'harvest') return tgt.energy > 0;
    return !!(tgt.store && (tgt.store[RESOURCE_ENERGY] || 0) > 0);
}

function pickEnergy(creep, st, opts) {
    const need = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    let best = null;
    let bestScore = -Infinity;
    const consider = (obj, amount, kind, bonus) => {
        if (isBad(obj.id)) return;
        const avail = amount - (heap.reserved[obj.id] || 0);
        if (avail < Math.min(need, 50)) return;
        const d = creep.pos.getRangeTo(obj);
        const score = Math.min(avail, need) + (bonus || 0) - d * 3;
        if (score > bestScore) {
            bestScore = score;
            best = { obj, kind, amount: avail };
        }
    };

    if (opts.dropped !== false) {
        for (let i = 0; i < st.dropped.length; i++) consider(st.dropped[i], st.dropped[i].amount, 'pickup', 20);
        for (let i = 0; i < st.tombstones.length; i++) consider(st.tombstones[i], (st.tombstones[i].store[RESOURCE_ENERGY] || 0), 'withdraw', 20);
        for (let i = 0; i < st.ruins.length; i++) consider(st.ruins[i], (st.ruins[i].store[RESOURCE_ENERGY] || 0), 'withdraw', 20);
    }
    if (opts.sourceContainers) {
        for (let i = 0; i < st.sources.length; i++) {
            const c = st.sources[i].container;
            if (c) consider(c, (c.store[RESOURCE_ENERGY] || 0), 'withdraw', 0);
        }
    }
    if (opts.ctrlContainer && st.ctrlContainer) consider(st.ctrlContainer, (st.ctrlContainer.store[RESOURCE_ENERGY] || 0), 'withdraw', 10);
    if (opts.storageLinkDrain && st.storageLink) consider(st.storageLink, (st.storageLink.store[RESOURCE_ENERGY] || 0), 'withdraw', 30);
    if (opts.storage && st.storage) consider(st.storage, (st.storage.store[RESOURCE_ENERGY] || 0), 'withdraw', -10);
    if (opts.terminal && st.terminal) consider(st.terminal, (st.terminal.store[RESOURCE_ENERGY] || 0) - config.terminal.keep, 'withdraw', -10);

    if (best) {
        heap.reserved[best.obj.id] = (heap.reserved[best.obj.id] || 0) + Math.min(need, best.amount);
        return best;
    }

    if (opts.harvest && util.countParts(creep, WORK) > 0) {
        let bestSrc = null;
        let bestD = Infinity;
        for (let i = 0; i < st.sources.length; i++) {
            const src = st.sources[i].source;
            if (src.energy === 0 || isBad(src.id)) continue;
            const queued = heap.harvesters[src.id] || 0;
            // Over-subscribe by one: the extra creep queues next to the source.
            if (queued > freeSpotsAround(src)) continue;
            const d = creep.pos.getRangeTo(src) + queued * 4;
            if (d < bestD) {
                bestD = d;
                bestSrc = src;
            }
        }
        if (bestSrc) {
            heap.harvesters[bestSrc.id] = (heap.harvesters[bestSrc.id] || 0) + 1;
            return { obj: bestSrc, kind: 'harvest', amount: bestSrc.energy };
        }
    }
    return null;
}

/** Acquire energy. Returns true when the creep is busy with it. */
function acquire(creep, st, opts) {
    const m = creep.memory;
    let tgt = m.t ? Game.getObjectById(m.t) : null;
    if (tgt && (m.tk === 'transfer' || !sourceStillGood(tgt, m.tk))) tgt = null;
    if (tgt && tgt.pos.roomName !== creep.room.name) tgt = null;
    if (!tgt) {
        const pick = pickEnergy(creep, st, opts);
        if (!pick) {
            delete m.t;
            delete m.tk;
            return false;
        }
        tgt = pick.obj;
        m.t = tgt.id;
        m.tk = pick.kind;
        m.src = tgt === st.storage ? 'storage' : undefined;
    }
    if (!creep.pos.isNearTo(tgt)) {
        if (m.tk === 'harvest') {
            // Queue at range 2 while every harvest spot is taken. Sources are
            // never marked unreachable: waiting for a spot is normal.
            const busy = tgt.pos.findInRange(FIND_MY_CREEPS, 1).length >= freeSpotsAround(tgt);
            util.travel(creep, tgt, { range: busy ? 2 : 1 });
        } else {
            go(creep, m, tgt);
        }
        return true;
    }
    let res;
    if (m.tk === 'pickup') res = creep.pickup(tgt);
    else if (m.tk === 'harvest') res = creep.harvest(tgt);
    else res = creep.withdraw(tgt, RESOURCE_ENERGY);
    if (m.tk !== 'harvest' || res !== OK) {
        delete m.t;
        delete m.tk;
    }
    return true;
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

function deliveryStillGood(tgt) {
    return !!(tgt && tgt.store && tgt.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
}

function closestWithRoom(creep, list, exclude) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s === exclude || isBad(s.id)) continue;
        if (s.store.getFreeCapacity(RESOURCE_ENERGY) - (heap.fill[s.id] || 0) <= 0) continue;
        const d = creep.pos.getRangeTo(s);
        if (d < bestD) {
            bestD = d;
            best = s;
        }
    }
    return best;
}

function pickDelivery(creep, st, opts, exclude) {
    let t = closestWithRoom(creep, st.refill, exclude);
    if (t) return t;
    t = closestWithRoom(creep, st.towersNeedy, exclude);
    if (t) return t;
    if (opts.only === 'refill') return null;

    const carrying = (creep.store[RESOURCE_ENERGY] || 0);
    if (st.ctrlContainer && st.ctrlContainer !== exclude && (st.count('upgrader') > 0 || opts.ctrl)) {
        const c = st.ctrlContainer;
        if (c.store.getFreeCapacity(RESOURCE_ENERGY) - (heap.fill[c.id] || 0) >= Math.min(carrying, 400)) return c;
    }
    if (opts.feedStorageLink && st.storageLink && st.storageLink !== exclude &&
        st.storageLink.store.getFreeCapacity(RESOURCE_ENERGY) - (heap.fill[st.storageLink.id] || 0) > 0) {
        return st.storageLink;
    }
    if (opts.storage !== false && st.storage && st.storage !== exclude && creep.memory.src !== 'storage' &&
        st.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return st.storage;
    }
    if (opts.terminal && st.terminal && st.terminal !== exclude &&
        (st.terminal.store[RESOURCE_ENERGY] || 0) < config.terminal.keep && st.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return st.terminal;
    }
    return null;
}

/** Deliver carried energy. Returns true when busy. */
function deliver(creep, st, opts) {
    const m = creep.memory;
    let tgt = m.t && m.tk === 'transfer' ? Game.getObjectById(m.t) : null;
    if (tgt && (!deliveryStillGood(tgt) || tgt.pos.roomName !== creep.room.name)) tgt = null;
    if (!tgt) {
        tgt = pickDelivery(creep, st, opts, null);
        if (!tgt) {
            delete m.t;
            delete m.tk;
            return false;
        }
        m.t = tgt.id;
        m.tk = 'transfer';
        heap.fill[tgt.id] = (heap.fill[tgt.id] || 0) + (creep.store[RESOURCE_ENERGY] || 0);
    }
    if (!creep.pos.isNearTo(tgt)) {
        go(creep, m, tgt);
        return true;
    }
    const res = creep.transfer(tgt, RESOURCE_ENERGY);
    delete m.t;
    delete m.tk;
    if (res === OK) {
        const given = Math.min((creep.store[RESOURCE_ENERGY] || 0), tgt.store.getFreeCapacity(RESOURCE_ENERGY));
        const left = (creep.store[RESOURCE_ENERGY] || 0) - given;
        if (left > 0) {
            // Chain the next target this tick so the creep keeps moving.
            const next = pickDelivery(creep, st, opts, tgt);
            if (next) {
                m.t = next.id;
                m.tk = 'transfer';
                heap.fill[next.id] = (heap.fill[next.id] || 0) + left;
                if (!creep.pos.isNearTo(next)) util.travel(creep, next);
            }
        }
    }
    return true;
}

/* ------------------------------------------------------------------ */
/* Work helpers                                                        */
/* ------------------------------------------------------------------ */

function upgrade(creep, st) {
    const ctrl = st.ctrl;
    if (!creep.pos.inRangeTo(ctrl, 3)) {
        util.travel(creep, ctrl, { range: 3 });
        return;
    }
    creep.upgradeController(ctrl);
    util.markIdle(creep);
    if ((!ctrl.sign || ctrl.sign.text !== config.signature) && creep.pos.isNearTo(ctrl)) {
        creep.signController(ctrl, config.signature);
    }
}

function pickSite(creep, st) {
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < st.sites.length; i++) {
        const s = st.sites[i];
        if (isBad(s.id)) continue;
        const score = (SITE_PRIORITY[s.structureType] || 4) * 100 - creep.pos.getRangeTo(s) + (s.progress > 0 ? 30 : 0);
        if (score > bestScore) {
            bestScore = score;
            best = s;
        }
    }
    return best;
}

function repairTargets(st) {
    const rh = util.roomHeap(st.name);
    if (rh.repair && Game.time - rh.repair.t < 10) return rh.repair.list;
    const list = [];
    const all = st.room.find(FIND_STRUCTURES);
    const rampartMin = config.planner.rampartTarget[st.rcl] || 0;
    for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (s.structureType === STRUCTURE_WALL) continue;
        if (s.structureType === STRUCTURE_RAMPART) {
            if (s.my && s.hits < Math.min(rampartMin, 20000)) list.push(s.id);
            continue;
        }
        if (s.hits < s.hitsMax * config.defense.repairBelow) list.push(s.id);
    }
    rh.repair = { t: Game.time, list };
    return list;
}

function repairObjects(st) {
    const ids = repairTargets(st);
    const out = [];
    for (let i = 0; i < ids.length; i++) {
        const s = Game.getObjectById(ids[i]);
        if (s && s.hits < s.hitsMax) out.push(s);
    }
    return out;
}

function doBuild(creep, st, m) {
    let site = m.t && m.tk === 'build' ? Game.getObjectById(m.t) : null;
    if (!site) {
        site = pickSite(creep, st);
        if (!site) return false;
        m.t = site.id;
        m.tk = 'build';
    }
    if (!creep.pos.inRangeTo(site, 3)) {
        if (go(creep, m, site, { range: 3 }) === ERR_NO_PATH) return false;
        return true;
    }
    creep.build(site);
    util.markIdle(creep);
    return true;
}

function doRepair(creep, st, m) {
    let s = m.t && m.tk === 'repair' ? Game.getObjectById(m.t) : null;
    if (s && s.hits >= s.hitsMax * 0.95) s = null;
    if (!s) {
        const list = repairObjects(st);
        s = list.length ? creep.pos.findClosestByRange(list) : null;
        if (!s) return false;
        m.t = s.id;
        m.tk = 'repair';
    }
    if (!creep.pos.inRangeTo(s, 3)) {
        if (go(creep, m, s, { range: 3 }) === ERR_NO_PATH) return false;
        return true;
    }
    creep.repair(s);
    util.markIdle(creep);
    return true;
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

function miner(creep, m) {
    const st = homeState(creep);
    if (!st) {
        recycle(creep);
        return;
    }
    let info = null;
    for (let i = 0; i < st.sources.length; i++) if (st.sources[i].id === m.sourceId) info = st.sources[i];
    if (!info) {
        // Take a source nobody mines.
        const miners = st.creeps.miner || [];
        for (let i = 0; i < st.sources.length && !info; i++) {
            let taken = false;
            for (let j = 0; j < miners.length; j++) {
                if (miners[j] !== creep && miners[j].memory.sourceId === st.sources[i].id) taken = true;
            }
            if (!taken) info = st.sources[i];
        }
        if (!info) {
            recycle(creep);
            return;
        }
        m.sourceId = info.id;
    }
    const src = info.source;
    if (creep.room.name !== st.name) {
        util.travel(creep, src);
        return;
    }
    if (info.container) {
        const spot = info.container.pos;
        if (!creep.pos.isEqualTo(spot)) {
            const occupied = creep.pos.isNearTo(spot) && spot.lookFor(LOOK_CREEPS).length > 0;
            if (!(occupied && creep.pos.isNearTo(src))) {
                util.travel(creep, spot, { range: 0 });
                if (!creep.pos.isNearTo(src)) return;
            }
        }
    } else if (!creep.pos.isNearTo(src)) {
        util.travel(creep, src);
        return;
    }

    const work = util.countParts(creep, WORK);
    // A stronger miner has taken over this source: give the spot back.
    const peers = st.creeps.miner || [];
    for (let i = 0; i < peers.length; i++) {
        const p = peers[i];
        if (p !== creep && !p.spawning && p.memory.sourceId === info.id && p.room.name === st.name &&
            util.countParts(p, WORK) > work) {
            recycle(creep);
            return;
        }
    }
    util.park(creep);
    if (info.container && info.container.hits < info.container.hitsMax * 0.5 && (creep.store[RESOURCE_ENERGY] || 0) >= work) {
        creep.repair(info.container);
        return;
    }
    if (src.energy > 0) creep.harvest(src);
    const carried = (creep.store[RESOURCE_ENERGY] || 0);
    if (carried > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) < work * 2) {
        if (info.link && info.link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) creep.transfer(info.link, RESOURCE_ENERGY);
        else if (info.container && !creep.pos.isEqualTo(info.container.pos) && info.container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            creep.transfer(info.container, RESOURCE_ENERGY);
        }
    }
}

function hauler(creep, m) {
    const st = homeState(creep);
    if (!st) {
        recycle(creep);
        return;
    }
    toggleWorking(creep, m);
    if (creep.room.name !== st.name) {
        util.travel(creep, st.idle, { range: 2 });
        return;
    }
    if (!m.working) {
        const keep = config.terminal.keep;
        const storageEnergy = st.storage ? (st.storage.store[RESOURCE_ENERGY] || 0) : 0;
        const demand = st.refill.length > 0 || st.towersNeedy.length > 0 ||
            (st.ctrlContainer && st.count('upgrader') > 0 && (st.ctrlContainer.store[RESOURCE_ENERGY] || 0) < 800) ||
            (st.storageLink && !st.sourceLinks.length && st.ctrlLink && (st.ctrlLink.store[RESOURCE_ENERGY] || 0) < 400) ||
            (st.terminal && (st.terminal.store[RESOURCE_ENERGY] || 0) < keep && storageEnergy > 100000);
        const opts = {
            dropped: true,
            sourceContainers: true,
            storageLinkDrain: !!(st.storageLink && st.sourceLinks.length),
            storage: !!(demand && st.storage && storageEnergy > 300),
            terminal: !!(st.terminal && (st.terminal.store[RESOURCE_ENERGY] || 0) > keep + 2000 && storageEnergy < 50000),
        };
        if (!acquire(creep, st, opts)) {
            if ((creep.store[RESOURCE_ENERGY] || 0) >= creep.store.getCapacity() * 0.25) m.working = true;
            else idle(creep, st);
        }
        return;
    }
    const opts = {
        feedStorageLink: !!(st.storageLink && !st.sourceLinks.length && st.ctrlLink && (st.ctrlLink.store[RESOURCE_ENERGY] || 0) < 400),
        terminal: !!(st.terminal && st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) > 100000),
    };
    if (!deliver(creep, st, opts)) idle(creep, st);
}

function upgradeSpot(creep, st, feed) {
    const m = creep.memory;
    if (m.spot) {
        const p = new RoomPosition(m.spot.x, m.spot.y, st.name);
        if (creep.pos.isEqualTo(p)) return p;
        const others = p.lookFor(LOOK_CREEPS);
        if (!others.length) return p;
    }
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            const x = feed.pos.x + dx;
            const y = feed.pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (util.isWall(st.name, x, y)) continue;
            const p = new RoomPosition(x, y, st.name);
            if (!p.inRangeTo(st.ctrl, 3)) continue;
            const structs = p.lookFor(LOOK_STRUCTURES);
            let blocked = false;
            for (let i = 0; i < structs.length; i++) if (util.isBlockingStructure(structs[i])) blocked = true;
            if (blocked) continue;
            const others = p.lookFor(LOOK_CREEPS);
            if (others.length && others[0] !== creep) continue;
            m.spot = { x, y };
            return p;
        }
    }
    return null;
}

function upgrader(creep, m) {
    const st = homeState(creep);
    if (!st) {
        recycle(creep);
        return;
    }
    const ctrl = st.ctrl;
    if (creep.room.name !== st.name) {
        util.travel(creep, ctrl, { range: 3 });
        return;
    }
    const feed = (st.ctrlLink && (st.ctrlLink.store[RESOURCE_ENERGY] || 0) > 0) ? st.ctrlLink
        : (st.ctrlContainer ? st.ctrlContainer : (st.ctrlLink || null));
    const carried = creep.store[RESOURCE_ENERGY] || 0;
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) m.fetching = false;

    // Parked next to a fed container/link: withdraw and upgrade in place.
    if (feed && !m.fetching && (carried > 0 || (feed.store[RESOURCE_ENERGY] || 0) > 0)) {
        const spot = upgradeSpot(creep, st, feed);
        if (spot && !creep.pos.isEqualTo(spot)) {
            util.travel(creep, spot, { range: 0 });
            if (!creep.pos.inRangeTo(ctrl, 3)) return;
        } else if (!spot && !creep.pos.isNearTo(feed)) {
            util.travel(creep, feed);
            return;
        }
        if (creep.pos.isNearTo(feed) && (feed.store[RESOURCE_ENERGY] || 0) > 0 && carried <= creep.store.getCapacity() / 2) {
            creep.withdraw(feed, RESOURCE_ENERGY);
        }
        if (carried > 0) upgrade(creep, st);
        return;
    }

    // No feed or a dry one: fetch energy ourselves, then come back.
    if (carried === 0) m.fetching = true;
    if (m.fetching) {
        const ok = acquire(creep, st, {
            dropped: true,
            sourceContainers: true,
            storage: !!(st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) > 500),
            harvest: st.count('miner') < st.sources.length,
        });
        if (!ok) {
            if (carried > 0) m.fetching = false;
            else idle(creep, st);
        }
        return;
    }
    upgrade(creep, st);
}

function haulable(st) {
    let n = 0;
    for (let i = 0; i < st.sources.length; i++) {
        if (st.sources[i].container) n += st.sources[i].container.store[RESOURCE_ENERGY] || 0;
    }
    for (let i = 0; i < st.dropped.length; i++) n += st.dropped[i].amount;
    if (st.storage) n += st.storage.store[RESOURCE_ENERGY] || 0;
    return n;
}

function chooseTask(creep, st) {
    const haulers = st.count('hauler');
    const rh = util.roomHeap(st.name);
    const needEnergy = rh.needEnergy || 0;
    if (st.downgrade && st.ctrl.ticksToDowngrade < 3000) return 'upgrade';
    // Keep the spawn fed for its next creep when no hauler can do it (none alive,
    // or nothing lying around for them to haul).
    if (st.refill.length && st.energy < Math.max(300, needEnergy) && (haulers === 0 || haulable(st) < 200)) return 'fill';
    if (st.downgrade) return 'upgrade';
    if (st.towersNeedy.length && haulers === 0 && st.danger) return 'fill';
    if (st.sites.length) return 'build';
    if (repairObjects(st).length) return 'repair';
    return 'upgrade';
}

function worker(creep, m) {
    let st = homeState(creep);
    if (!st) {
        const near = util.nearestOwnedRoom(creep.room.name, r => r.find(FIND_MY_SPAWNS).length > 0);
        if (!near) {
            creep.suicide();
            return;
        }
        m.home = near.name;
        st = roomState.get(near);
    }
    toggleWorking(creep, m);
    if (creep.room.name !== st.name) {
        util.travel(creep, st.anchor, { range: 4 });
        return;
    }
    if (!m.working) {
        const haulers = st.count('hauler');
        const ok = acquire(creep, st, {
            dropped: true,
            sourceContainers: true,
            storage: !!(st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) > (haulers ? 2000 : 300)),
            // Harvest only while sources lack miners: miners own the harvest spots.
            harvest: st.count('miner') < st.sources.length,
        });
        if (!ok) idle(creep, st);
        return;
    }
    if (!m.task || Game.time % 10 === 0) {
        const task = chooseTask(creep, st);
        if (task !== m.task) {
            m.task = task;
            delete m.t;
            delete m.tk;
        }
    }
    let busy = false;
    if (m.task === 'fill') busy = deliver(creep, st, { only: 'refill' });
    else if (m.task === 'build') busy = doBuild(creep, st, m);
    else if (m.task === 'repair') busy = doRepair(creep, st, m);
    if (!busy) {
        if (m.task !== 'upgrade') {
            m.task = 'upgrade';
            delete m.t;
            delete m.tk;
        }
        upgrade(creep, st);
    }
}

function courier(creep, m) {
    const recipient = Game.rooms[m.home];
    if (!recipient || !recipient.controller || !recipient.controller.my) {
        recycle(creep);
        return;
    }
    toggleWorking(creep, m);
    if (!m.working) {
        const donor = Game.rooms[m.from];
        const dst = donor && donor.controller && donor.controller.my ? roomState.get(donor) : null;
        if (!dst || !dst.storage || (dst.storage.store[RESOURCE_ENERGY] || 0) < config.courier.donorStopStorage) {
            m.role = 'hauler';
            return;
        }
        const stor = dst.storage;
        if (!creep.pos.isNearTo(stor)) {
            util.travel(creep, stor, { reusePath: 50 });
            return;
        }
        creep.withdraw(stor, RESOURCE_ENERGY);
        return;
    }
    const st = roomState.get(recipient);
    if (creep.room.name !== st.name) {
        util.travel(creep, st.anchor, { range: 4, reusePath: 50 });
        return;
    }
    if (!deliver(creep, st, { ctrl: true, storage: st.storageActive })) idle(creep, st);
}

function defender(creep, m) {
    const st = homeState(creep);
    if (!st) {
        recycle(creep);
        return;
    }
    if (creep.room.name !== st.name) {
        util.travel(creep, st.anchor, { range: 4 });
        return;
    }
    if (!st.hostiles.length) {
        if (creep.ticksToLive < 200) recycle(creep);
        else idle(creep, st);
        return;
    }
    let target = null;
    let bestD = Infinity;
    for (let i = 0; i < st.hostiles.length; i++) {
        const h = st.hostiles[i];
        const d = creep.pos.getRangeTo(h) - (util.hasParts(h, [HEAL]) ? 3 : 0);
        if (d < bestD) {
            bestD = d;
            target = h;
        }
    }
    if (creep.pos.isNearTo(target)) {
        creep.attack(target);
        if (util.countParts(creep, RANGED_ATTACK)) creep.rangedMassAttack();
    } else {
        if (util.countParts(creep, RANGED_ATTACK) && creep.pos.inRangeTo(target, 3)) creep.rangedAttack(target);
        util.travel(creep, target);
    }
}

function claimer(creep, m) {
    const target = m.targetRoom;
    if (!target || util.isAvoided(target)) {
        recycle(creep);
        return;
    }
    if (creep.room.name !== target) {
        util.travel(creep, util.roomCenter(target), { range: 20, reusePath: 50 });
        return;
    }
    const ctrl = creep.room.controller;
    if (!ctrl) {
        creep.suicide();
        return;
    }
    if (ctrl.my) {
        if (creep.pos.isNearTo(ctrl)) {
            if (!ctrl.sign || ctrl.sign.text !== config.signature) creep.signController(ctrl, config.signature);
            else creep.suicide();
        } else {
            util.travel(creep, ctrl);
        }
        return;
    }
    if (ctrl.owner) {
        util.warn(target + ' is owned by ' + ctrl.owner.username + '; dropping claim');
        if (Memory.empire && Memory.empire.claim && Memory.empire.claim.target === target) Memory.empire.claim = null;
        creep.suicide();
        return;
    }
    if (!creep.pos.isNearTo(ctrl)) {
        util.travel(creep, ctrl);
        return;
    }
    const res = creep.claimController(ctrl);
    if (res === OK) {
        util.log('Claimed ' + target);
        creep.signController(ctrl, config.signature);
        Game.notify('Claimed room ' + target);
    } else if (res === ERR_GCL_NOT_ENOUGH) {
        creep.reserveController(ctrl);
    } else if (res !== ERR_TIRED) {
        util.warn('claimController in ' + target + ' failed with ' + res);
    }
}

function scout(creep, m) {
    const queue = Memory.empire && Memory.empire.scoutQueue ? Memory.empire.scoutQueue : [];
    while (!m.targetRoom && queue.length) {
        const next = queue.shift();
        if (!util.isAvoided(next)) m.targetRoom = next;
    }
    if (m.targetRoom && util.isAvoided(m.targetRoom)) delete m.targetRoom;
    if (!m.targetRoom) {
        recycle(creep);
        return;
    }
    if (creep.room.name !== m.targetRoom) {
        util.travel(creep, util.roomCenter(m.targetRoom), { range: 20, reusePath: 50 });
        return;
    }
    // Arrived: intel is recorded by empire.observe(); move on.
    delete m.targetRoom;
    if (!queue.length) recycle(creep);
}


/* ------------------------------------------------------------------ */
/* War: soldiers (melee / ranged / healer)                             */
/* ------------------------------------------------------------------ */

const STRUCTURE_KILL_ORDER = {
    [STRUCTURE_TOWER]: 100,
    [STRUCTURE_SPAWN]: 90,
    [STRUCTURE_STORAGE]: 60,
    [STRUCTURE_TERMINAL]: 60,
    [STRUCTURE_EXTENSION]: 50,
    [STRUCTURE_LINK]: 40,
    [STRUCTURE_LAB]: 40,
    [STRUCTURE_RAMPART]: 5,
};

/** Ownerless structures razed after the hostile ones (config.war.razeAll); higher goes first. Walls are kept. */
const NEUTRAL_RAZE = {
    [STRUCTURE_CONTAINER]: 30,
    [STRUCTURE_ROAD]: 20,
};

/** Hostile ramparts in the room keyed by position (per-tick cache). */
function rampartMap(room) {
    return util.cache(room.name + '|rampartMap', () => {
        const out = {};
        const list = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART });
        for (let i = 0; i < list.length; i++) out[list[i].pos.x + ':' + list[i].pos.y] = list[i];
        return out;
    });
}

/** Is this object standing under a hostile rampart (attacks hit the rampart instead)? */
function covered(obj) {
    return !!rampartMap(obj.room)[obj.pos.x + ':' + obj.pos.y];
}

/** Can this creep or structure hurt us (or keep others alive)? */
function canResist(obj) {
    if (obj.structureType) return obj.structureType === STRUCTURE_TOWER && (obj.store[RESOURCE_ENERGY] || 0) >= 10;
    return util.hasParts(obj, [ATTACK, RANGED_ATTACK, HEAL]);
}

/**
 * What to hit among hostile creeps and towers: the closest thing that can
 * fight back wins, healers break ties, harmless creeps come after that.
 */
function pickHostileCreep(creep, hostiles) {
    const towers = util.find(creep.room, FIND_HOSTILE_STRUCTURES, 'towers', s => s.structureType === STRUCTURE_TOWER);
    const candidates = hostiles.concat(towers);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
        const h = candidates[i];
        // Anything under a rampart only soaks damage into millions of rampart hits: last resort.
        if (covered(h)) continue;
        let score = -creep.pos.getRangeTo(h) * 10;
        if (canResist(h)) score += 1000;
        if (!h.structureType && util.hasParts(h, [HEAL])) score += 15;
        score -= h.hits / 2000;
        if (score > bestScore) {
            bestScore = score;
            best = h;
        }
    }
    return best;
}

/** Hostile structure to hit: towers and spawns first, then the rest, closest wins ties. */
function pickHostileStructure(creep) {
    const list = util.find(creep.room, FIND_HOSTILE_STRUCTURES, 'killable',
        s => s.structureType !== STRUCTURE_CONTROLLER && s.hits != null && s.structureType !== STRUCTURE_RAMPART);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (covered(s)) continue;
        const score = (STRUCTURE_KILL_ORDER[s.structureType] || 20) * 100 - creep.pos.getRangeTo(s);
        if (score > bestScore) {
            bestScore = score;
            best = s;
        }
    }
    if (best) return best;
    // Only rampart-covered things remain: the whole squad focuses the weakest rampart.
    const ramparts = util.find(creep.room, FIND_HOSTILE_STRUCTURES, 'ramparts', s => s.structureType === STRUCTURE_RAMPART);
    if (ramparts.length) {
        return util.cache(creep.room.name + '|weakestRampart', () => {
            let weakest = ramparts[0];
            for (let i = 1; i < ramparts.length; i++) if (ramparts[i].hits < weakest.hits) weakest = ramparts[i];
            return weakest;
        });
    }
    if (!config.war.razeAll) return null;
    // Nothing owned is left: flatten the neutral leftovers, quick ones first, walls last.
    const neutral = util.find(creep.room, FIND_STRUCTURES, 'neutral', s => NEUTRAL_RAZE[s.structureType] && !s.my);
    best = null;
    bestScore = -Infinity;
    for (let i = 0; i < neutral.length; i++) {
        const s = neutral[i];
        const score = NEUTRAL_RAZE[s.structureType] * 100 - creep.pos.getRangeTo(s);
        if (score > bestScore) {
            bestScore = score;
            best = s;
        }
    }
    return best;
}

/**
 * Closest-first targeting: the nearest hostile creep or structure that is not
 * under a rampart (plus the neutral leftovers when razeAll is on). Soldiers
 * are short-lived, so time spent walking to a "better" target is wasted.
 */
function pickClosestTarget(creep, hostiles) {
    const candidates = [];
    for (let i = 0; i < hostiles.length; i++) if (!covered(hostiles[i])) candidates.push(hostiles[i]);
    const structs = util.find(creep.room, FIND_HOSTILE_STRUCTURES, 'killable',
        s => s.structureType !== STRUCTURE_CONTROLLER && s.hits != null && s.structureType !== STRUCTURE_RAMPART);
    for (let i = 0; i < structs.length; i++) if (!covered(structs[i])) candidates.push(structs[i]);
    if (config.war.razeAll) {
        const neutral = util.find(creep.room, FIND_STRUCTURES, 'neutral', s => NEUTRAL_RAZE[s.structureType] && !s.my);
        for (let i = 0; i < neutral.length; i++) if (!covered(neutral[i])) candidates.push(neutral[i]);
    }
    if (candidates.length) return creep.pos.findClosestByRange(candidates);
    return null;
}

/** Nothing reachable: chew through the nearest wall or rampart instead of standing still. */
function breachTarget(creep) {
    const walls = util.find(creep.room, FIND_STRUCTURES, 'walls',
        s => s.structureType === STRUCTURE_WALL || (s.structureType === STRUCTURE_RAMPART && !s.my));
    return walls.length ? creep.pos.findClosestByRange(walls) : null;
}

function engage(creep, target) {
    const melee = util.countParts(creep, ATTACK) > 0;
    const ranged = util.countParts(creep, RANGED_ATTACK) > 0;
    const range = creep.pos.getRangeTo(target);
    if (ranged) {
        if (range <= 1) creep.rangedMassAttack();
        else if (range <= 3) creep.rangedAttack(target);
    }
    if (melee && range <= 1) creep.attack(target);
    let res = OK;
    if (melee || range > 3) {
        if (range > 1 || melee) res = util.travel(creep, target, { range: melee ? 1 : 3, reusePath: 5 });
    } else if (ranged && range < 3 && !target.structureType && target.getActiveBodyparts(ATTACK)) {
        // Keep melee creeps at arm's length.
        const dir = util.stepAwayFrom(creep, target.pos);
        if (dir) creep.move(dir);
    }
    if (res === ERR_NO_PATH) {
        const wall = breachTarget(creep);
        if (wall) {
            if (creep.pos.isNearTo(wall)) {
                if (melee) creep.attack(wall);
                if (ranged) creep.rangedAttack(wall);
            } else util.travel(creep, wall, { range: 1, reusePath: 5 });
        }
    }
}

function healAround(creep) {
    const hurt = util.find(creep.room, FIND_MY_CREEPS, 'hurt', c => c.hits < c.hitsMax);
    if (!hurt.length) return false;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < hurt.length; i++) {
        const c = hurt[i];
        const range = creep.pos.getRangeTo(c);
        if (range > 3) continue;
        const score = c.hits / c.hitsMax + range * 0.1;
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    if (!best) return false;
    if (creep.pos.isNearTo(best)) creep.heal(best);
    else creep.rangedHeal(best);
    return true;
}

/** Healers shadow the most damaged fighter nearby, or the closest one. */
function healerFollow(creep, fallbackPos) {
    const fighters = util.find(creep.room, FIND_MY_CREEPS, 'fighters',
        c => c.memory.role === 'soldier' && c.memory.kind !== 'healer');
    if (!fighters.length) {
        if (fallbackPos) util.travel(creep, fallbackPos, { range: 3 });
        return;
    }
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < fighters.length; i++) {
        const c = fighters[i];
        const score = c.hits / c.hitsMax * 10 + creep.pos.getRangeTo(c) * 0.5;
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    util.travel(creep, best, { range: 1, reusePath: 3 });
}

function soldier(creep, m) {
    const w = war.state();
    const healer = m.kind === 'healer';
    if (healer) healAround(creep);

    // No war, or muster switched off and no target: go home and recycle.
    if (!w || (!w.muster && !w.target)) {
        recycle(creep);
        return;
    }

    // Target set: gather at the rally room, then march in and clear it.
    if (w.target) {
        const inTarget = creep.room.name === w.target;
        if (war.safeModeActive(w)) {
            // Nothing can be hit while the target is in safe mode: pull back and wait.
            creep.say('⏳', true);
            const rally = war.rallyPos(w);
            if (rally) {
                util.markIdle(creep);
                if (!creep.pos.inRangeTo(rally, 6) || creep.pos.roomName !== rally.roomName) {
                    util.travel(creep, rally, { range: 5, reusePath: 50, avoidRoom: w.target });
                }
                return;
            }
            if (inTarget) {
                util.travel(creep, util.roomCenter(w.target), { range: 6 });
                return;
            }
        } else if (w.go || inTarget) creep.say('💀', true);
        if (inTarget && !war.safeModeActive(w)) {
            const hostiles = util.find(creep.room, FIND_HOSTILE_CREEPS);
            if (healer) {
                healerFollow(creep, war.rallyPos(w));
                return;
            }
            const target = config.war.closestFirst
                ? (pickClosestTarget(creep, hostiles) || pickHostileStructure(creep))
                : (pickHostileCreep(creep, hostiles) || pickHostileStructure(creep));
            if (target) engage(creep, target);
            else {
                // Cleared: hold the room near its centre, out of the exits.
                util.markIdle(creep);
                util.travel(creep, util.roomCenter(w.target), { range: 6 });
            }
            return;
        }
        if (w.go) {
            if (healer) {
                // Travel with the pack: stick to a fighter heading the same way if one is near.
                const near = creep.pos.findInRange(FIND_MY_CREEPS, 3, { filter: c => c.memory.role === 'soldier' && c.memory.kind !== 'healer' });
                if (near.length && creep.pos.roomName !== w.target) {
                    util.travel(creep, near[0], { range: 1, reusePath: 3 });
                    return;
                }
            }
            util.travel(creep, util.roomCenter(w.target), { range: 20, reusePath: 50 });
            return;
        }
        const rally = war.rallyPos(w);
        if (rally) {
            util.markIdle(creep);
            if (!creep.pos.inRangeTo(rally, 6) || creep.pos.roomName !== rally.roomName) {
                // Never cut through the target on the way to the rally point.
                util.travel(creep, rally, { range: 5, reusePath: 50, avoidRoom: w.target });
            }
            return;
        }
        // No rally room known yet: wait at home.
    }

    // Mustering at home: defend it if attacked, otherwise stay out of the way.
    const st = homeState(creep);
    if (!st) {
        recycle(creep);
        return;
    }
    if (creep.room.name !== st.name) {
        util.travel(creep, st.anchor, { range: 4, reusePath: 50 });
        return;
    }
    if (st.hostiles.length) {
        if (healer) healerFollow(creep, st.idle);
        else engage(creep, pickHostileCreep(creep, st.hostiles));
        return;
    }
    idle(creep, st);
}

const ROLES = { miner, hauler, upgrader, worker, courier, defender, claimer, scout, soldier };

function run(creep) {
    if (creep.spawning) return;
    const m = creep.memory;
    const fn = ROLES[m.role];
    if (!fn) {
        recycle(creep);
        return;
    }
    fn(creep, m);
}

module.exports = { run, prepare, ROLES };
