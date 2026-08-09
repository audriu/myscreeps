/**
 * experimental — expansion-first Screeps colony AI
 *
 * Bootstraps from any existing colony state: discovers owned rooms, adopts
 * legacy creeps (e.g. role "ant"), plans missing structures, and expands
 * toward GCL room cap via claim + remotes.
 */

const memoryManager = require('memoryManager');
const creepManager = require('creepManager');
const spawnManager = require('spawnManager');
const construction = require('construction');
const defense = require('defense');
const expansion = require('expansion');
const lib = require('lib');

module.exports.loop = function () {
    // --- always ---
    memoryManager.init();
    memoryManager.cleanup();

    // Room intel (cheap enough every tick for visible rooms)
    memoryManager.refreshRoomIntel();

    // Defense before economy so towers react immediately
    defense.run();

    // Creeps
    creepManager.run();

    // Spawning
    spawnManager.run();

    // Construction — throttle when CPU bucket is low
    if (lib.bucketOk('low') || Game.time % 7 === 0) {
        for (const room of lib.ownedRooms()) {
            construction.run(room);
        }
    }

    // Expansion planning
    expansion.run();

    // Periodic summary
    if (Game.time % 100 === 0) {
        const rooms = lib.ownedRooms();
        const creeps = Object.keys(Game.creeps).length;
        const target = Memory.empire && Memory.empire.expansionTarget;
        const remotes = Memory.empire && Memory.empire.remotes
            ? Object.keys(Memory.empire.remotes).length
            : 0;
        lib.log(
            `rooms=${rooms.length}/${Game.gcl.level} creeps=${creeps} ` +
            `cpu=${Game.cpu.getUsed().toFixed(1)}/${Game.cpu.limit} ` +
            `bucket=${Game.cpu.bucket} claim=${target || '-'} remotes=${remotes}`
        );
    }
};
