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

/** Does this room take part in the war effort right now? */
function roomEligible(st) {
    const cfg = config.war;
    if (st.rcl < cfg.minRcl || st.bootstrap || !st.activeSpawns.length) return false;
    if (st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) < cfg.minStorage) return false;
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
            (w.muster ? '' : ' (muster off: no reinforcements)'));
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

module.exports = { KINDS, state, soldiers, composition, roomEligible, rallyPos, safeModeActive, unrestricted, run };
