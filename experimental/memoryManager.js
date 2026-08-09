/**
 * Memory bootstrap & cleanup. Safe to run on any existing Memory blob.
 */

const lib = require('lib');

function init() {
    if (!Memory.empire) {
        Memory.empire = {
            expansionTarget: null,
            remotes: {},
            lastExpansionPlan: 0,
            bootstrappedAt: Game.time,
        };
    }
    if (!Memory.rooms) Memory.rooms = {};
    if (!Memory.creeps) Memory.creeps = {};
    if (!Memory.flags) Memory.flags = {};
}

function cleanup() {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    // Drop stale room intel occasionally
    if (Game.time % 1000 === 0) {
        for (const roomName in Memory.rooms) {
            const m = Memory.rooms[roomName];
            if (!m) continue;
            // Keep owned / expansion / remote entries
            if (m.my || m.expansionCandidate || m.remote) continue;
            if (m.scouted && Game.time - m.scouted > 20000) delete Memory.rooms[roomName];
        }
    }
}

/**
 * Refresh Memory.rooms[name] for every visible room + owned rooms.
 */
function refreshRoomIntel() {
    const owned = {};
    for (const room of lib.ownedRooms()) {
        owned[room.name] = true;
        const mem = Memory.rooms[room.name] = Memory.rooms[room.name] || {};
        mem.my = true;
        mem.owner = room.controller.owner && room.controller.owner.username;
        mem.rcl = room.controller.level;
        mem.sources = room.find(FIND_SOURCES).map(s => s.id);
        mem.spawns = room.find(FIND_MY_SPAWNS).map(s => s.id);
        mem.energyCapacity = room.energyCapacityAvailable;
        mem.energyAvailable = room.energyAvailable;
        mem.hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        mem.scouted = Game.time;
        mem.avoid = false;

        // Phase detection — resume from any state
        if (!mem.spawns.length) {
            mem.phase = 'pioneer';
        } else if (room.controller.level < 3 || room.energyCapacityAvailable < 550) {
            mem.phase = 'bootstrap';
        } else if (room.controller.level < 4 || !room.storage) {
            mem.phase = 'develop';
        } else {
            mem.phase = 'mature';
        }
    }

    // Visible non-owned rooms
    for (const name in Game.rooms) {
        if (owned[name]) continue;
        const room = Game.rooms[name];
        const mem = Memory.rooms[name] = Memory.rooms[name] || {};
        mem.my = false;
        mem.scouted = Game.time;
        mem.sources = room.find(FIND_SOURCES).map(s => s.id);
        mem.sourceCount = mem.sources.length;
        mem.keeper = lib.hasKeeperLairs(room);
        mem.hostiles = room.find(FIND_HOSTILE_CREEPS).length;

        if (room.controller) {
            mem.rcl = room.controller.level;
            if (room.controller.owner) {
                mem.owner = room.controller.owner.username;
                mem.reserved = null;
            } else if (room.controller.reservation) {
                mem.owner = null;
                mem.reserved = room.controller.reservation.username;
            } else {
                mem.owner = null;
                mem.reserved = null;
            }
            mem.claimable = !room.controller.owner && !mem.keeper;
        } else {
            // Highway / source keeper core without controller
            mem.claimable = false;
            mem.owner = null;
        }

        // Soft avoid: enemy owned rooms
        mem.avoid = !!(mem.owner && !mem.my);
    }

    // Mark owned rooms that disappeared from vision but still in Memory
    for (const name in Memory.rooms) {
        if (Memory.rooms[name].my && !owned[name] && !Game.rooms[name]) {
            // Lost vision — keep my flag until proven otherwise; clear if GCL rooms don't include it
            // Can't list claimed rooms without vision; leave as-is
        }
        if (!owned[name] && Memory.rooms[name].my && Game.rooms[name] &&
            (!Game.rooms[name].controller || !Game.rooms[name].controller.my)) {
            Memory.rooms[name].my = false;
        }
    }
}

module.exports = {
    init,
    cleanup,
    refreshRoomIntel,
};
