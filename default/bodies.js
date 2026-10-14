/**
 * Body plans scaled to an energy budget. Every plan returns parts ordered so
 * that TOUGH is hit first and MOVE survives longest.
 */
const util = require('util');

function assemble(counts) {
    const order = [TOUGH, WORK, CARRY, ATTACK, RANGED_ATTACK, CLAIM, HEAL, MOVE];
    const body = [];
    for (let i = 0; i < order.length; i++) {
        const part = order[i];
        for (let n = counts[part] || 0; n > 0; n--) body.push(part);
    }
    return body;
}

/** Generalist: [WORK, CARRY, MOVE] units, spare energy goes to extra CARRY/MOVE. */
function worker(energy) {
    const budget = Math.max(200, energy);
    let units = util.clamp(Math.floor(budget / 200), 1, 12);
    const counts = { work: units, carry: units, move: units };
    if (budget - units * 200 >= 100 && units < 12) {
        counts.carry++;
        counts.move++;
    }
    return assemble(counts);
}

/** Static miner. 5 WORK drains a source; CARRY lets it feed a link / repair its container. */
function miner(energy) {
    if (energy >= 800) return assemble({ work: 6, carry: 1, move: 3 });
    if (energy >= 650) return assemble({ work: 5, carry: 1, move: 2 });
    if (energy >= 550) return assemble({ work: 5, move: 1 });
    if (energy >= 450) return assemble({ work: 4, move: 1 });
    if (energy >= 350) return assemble({ work: 3, move: 1 });
    if (energy >= 250) return assemble({ work: 2, move: 1 });
    return assemble({ work: 1, move: 1 });
}

/** Hauler. 2 CARRY : 1 MOVE on roads, 1 : 1 without. */
function hauler(energy, roads) {
    if (roads) {
        const units = util.clamp(Math.floor(Math.max(150, energy) / 150), 1, 16);
        return assemble({ carry: units * 2, move: units });
    }
    const units = util.clamp(Math.floor(Math.max(100, energy) / 100), 1, 25);
    return assemble({ carry: units, move: units });
}

/** Upgrader: WORK heavy, enough CARRY to buffer, half-speed MOVE (walks once). */
function upgrader(energy, maxWork) {
    maxWork = maxWork || 20;
    for (let w = maxWork; w >= 1; w--) {
        const c = Math.max(1, Math.ceil(w / 4));
        let m = Math.ceil((w + c) / 2);
        if (100 * w + 50 * c + 50 * m <= energy && w + c + m <= 50) return assemble({ work: w, carry: c, move: m });
        m = Math.max(1, Math.ceil((w + c) / 3));
        if (100 * w + 50 * c + 50 * m <= energy && w + c + m <= 50) return assemble({ work: w, carry: c, move: m });
    }
    return assemble({ work: 1, carry: 1, move: 1 });
}

/** Melee defender with a little TOUGH. */
function defender(energy) {
    const units = util.clamp(Math.floor(Math.max(130, energy) / 130), 1, 15);
    const tough = util.clamp(Math.floor((energy - units * 130) / 10), 0, 5);
    return assemble({ tough, attack: units, move: units });
}

/** Ranged defender (used when the room has energy to spare). */
function ranger(energy) {
    const units = util.clamp(Math.floor(Math.max(200, energy) / 200), 1, 12);
    return assemble({ ranged_attack: units, move: units });
}

function claimer(energy) {
    if (energy >= 700) return assemble({ claim: 1, move: 2 });
    return assemble({ claim: 1, move: 1 });
}

function scout() {
    return [MOVE];
}

/** Long-distance hauler (plains between rooms): 1 CARRY : 1 MOVE. */
function courier(energy) {
    const units = util.clamp(Math.floor(Math.max(100, energy) / 100), 1, 25);
    return assemble({ carry: units, move: units });
}

module.exports = {
    worker,
    miner,
    hauler,
    upgrader,
    defender,
    ranger,
    claimer,
    scout,
    courier,
};
