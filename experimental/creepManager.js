/**
 * Per-tick creep dispatcher. Adopts legacy creeps from the default branch.
 */

const lib = require('lib');
const roles = require('roles');

const RUNNERS = {
    miner: roles.miner,
    hauler: roles.hauler,
    worker: roles.worker,
    upgrader: roles.upgrader,
    builder: roles.builder,
    scout: roles.scout,
    claimer: roles.claimer,
    reserver: roles.reserver,
    pioneer: roles.pioneer,
    defender: roles.defender,
    remoteMiner: roles.remoteMiner,
    remoteHauler: roles.remoteHauler,
    // Legacy
    fighter: roles.defender,
    colonist: roles.claimer,
};

function runCreep(creep) {
    if (creep.spawning) return;

    lib.ensureCreepHome(creep);

    // Dying empty workers — recycle near spawn to reclaim energy
    if (creep.ticksToLive && creep.ticksToLive < 50 && creep.store.getUsedCapacity() === 0) {
        const spawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
        if (spawn && creep.pos.isNearTo(spawn)) {
            spawn.recycleCreep(creep);
            return;
        }
        if (spawn) {
            lib.moveTo(creep, spawn);
            return;
        }
    }

    const role = lib.roleOf(creep);
    const runner = RUNNERS[role] || RUNNERS.worker;

    try {
        runner.run(creep);
    } catch (e) {
        console.log(`Creep ${creep.name} (${role}) error: ${e}`);
    }
}

function run() {
    for (const name in Game.creeps) {
        runCreep(Game.creeps[name]);
    }
}

module.exports = { run, runCreep };
