/**
 * Cross-room decisions: helpers for spawnless rooms, couriers from rich rooms
 * into weak ones, scouting, reclaiming lost rooms and carefully gated claiming.
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

function myUsername() {
    const h = util.heap;
    if (h.myName) return h.myName;
    for (const n in Game.spawns) {
        const sp = Game.spawns[n];
        if (sp.owner && sp.owner.username) return (h.myName = sp.owner.username);
    }
    const owned = util.ownedRooms();
    if (owned.length && owned[0].controller.owner) return (h.myName = owned[0].controller.owner.username);
    return null;
}

function wantClaimer(wants, c) {
    addWant(wants, {
        role: 'claimer',
        spawnIn: c.from,
        home: c.from,
        count: 1,
        priority: c.reclaim ? 450 : 320,
        memory: { targetRoom: c.target },
        match: { targetRoom: c.target },
    });
}

/** Owned room with the shortest walking route (in rooms) to `target`, or null. */
function nearestByRoute(target, pred, maxHops) {
    const rooms = util.ownedRooms();
    let best = null;
    for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        if (util.roomDistance(r.name, target) > maxHops) continue;
        if (pred && !pred(r)) continue;
        const route = Game.map.findRoute(r.name, target, {
            routeCallback: n => (util.isHighway(n) ? 2 : util.isKeeperRoom(n) ? 10 : 1),
        });
        if (route === ERR_NO_PATH || !route.length || route.length > maxHops) continue;
        if (!best || route.length < best.hops) best = { room: r, hops: route.length };
    }
    return best;
}

/**
 * Rooms whose controller we lost while our buildings still stand. We keep
 * vision through the structures, so no scouting or funding gate applies: a
 * claimer costs 650 energy and the room restarts on its own (re-activated)
 * spawn. Sets e.claim and returns true when a target was picked.
 */
function planReclaim(e) {
    const cfg = config.reclaim;
    if (!cfg || !cfg.enabled) return false;
    const me = myUsername();
    let best = null;
    for (const name in Game.rooms) {
        const room = Game.rooms[name];
        const ctrl = room.controller;
        if (!ctrl || ctrl.my || ctrl.owner) continue;
        if (ctrl.reservation && ctrl.reservation.username !== me) continue;
        if (e.blacklist[name] && Game.time - e.blacklist[name] < cfg.retry) continue;
        if (!roomStatusOk(name)) continue;
        const mine = room.find(FIND_MY_STRUCTURES);
        let spawns = 0;
        for (let i = 0; i < mine.length; i++) if (mine[i].structureType === STRUCTURE_SPAWN) spawns++;
        if (!spawns && mine.length < cfg.minStructures) continue;
        if (room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_INVADER_CORE }).length) continue;
        if (room.find(FIND_HOSTILE_CREEPS).length) continue;
        const from = nearestByRoute(name, r => {
            const s = roomState.get(r);
            return s.activeSpawns.length > 0 && s.rcl >= cfg.spawnerMinRcl && !s.hostiles.length;
        }, cfg.maxLinearDistance);
        if (!from) continue;
        const score = spawns * 100 + mine.length - from.hops * 50;
        if (!best || score > best.score) best = { score, name, from: from.room.name, spawns, n: mine.length };
    }
    if (!best) return false;
    e.claim = { target: best.name, from: best.from, t: Game.time, reclaim: true };
    util.log('Reclaiming ' + best.name + ' (' + best.spawns + ' spawn(s), ' + best.n + ' structures) from ' + best.from);
    Game.notify('Reclaiming lost room ' + best.name + ' from ' + best.from);
    return true;
}

function planExpansion(wants, states) {
    const e = ensure();
    const cfg = config.expansion;
    const owned = util.ownedRooms();
    if (Game.gcl.level <= owned.length) {
        e.claim = null;
        return;
    }
    let expansionOk = !!cfg.enabled;
    for (let i = 0; i < states.length; i++) {
        if (states[i].rcl < cfg.allRoomsMinRcl || !states[i].spawns.length) expansionOk = false;
    }

    // Keep an existing claim alive.
    if (e.claim) {
        const c = e.claim;
        if (Game.time - c.t > cfg.claimTimeout) {
            util.warn('Claim of ' + c.target + ' timed out');
            e.blacklist[c.target] = Game.time;
            e.claim = null;
        } else if (util.isOwned(c.target)) {
            util.log(c.reclaim
                ? 'Reclaimed ' + c.target + '; its spawn restarts the room'
                : 'Expansion ' + c.target + ' claimed; helpers will build the spawn');
            e.claim = null;
        } else if (!c.reclaim && !expansionOk) {
            e.claim = null;
        } else {
            wantClaimer(wants, c);
            return;
        }
    }

    // Lost rooms with our buildings come first and bypass the expansion gates.
    if (planReclaim(e)) {
        wantClaimer(wants, e.claim);
        return;
    }

    if (!expansionOk) {
        e.claim = null;
        return;
    }
    if (Game.cpu.bucket < cfg.minBucket) return;

    const funders = states.filter(s => s.activeSpawns.length && s.rcl >= cfg.funderMinRcl &&
        s.storage && (s.storage.store[RESOURCE_ENERGY] || 0) >= cfg.funderMinStorage && !s.hostiles.length);
    if (!funders.length) return;

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
