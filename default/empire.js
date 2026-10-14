/**
 * Cross-room decisions: helpers for spawnless rooms, couriers from rich rooms
 * into weak ones, scouting, and carefully gated claiming.
 */
const config = require('config');
const util = require('util');
const roomState = require('roomState');

function ensure() {
    if (!Memory.empire) Memory.empire = {};
    const e = Memory.empire;
    if (!e.wants) e.wants = [];
    if (!e.scoutQueue) e.scoutQueue = [];
    if (!e.intel) e.intel = {};
    if (!e.blacklist) e.blacklist = {};
    return e;
}

/** Record intel for visible rooms that are not ours. */
function observe() {
    const e = ensure();
    for (const name in Game.rooms) {
        const room = Game.rooms[name];
        if (room.controller && room.controller.my) continue;
        const prev = e.intel[name];
        if (prev && Game.time - prev.t < 200) continue;
        const ctrl = room.controller;
        const towers = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_INVADER_CORE }).length;
        e.intel[name] = {
            t: Game.time,
            sources: room.find(FIND_SOURCES).length,
            ctrl: !!ctrl,
            owner: ctrl && ctrl.owner ? ctrl.owner.username : null,
            reserved: ctrl && ctrl.reservation ? ctrl.reservation.username : null,
            level: ctrl ? ctrl.level : 0,
            towers,
            keeper: room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_KEEPER_LAIR }).length > 0,
        };
    }
}

function spawnRooms() {
    return util.ownedRooms().filter(r => roomState.get(r).activeSpawns.length > 0);
}

function addWant(wants, w) {
    wants.push(w);
}

/** Owned rooms without a spawn get workers from the nearest healthy room. */
function planHelpers(wants, states) {
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        if (st.spawns.length || st.hostiles.length) continue;
        const from = util.nearestOwnedRoom(st.name, r => {
            const s = roomState.get(r);
            return s.activeSpawns.length > 0 && s.rcl >= 4 && util.roomDistance(r.name, st.name) <= 3;
        });
        if (!from) continue;
        addWant(wants, {
            role: 'worker',
            spawnIn: from.name,
            home: st.name,
            count: config.expansion.helpers,
            priority: 300,
            energyCap: 1500,
        });
    }
}

/** Rich storages feed weak neighbours through long-distance haulers. */
function planCouriers(wants, states) {
    const cfg = config.courier;
    const donors = states.filter(s => s.storage && (s.storage.store[RESOURCE_ENERGY] || 0) >= cfg.donorMinStorage && s.activeSpawns.length);
    if (!donors.length) return;
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        if (!st.spawns.length || st.hostiles.length) continue;
        const storageEnergy = st.storage ? (st.storage.store[RESOURCE_ENERGY] || 0) : 0;
        if (storageEnergy >= cfg.recipientMaxStorage) continue;
        if (st.rcl >= 7) continue;
        let best = null;
        let bestDist = Infinity;
        for (let j = 0; j < donors.length; j++) {
            const d = donors[j];
            if (d.name === st.name) continue;
            const dist = util.roomDistance(d.name, st.name);
            if (dist > cfg.maxLinearDistance) continue;
            if (dist < bestDist) {
                bestDist = dist;
                best = d;
            }
        }
        if (!best) continue;
        addWant(wants, {
            role: 'courier',
            spawnIn: best.name,
            home: st.name,
            count: cfg.perRecipient,
            priority: 350,
            memory: { from: best.name },
        });
    }
}

function roomStatusOk(name) {
    if (util.isHighway(name) || util.isKeeperRoom(name)) return false;
    const status = Game.map.getRoomStatus ? Game.map.getRoomStatus(name) : null;
    if (status && status.status !== 'normal') return false;
    return true;
}

function planExpansion(wants, states) {
    const e = ensure();
    const cfg = config.expansion;
    if (!cfg.enabled) {
        e.claim = null;
        return;
    }
    const owned = util.ownedRooms();
    if (Game.gcl.level <= owned.length) {
        e.claim = null;
        return;
    }
    for (let i = 0; i < states.length; i++) {
        if (states[i].rcl < cfg.allRoomsMinRcl || !states[i].spawns.length) {
            e.claim = null;
            return;
        }
    }
    if (Game.cpu.bucket < cfg.minBucket) return;

    const funders = states.filter(s => s.activeSpawns.length && s.rcl >= cfg.funderMinRcl &&
        s.storage && (s.storage.store[RESOURCE_ENERGY] || 0) >= cfg.funderMinStorage && !s.hostiles.length);
    if (!funders.length) return;

    // Keep an existing claim alive.
    if (e.claim) {
        const c = e.claim;
        if (Game.time - c.t > cfg.claimTimeout) {
            util.warn('Claim of ' + c.target + ' timed out');
            e.blacklist[c.target] = Game.time;
            e.claim = null;
        } else if (util.isOwned(c.target)) {
            util.log('Expansion ' + c.target + ' claimed; helpers will build the spawn');
            e.claim = null;
        } else {
            addWant(wants, {
                role: 'claimer',
                spawnIn: c.from,
                home: c.from,
                count: 1,
                priority: 320,
                memory: { targetRoom: c.target },
                match: { targetRoom: c.target },
            });
            return;
        }
    }

    // Candidate rooms: exits of funders (and their exits), not owned, not bad.
    const candidates = {};
    for (let i = 0; i < funders.length; i++) {
        const first = util.exitRooms(funders[i].name);
        for (let a = 0; a < first.length; a++) {
            candidates[first[a]] = funders[i].name;
            if (cfg.maxLinearDistance >= 2) {
                const second = util.exitRooms(first[a]);
                for (let b = 0; b < second.length; b++) if (!candidates[second[b]]) candidates[second[b]] = funders[i].name;
            }
        }
    }
    const scored = [];
    const needScout = [];
    for (const name in candidates) {
        if (util.isOwned(name)) continue;
        if (e.blacklist[name] && Game.time - e.blacklist[name] < 20000) continue;
        if (!roomStatusOk(name)) continue;
        const intel = e.intel[name];
        if (!intel || Game.time - intel.t > 30000) {
            needScout.push(name);
            continue;
        }
        if (!intel.ctrl || intel.owner || intel.keeper || intel.towers) continue;
        if (intel.reserved) continue;
        if (intel.sources < 2) continue;
        const dist = util.roomDistance(candidates[name], name);
        let adjacentOwned = 0;
        const exits = util.exitRooms(name);
        for (let i = 0; i < exits.length; i++) if (util.isOwned(exits[i])) adjacentOwned++;
        scored.push({ name, from: candidates[name], score: intel.sources * 100 - dist * 50 + adjacentOwned * 20 });
    }

    if (needScout.length) {
        e.scoutAt = e.scoutAt || {};
        let queued = 0;
        for (let i = 0; i < needScout.length; i++) {
            const name = needScout[i];
            // One attempt per room per 5000 ticks: unreachable rooms must not eat scouts forever.
            if (e.scoutAt[name] && Game.time - e.scoutAt[name] < 5000) continue;
            if (e.scoutQueue.indexOf(name) === -1 && e.scoutQueue.length < 12) {
                e.scoutQueue.push(name);
                e.scoutAt[name] = Game.time;
            }
            queued++;
        }
        if (queued || e.scoutQueue.length) {
            addWant(wants, {
                role: 'scout',
                spawnIn: funders[0].name,
                home: funders[0].name,
                count: 1,
                priority: 100,
            });
        }
    }
    if (!scored.length) return;
    scored.sort((a, b) => b.score - a.score);
    e.claim = { target: scored[0].name, from: scored[0].from, t: Game.time };
    util.log('Expansion target: ' + scored[0].name + ' (from ' + scored[0].from + ')');
}

function run() {
    const e = ensure();
    if (Game.cpu.bucket < config.cpu.empireMinBucket) return;
    if (Game.time % 20 !== 0 && e.wants.length !== undefined && e.plannedAt && Game.time - e.plannedAt < 20) return;
    e.plannedAt = Game.time;

    const states = util.ownedRooms().map(r => roomState.get(r));
    const wants = [];
    planHelpers(wants, states);
    planCouriers(wants, states);
    planExpansion(wants, states);
    e.wants = wants;

    if (Game.time % config.terminal.interval === 0) {
        require('logistics').balanceTerminals(states);
    }
}

module.exports = { run, observe, ensure };
