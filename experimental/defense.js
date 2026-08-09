/**
 * Towers + safe mode.
 */

const config = require('config');
const lib = require('lib');

function fortifyHits(room) {
    const late = room.controller && room.controller.level >= config.fortify.lateRcl;
    return {
        wall: late ? config.fortify.wallHitsLate : config.fortify.wallHits,
        rampart: late ? config.fortify.rampartHitsLate : config.fortify.rampartHits,
    };
}

function runRoom(room) {
    if (!room.controller || !room.controller.my) return;

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });

    // Safe mode if spawn under attack and we have energy on controller
    if (hostiles.length) {
        const spawns = room.find(FIND_MY_SPAWNS);
        const spawnThreatened = spawns.some(sp =>
            hostiles.some(h => h.pos.inRangeTo(sp, 3) &&
                (h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK) + h.getActiveBodyparts(HEAL)) > 0));

        if (spawnThreatened && room.controller.safeModeAvailable && !room.controller.safeMode &&
            !room.controller.safeModeCooldown) {
            const res = room.controller.activateSafeMode();
            if (res === OK) lib.log(`SAFE MODE activated in ${room.name}`);
        }
    }

    const hits = fortifyHits(room);

    for (const tower of towers) {
        if (hostiles.length) {
            // Focus healers / highest DPS nearby
            hostiles.sort((a, b) => {
                const score = c =>
                    c.getActiveBodyparts(HEAL) * 5 +
                    c.getActiveBodyparts(RANGED_ATTACK) * 2 +
                    c.getActiveBodyparts(ATTACK) -
                    tower.pos.getRangeTo(c);
                return score(b) - score(a);
            });
            tower.attack(hostiles[0]);
            continue;
        }

        const wounded = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: c => c.hits < c.hitsMax,
        });
        if (wounded) {
            tower.heal(wounded);
            continue;
        }

        // Repair (skip if energy low — save for defense)
        if (tower.store[RESOURCE_ENERGY] < 200) continue;

        const damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: s => {
                if (s.structureType === STRUCTURE_WALL) return s.hits < hits.wall;
                if (s.structureType === STRUCTURE_RAMPART) return s.hits < hits.rampart;
                return s.hits < s.hitsMax && s.hits / s.hitsMax < 0.85;
            },
        });
        if (damaged) tower.repair(damaged);
    }
}

function run() {
    for (const room of lib.ownedRooms()) {
        runRoom(room);
    }
}

module.exports = { run, runRoom };
