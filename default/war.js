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

/** The room that spawns unclaimers: most CLAIM parts within reach of the target, nearest on ties. */
function pickUnclaimFrom(target) {
    const owned = util.ownedRooms();
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < owned.length; i++) {
        const st = roomState.get(owned[i]);
        if (st.bootstrap || !st.activeSpawns.length) continue;
        const d = Game.map.getRoomLinearDistance(st.name, target);
        if (d > config.war.unclaimRange) continue;
        const parts = unclaimParts(st.cap);
        if (!parts) continue;
        const score = parts * 10 - d;
        if (score > bestScore) {
            bestScore = score;
            best = st.name;
        }
    }
    return best;
}

/** Keep the unclaim plan current: spawn room, next attack tick, done. Runs from war.run(). */
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
        w.unclaimAt = Game.time + Math.max(ctrl.upgradeBlocked || 0, ctrl.safeMode || 0);
        w.unclaimLeft = ctrl.level ? ctrl.level + ':' + ctrl.ticksToDowngrade : null;
    }
    if (!w.unclaimFrom || Game.time % 500 === 0 || !util.isOwned(w.unclaimFrom)) {
        const from = pickUnclaimFrom(w.target);
        if (from !== w.unclaimFrom) {
            w.unclaimFrom = from;
            util.log('WAR: unclaimers for ' + w.target + ' come from ' + (from || 'nowhere (no room in range can afford CLAIM)'));
        }
    }
}

/** Spawn request for this room's unclaimer, or null. Timed so it reaches the controller as the block ends. */
function unclaimWant(st) {
    const w = state();
    if (!w || !w.target || !w.unclaim || w.unclaimDone || w.unclaimFrom !== st.name) return null;
    if (w.unclaimAt && w.unclaimAt - Game.time > config.war.unclaimLead) return null;
    const list = unclaimers();
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        // One that has not struck yet is still on its way (or waiting at the controller).
        if (c.memory.targetRoom === w.target && !c.memory.struck && (c.spawning || c.ticksToLive > 50)) return null;
    }
    return {
        role: 'unclaimer',
        count: 1,
        have: 0,
        priority: config.war.priority + 10,
        shrink: false,
        memory: { targetRoom: w.target },
        body: e => {
            const n = Math.max(1, unclaimParts(e));
            const body = [];
            for (let i = 0; i < n; i++) body.push(CLAIM);
            for (let i = 0; i < n; i++) body.push(MOVE);
            return body;
        },
    };
}

/** Anything left to kill in the target room (needs vision). */
function remainingTargets(roomName) {
    const room = Game.rooms[roomName];
    if (!room) return null;
    const creeps = room.find(FIND_HOSTILE_CREEPS).length;
    let structs = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType !== STRUCTURE_CONTROLLER && s.hits != null,
    }).length;
    if (config.war.razeAll) {
        structs += room.find(FIND_STRUCTURES, {
            filter: s => !s.my && (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER),
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
            (w.unclaim ? ' unclaim=' + (w.unclaimDone ? 'done' : 'RCL' + (w.unclaimLeft || '?') + ' hits=' + (w.unclaimHits || 0) + ' from=' + (w.unclaimFrom || '-')) : ''));
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

module.exports = { KINDS, state, soldiers, composition, roomEligible, cheapFloor, terminalKeep, unclaimWant, enemyController, rallyPos, safeModeActive, unrestricted, run };
