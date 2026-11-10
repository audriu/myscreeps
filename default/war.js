/**
 * Offensive squads. Driven entirely from the console through Memory.war
 * (see config.war for the switches). This module keeps the shared state:
 * which room is the rally point, whether the squad has gathered, whether
 * the target has been cleared. Spawning lives in spawner.js (role
 * 'soldier'), behaviour in roles.js.
 */
const config = require('config');
const util = require('util');
const roomState = require('roomState');

const KINDS = ['melee', 'ranged', 'healer'];

function state() {
    const w = Memory.war;
    if (!w || typeof w !== 'object') return null;
    return w;
}

/** Every soldier alive (spawning ones included), optionally only one kind. */
function soldiers(kind) {
    return util.cache('war|soldiers|' + (kind || ''), () => {
        const out = [];
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            if (c.memory.role !== 'soldier') continue;
            if (kind && c.memory.kind !== kind) continue;
            out.push(c);
        }
        return out;
    });
}

/** Soldiers the room should hold while mustering, split by kind. */
function composition(st) {
    const cfg = config.war;
    const total = cfg.maxPerRoom;
    const healers = Math.round(total * cfg.healers);
    const fighters = total - healers;
    const ranged = Math.round(fighters * cfg.ranged);
    return { melee: fighters - ranged, ranged, healer: healers };
}

/**
 * Low-energy muster (Memory.war.cheap = true, or a number for the floor):
 * the storage gate is dropped, soldiers are built from whatever energy the
 * room holds once it reaches the floor, and the terminal reserve is spent.
 * Returns the energy floor for this room, or 0 when the mode is off.
 */
function cheapFloor(st) {
    const w = state();
    if (!w || !w.cheap) return 0;
    const floor = typeof w.cheap === 'number' && w.cheap > 0 ? w.cheap : config.war.cheapMin;
    return st ? Math.min(st.cap, floor) : floor;
}

/** Energy haulers leave in a terminal: none while a low-energy muster is on. */
function terminalKeep() {
    return cheapFloor() ? 0 : config.terminal.keep;
}

/** Does this room take part in the war effort right now? */
function roomEligible(st) {
    const cfg = config.war;
    if (st.rcl < cfg.minRcl || st.bootstrap || !st.activeSpawns.length) return false;
    if (!cheapFloor(st) && st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) < cfg.minStorage) return false;
    return true;
}

/** Owned room closest to the target (linear distance), the staging area. */
function pickRally(target) {
    const owned = util.ownedRooms();
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < owned.length; i++) {
        const name = owned[i].name;
        if (util.isAvoided(name)) continue;
        const d = Game.map.getRoomLinearDistance(name, target);
        if (d < bestD) {
            bestD = d;
            best = name;
        }
    }
    return best;
}

function rallyPos(w) {
    const room = w.rally && Game.rooms[w.rally];
    if (!room || !room.controller || !room.controller.my) return null;
    return roomState.get(room).anchor;
}

/* ------------------------------------------------------------------ */
/* Controller attack (Memory.war.unclaim = true)                        */
/* ------------------------------------------------------------------ */

/** Every unclaimer alive (spawning ones included). */
function unclaimers() {
    return util.cache('war|unclaimers', () => {
        const out = [];
        for (const name in Game.creeps) if (Game.creeps[name].memory.role === 'unclaimer') out.push(Game.creeps[name]);
        return out;
    });
}

/** Someone other than us owns or reserves this controller. */
function enemyController(ctrl) {
    if (!ctrl || ctrl.my) return false;
    if (ctrl.owner) return true;
    return !!(ctrl.reservation && !util.isOwned(ctrl.pos.roomName) && ctrl.reservation.username !== myName());
}

function myName() {
    for (const n in Game.spawns) return Game.spawns[n].owner.username;
    return null;
}

/** CLAIM parts a room can put into one unclaimer (CLAIM+MOVE pairs at 650 each). */
function unclaimParts(cap) {
    return Math.min(25, Math.floor(cap / (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])));
}

/** Unclaimers per strike: Memory.war.unclaim = 4 (true means 1). */
function unclaimCount(w) {
    const n = typeof w.unclaim === 'number' ? Math.floor(w.unclaim) : 1;
    return util.clamp(n, 1, 8); // 8 tiles around a controller
}

/**
 * Spawn rooms for the unclaimers, one per slot. Rooms within reach of the
 * target are ranked by CLAIM parts (nearest on ties); rooms with less than
 * half the best room's parts are left out, and the strong rooms take turns
 * when there are more slots than rooms.
 */
function pickUnclaimFrom(target, count) {
    const owned = util.ownedRooms();
    const cands = [];
    for (let i = 0; i < owned.length; i++) {
        const st = roomState.get(owned[i]);
        if (st.bootstrap || !st.activeSpawns.length) continue;
        const d = Game.map.getRoomLinearDistance(st.name, target);
        if (d > config.war.unclaimRange) continue;
        const parts = unclaimParts(st.cap);
        if (parts) cands.push({ name: st.name, parts, d });
    }
    cands.sort((a, b) => (b.parts - a.parts) || (a.d - b.d));
    const strong = cands.filter(c => c.parts * 2 >= cands[0].parts);
    const out = [];
    for (let i = 0; i < count && strong.length; i++) out.push(strong[i % strong.length].name);
    return out;
}

/** Keep the unclaim plan current: spawn rooms, when the controller opens, done. Runs from war.run(). */
function planUnclaim(w) {
    const tRoom = Game.rooms[w.target];
    const ctrl = tRoom && tRoom.controller;
    if (tRoom) {
        if (!enemyController(ctrl)) {
            if (!w.unclaimDone) {
                w.unclaimDone = Game.time;
                util.warn('WAR: the controller in ' + w.target + ' is no longer theirs');
                Game.notify('War: ' + w.target + ' controller is neutral now (' + (w.unclaimHits || 0) + ' controller attacks)');
            }
            return;
        }
        delete w.unclaimDone;
        const wait = Math.max(ctrl.upgradeBlocked || 0, ctrl.safeMode || 0);
        w.unclaimAt = Game.time + wait;
        if (wait) delete w.unclaimReady;
        w.unclaimLeft = ctrl.level ? ctrl.level + ':' + ctrl.ticksToDowngrade : null;
        // What the last strike really took off (all hits of one tick add up).
        const s = w.unclaimStrike;
        if (s && Game.time > s.t) {
            const took = s.before - ctrl.ticksToDowngrade - (Game.time - s.t);
            util.log('WAR: strike on ' + w.target + ' by ' + s.creeps + ' unclaimer(s), ' + s.parts + ' CLAIM: -' + took +
                ' ticks (expected -' + s.parts * CONTROLLER_CLAIM_DOWNGRADE + '), ' + ctrl.ticksToDowngrade + ' left at RCL' + ctrl.level);
            delete w.unclaimStrike;
        }
    }
    const count = unclaimCount(w);
    const from = Array.isArray(w.unclaimFrom) ? w.unclaimFrom : [];
    if (from.length !== count || Game.time % 500 === 0 || from.some(r => !util.isOwned(r))) {
        const next = pickUnclaimFrom(w.target, count);
        if (next.join() !== from.join()) {
            util.log('WAR: ' + count + ' unclaimer(s) for ' + w.target + ' from ' + (next.join(', ') || 'nowhere (no room in range can afford CLAIM)'));
        }
        w.unclaimFrom = next;
    }
}

/** Unclaimers of this target that have not struck yet and can still make it. */
function unclaimTeam(target) {
    return util.cache('war|unclaimTeam|' + target, () => unclaimers().filter(c =>
        c.memory.targetRoom === target && !c.memory.struck && (c.spawning || c.ticksToLive > 50)));
}

/**
 * Strike now? Hits only add up within one tick (the 1000-tick block starts
 * after it), so the team waits at the controller until all of them stand
 * there. It strikes early when a waiting member is about to die of old age,
 * or unclaimSync ticks after the first one got there.
 */
function unclaimGo(w, ctrl) {
    if (ctrl.upgradeBlocked || ctrl.safeMode) return false;
    const team = unclaimTeam(w.target);
    let ready = 0;
    let dying = false;
    for (let i = 0; i < team.length; i++) {
        const c = team[i];
        if (c.spawning || !c.pos.isNearTo(ctrl)) continue;
        ready++;
        if (c.ticksToLive <= 60) dying = true;
    }
    if (!ready) return false;
    if (!w.unclaimReady || w.unclaimReady > Game.time) w.unclaimReady = Game.time;
    if (ready === team.length || dying) return true;
    return Game.time - w.unclaimReady >= config.war.unclaimSync;
}

/** Spawn request for this room's unclaimers, or null. Timed so they reach the controller as the block ends. */
function unclaimWant(st) {
    const w = state();
    if (!w || !w.target || !w.unclaim || w.unclaimDone || !Array.isArray(w.unclaimFrom)) return null;
    let slots = 0;
    for (let i = 0; i < w.unclaimFrom.length; i++) if (w.unclaimFrom[i] === st.name) slots++;
    if (!slots) return null;
    if (w.unclaimAt && w.unclaimAt - Game.time > config.war.unclaimLead) return null;
    const team = unclaimTeam(w.target);
    let have = 0;
    for (let i = 0; i < team.length; i++) if (team[i].memory.from === st.name) have++;
    if (have >= slots) return null;
    // The whole team must be out within unclaimWindow ticks or the first ones die
    // waiting (a CLAIM creep lives 600 ticks): one spawn, five slots -> 11 CLAIM each.
    const spawns = Math.max(1, st.activeSpawns.length);
    const maxClaim = Math.max(1, Math.floor(config.war.unclaimWindow * spawns / (CREEP_SPAWN_TIME * 2 * slots)));
    // Late members only waste energy: skip one that cannot reach the controller
    // before the team has to strike (its oldest member about to expire, or the
    // sync wait over).
    let deadline = Infinity;
    for (let i = 0; i < team.length; i++) {
        if (!team[i].spawning) deadline = Math.min(deadline, Game.time + team[i].ticksToLive - 60);
    }
    if (w.unclaimReady) deadline = Math.min(deadline, w.unclaimReady + config.war.unclaimSync);
    const eta = Game.time + maxClaim * 2 * CREEP_SPAWN_TIME + (Game.map.getRoomLinearDistance(st.name, w.target) + 1) * 60;
    if (eta > deadline) return null;
    return {
        role: 'unclaimer',
        count: slots,
        have,
        priority: config.war.priority + 10,
        shrink: false,
        memory: { targetRoom: w.target, from: st.name },
        body: e => {
            const n = Math.max(1, Math.min(maxClaim, unclaimParts(e)));
            const body = [];
            for (let i = 0; i < n; i++) body.push(CLAIM);
            for (let i = 0; i < n; i++) body.push(MOVE);
            return body;
        },
    };
}

/** Never worth hitting: the controller, roads, portals, keeper lairs, and power banks (they hit back). */
const SWEEP_SKIP = {
    [STRUCTURE_CONTROLLER]: true,
    [STRUCTURE_ROAD]: true,
    [STRUCTURE_PORTAL]: true,
    [STRUCTURE_KEEPER_LAIR]: true,
    [STRUCTURE_POWER_BANK]: true,
};

/** Structures that are never spared for what they hold: they shoot, make defenders (spawns and the extensions feeding them), block our spawn, or nuke. */
const ALWAYS_KILL = {
    [STRUCTURE_TOWER]: true,
    [STRUCTURE_SPAWN]: true,
    [STRUCTURE_EXTENSION]: true,
    [STRUCTURE_NUKER]: true,
};

/**
 * Harmless structure (not ours) still holding energy or any other resource
 * (config.war.spareEnergy): left standing so it is there when we settle the room.
 */
function sparesEnergy(s) {
    if (!config.war.spareEnergy || s.my || ALWAYS_KILL[s.structureType] || !s.store) return false;
    for (const r in s.store) if (s.store[r] > 0) return true;
    return false;
}

/**
 * Final sweep (config.war.finalSweep): every structure in the room with hit
 * points that is not ours: ramparts, walls, containers, covered and
 * ownerless leftovers. Roads and harmless structures holding energy or resources stay.
 * Never in our own rooms.
 */
function sweepTargets(room) {
    if (!config.war.finalSweep || (room.controller && room.controller.my)) return [];
    return util.find(room, FIND_STRUCTURES, 'sweep', s => !s.my && s.hits != null && !SWEEP_SKIP[s.structureType] && !sparesEnergy(s));
}

/** Anything left to kill in the target room (needs vision). */
function remainingTargets(roomName) {
    const room = Game.rooms[roomName];
    if (!room) return null;
    const creeps = room.find(FIND_HOSTILE_CREEPS).length;
    if (config.war.finalSweep && !(room.controller && room.controller.my)) return creeps + sweepTargets(room).length;
    let structs = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType !== STRUCTURE_CONTROLLER && s.hits != null && !sparesEnergy(s),
    }).length;
    if (config.war.razeAll) {
        structs += room.find(FIND_STRUCTURES, {
            filter: s => !s.my && s.structureType === STRUCTURE_CONTAINER && !sparesEnergy(s),
        }).length;
    }
    if (unrestricted(roomName)) structs += room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_WALL }).length;
    return creeps + structs;
}

function run() {
    const w = state();
    if (!w) return;
    if (w.target && !util.roomCoords(w.target)) {
        util.warn('Memory.war.target "' + w.target + '" is not a room name; clearing it');
        delete w.target;
    }
    if (!w.target) {
        delete w.unclaimFrom;
        delete w.unclaimReady;
        delete w.unclaimStrike;
        delete w.unclaimAt;
        delete w.unclaimDone;
        delete w.unclaimLeft;
        delete w.safeUntil;
        delete w.rally;
        delete w.go;
        delete w.wave;
        delete w.since;
        delete w.cleared;
        return;
    }
    const cfg = config.war;
    const all = soldiers();
    if (!w.since) {
        w.since = Game.time;
        if (!w.wave) w.wave = Math.max(1, all.length);
        util.warn('WAR: target ' + w.target + ' set with ' + all.length + ' soldier(s) alive');
        Game.notify('War: target ' + w.target + ' set with ' + all.length + ' soldiers');
    }
    if (!w.rally || !util.isOwned(w.rally)) {
        w.rally = pickRally(w.target);
        if (w.rally) util.log('WAR: rally room ' + w.rally);
    }
    if (!w.go) {
        const pos = rallyPos(w);
        let gathered = 0;
        if (pos) {
            for (let i = 0; i < all.length; i++) {
                const c = all[i];
                if (!c.spawning && c.pos.roomName === pos.roomName && c.pos.inRangeTo(pos, 8)) gathered++;
            }
        }
        const need = Math.ceil(w.wave * cfg.gatherShare);
        const waited = Game.time - w.since;
        if (gathered && (gathered >= need || waited > cfg.maxGather || !pos)) {
            w.go = Game.time;
            util.warn('WAR: ' + gathered + ' soldier(s) gathered, marching on ' + w.target);
            Game.notify('War: marching on ' + w.target + ' with ' + gathered + ' soldiers');
        } else if (Game.time % 50 === 0) {
            util.log('WAR: gathering at ' + (w.rally || '?') + ' ' + gathered + '/' + need + ' (' + waited + ' ticks)');
        }
    }
    // Safe mode blocks every hostile action: wait it out at the rally room instead of feeding the towers.
    const tRoom = Game.rooms[w.target];
    if (tRoom && tRoom.controller && tRoom.controller.safeMode) {
        const until = Game.time + tRoom.controller.safeMode;
        if (!w.safeUntil || Math.abs(w.safeUntil - until) > 5) {
            w.safeUntil = until;
            util.warn('WAR: ' + w.target + ' is in safe mode for ' + tRoom.controller.safeMode + ' ticks; squad waits at ' + (w.rally || 'home'));
            Game.notify('War: ' + w.target + ' is in safe mode for ' + tRoom.controller.safeMode + ' ticks, squad waiting');
        }
    } else if (w.safeUntil && (tRoom || Game.time > w.safeUntil)) {
        delete w.safeUntil;
        util.warn('WAR: safe mode in ' + w.target + ' is over; resuming');
        Game.notify('War: safe mode in ' + w.target + ' over, squad resuming');
    }
    if (w.unclaim) planUnclaim(w);
    const left = remainingTargets(w.target);
    if (left === 0 && !w.cleared) {
        w.cleared = Game.time;
        util.warn('WAR: ' + w.target + ' cleared; soldiers hold the room');
        Game.notify('War: ' + w.target + ' cleared, nothing hostile left');
    } else if (left > 0 && w.cleared) {
        delete w.cleared;
    }
    if (Game.time % config.logEvery === 0) {
        let inTarget = 0;
        for (let i = 0; i < all.length; i++) if (all[i].pos.roomName === w.target) inTarget++;
        util.log('WAR: ' + (w.safeUntil ? 'waiting (safe mode ' + (w.safeUntil - Game.time) + ')' : w.go ? 'attacking' : 'gathering') + ' ' + w.target + ' soldiers=' + all.length +
            ' inTarget=' + inTarget + (left == null ? ' (no vision)' : ' hostilesLeft=' + left) +
            (w.muster ? '' : ' (muster off: no reinforcements)') +
            (w.unclaim ? ' unclaim=' + (w.unclaimDone ? 'done' : 'RCL' + (w.unclaimLeft || '?') + ' hits=' + (w.unclaimHits || 0) + ' x' + unclaimCount(w) + ' from=' + (Array.isArray(w.unclaimFrom) ? w.unclaimFrom.join('+') : '-')) : ''));
    }
}

/** Nothing spared in this room: walls and rampart-covered structures are ordinary targets. */
function unrestricted(roomName) {
    const w = state();
    if (w && w.everything) return true;
    const list = config.war.unrestrictedRooms || [];
    return list.indexOf(roomName) !== -1;
}

/** Target under safe mode (known from vision or remembered until it expires). */
function safeModeActive(w) {
    return !!(w && w.safeUntil && Game.time < w.safeUntil);
}

module.exports = { KINDS, state, soldiers, composition, roomEligible, cheapFloor, terminalKeep, unclaimWant, unclaimGo, enemyController, sparesEnergy, sweepTargets, rallyPos, safeModeActive, unrestricted, run };
