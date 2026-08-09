/**
 * Creep body plans scaled to available energy.
 */

const lib = require('lib');

function worker(energy) {
    // Balanced generalist — works from RCL1 (200) up
    energy = Math.max(200, Math.min(energy, 2000));
    const body = lib.scaleBody([WORK, CARRY, MOVE], energy, 30);
    return body ? lib.orderBody(body) : [WORK, CARRY, MOVE];
}

function miner(energy) {
    // 5WORK saturates a source; 1CARRY lets it tuck energy into a container
    if (energy >= 600) return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
    if (energy >= 550) return [WORK, WORK, WORK, WORK, WORK, MOVE];
    if (energy >= 450) return [WORK, WORK, WORK, WORK, MOVE];
    if (energy >= 350) return [WORK, WORK, WORK, MOVE];
    if (energy >= 250) return [WORK, WORK, MOVE];
    return [WORK, MOVE];
}

function hauler(energy) {
    energy = Math.max(100, Math.min(energy, 1500));
    // 2 CARRY : 1 MOVE on roads; off-road use 1:1 — use 1:1 for safety
    const body = lib.scaleBody([CARRY, MOVE], energy, 32);
    return body || [CARRY, MOVE];
}

function upgrader(energy) {
    energy = Math.max(200, Math.min(energy, 2100));
    // Bias WORK for controller throughput; keep some CARRY
    if (energy < 300) return [WORK, CARRY, MOVE];
    const parts = [];
    let budget = energy;
    // Always one CARRY + MOVE
    parts.push(CARRY, MOVE);
    budget -= 100;
    while (budget >= 100 && parts.length < 48) {
        parts.push(WORK);
        budget -= 100;
        if (budget >= 50 && parts.length < 49) {
            parts.push(MOVE);
            budget -= 50;
        }
    }
    return lib.orderBody(parts);
}

function builder(energy) {
    return worker(Math.min(energy, 1600));
}

function scout() {
    return [MOVE];
}

function claimer() {
    return [CLAIM, MOVE];
}

function reserver(energy) {
    if (energy >= 1300) return [CLAIM, CLAIM, MOVE, MOVE];
    return [CLAIM, MOVE];
}

function pioneer(energy) {
    // Chunky bootstrap creep for new rooms
    return worker(Math.min(Math.max(energy, 400), 1200));
}

function defender(energy) {
    energy = Math.max(260, Math.min(energy, 2000));
    const body = lib.scaleBody([TOUGH, ATTACK, MOVE, MOVE], energy, 40);
    return body ? lib.orderBody(body) : [ATTACK, MOVE];
}

function remoteMiner(energy) {
    return miner(energy);
}

function remoteHauler(energy) {
    return hauler(Math.min(energy, 1000));
}

module.exports = {
    worker,
    miner,
    hauler,
    upgrader,
    builder,
    scout,
    claimer,
    reserver,
    pioneer,
    defender,
    remoteMiner,
    remoteHauler,
};
