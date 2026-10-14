/**
 * Towers and safe mode.
 */
const config = require('config');
const util = require('util');

function pickTarget(st) {
    const hostiles = st.hostiles;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < hostiles.length; i++) {
        const h = hostiles[i];
        let score = 0;
        if (util.hasParts(h, [HEAL])) score += 300;
        if (util.hasParts(h, [ATTACK, RANGED_ATTACK, WORK, CLAIM])) score += 100;
        // Prefer targets near our spawns and ones our towers hit hard (close).
        let minRange = 50;
        for (let t = 0; t < st.towers.length; t++) minRange = Math.min(minRange, st.towers[t].pos.getRangeTo(h));
        score -= minRange * 3;
        score -= h.hits / 100;
        if (score > bestScore) {
            bestScore = score;
            best = h;
        }
    }
    return best;
}

function repairList(st) {
    const rh = util.roomHeap(st.name);
    if (rh.towerRepair && Game.time - rh.towerRepair.t < 10) return rh.towerRepair.list;
    const list = [];
    const target = config.planner.rampartTarget[st.rcl] || 0;
    // Fortifying ramparts is a luxury: only with a healthy storage.
    const storageEnergy = st.storage ? (st.storage.store[RESOURCE_ENERGY] || 0) : 0;
    const fortify = storageEnergy > config.defense.fortifyMinStorage;
    const all = st.room.find(FIND_STRUCTURES);
    for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (s.structureType === STRUCTURE_WALL) continue;
        if (s.structureType === STRUCTURE_RAMPART) {
            if (!s.my) continue;
            if (s.hits < 5000) list.push({ id: s.id, urgency: 2, hits: s.hits });
            else if (fortify && s.hits < target) list.push({ id: s.id, urgency: 0, hits: s.hits });
            continue;
        }
        if (s.hits < s.hitsMax * config.defense.repairBelow) list.push({ id: s.id, urgency: 1, hits: s.hits });
    }
    list.sort((a, b) => b.urgency - a.urgency || a.hits - b.hits);
    const out = list.map(e => e.id);
    rh.towerRepair = { t: Game.time, list: out };
    return out;
}

function maybeSafeMode(st) {
    const ctrl = st.ctrl;
    if (!st.danger || !ctrl.safeModeAvailable || ctrl.safeMode || ctrl.safeModeCooldown) return;
    const rh = util.roomHeap(st.name);
    rh.dangerSince = rh.dangerSince || Game.time;

    let reason = null;
    const critical = st.spawns.concat(st.towers);
    if (st.storage) critical.push(st.storage);
    if (st.terminal) critical.push(st.terminal);
    for (let i = 0; i < critical.length && !reason; i++) {
        if (critical[i].hits < critical[i].hitsMax - 500) reason = critical[i].structureType + ' damaged';
    }
    if (!reason && !st.towers.length && Game.time - rh.dangerSince > 3) {
        for (let i = 0; i < st.hostiles.length && !reason; i++) {
            for (let s = 0; s < st.spawns.length; s++) {
                if (st.hostiles[i].pos.inRangeTo(st.spawns[s], 5)) reason = 'hostiles at spawn, no towers';
            }
        }
    }
    if (!reason) {
        for (let i = 0; i < st.hostiles.length && !reason; i++) {
            if (util.hasParts(st.hostiles[i], [CLAIM]) && st.hostiles[i].pos.inRangeTo(ctrl, 2)) reason = 'controller attack';
        }
    }
    if (!reason && st.hostiles.length >= 4 && st.towers.length <= 1) reason = 'outnumbered';
    if (!reason) return;

    if (ctrl.activateSafeMode() === OK) {
        util.error(st.name + ': SAFE MODE (' + reason + ')');
        Game.notify('Safe mode activated in ' + st.name + ': ' + reason);
    }
}

function run(room, st) {
    const rh = util.roomHeap(st.name);
    if (!st.hostiles.length) rh.dangerSince = null;

    if (st.hostiles.length && st.towers.length) {
        const target = pickTarget(st);
        for (let i = 0; i < st.towers.length; i++) st.towers[i].attack(target);
    } else if (st.towers.length) {
        const hurt = util.find(room, FIND_MY_CREEPS, 'hurt', c => c.hits < c.hitsMax);
        let list = null;
        for (let i = 0; i < st.towers.length; i++) {
            const tower = st.towers[i];
            if (hurt.length) {
                tower.heal(tower.pos.findClosestByRange(hurt));
                continue;
            }
            if ((tower.store[RESOURCE_ENERGY] || 0) < config.defense.towerRepairMinEnergy) continue;
            if (!list) list = repairList(st);
            if (!list.length) continue;
            const target = Game.getObjectById(list[i % list.length]);
            if (target && target.hits < target.hitsMax) tower.repair(target);
        }
    }
    if (st.danger) {
        maybeSafeMode(st);
        if (!rh.alertAt || Game.time - rh.alertAt > 500) {
            rh.alertAt = Game.time;
            const owners = {};
            for (let i = 0; i < st.hostiles.length; i++) owners[st.hostiles[i].owner.username] = true;
            util.warn(st.name + ': ' + st.hostiles.length + ' hostile creep(s) from ' + Object.keys(owners).join(','));
        }
    }
}

module.exports = { run };
