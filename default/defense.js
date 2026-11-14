/**
 * Towers and safe mode.
 */
const config = require('config');
const util = require('util');

/** Raw damage of all loaded towers on a position (falloff with range). */
function towerDamage(towers, pos) {
    let sum = 0;
    for (let i = 0; i < towers.length; i++) {
        if ((towers[i].store[RESOURCE_ENERGY] || 0) < TOWER_ENERGY_COST) continue;
        const r = towers[i].pos.getRangeTo(pos);
        if (r <= TOWER_OPTIMAL_RANGE) sum += TOWER_POWER_ATTACK;
        else if (r >= TOWER_FALLOFF_RANGE) sum += TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF);
        else sum += TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * (r - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
    }
    return sum;
}

/** Damage that actually lands after boosted TOUGH parts (same walk as the engine). */
function effectiveDamage(creep, raw) {
    let left = raw;
    let reduced = 0;
    const body = creep.body;
    for (let i = 0; i < body.length && left > 0; i++) {
        const p = body[i];
        if (p.hits <= 0) continue;
        const b = p.boost && BOOSTS[p.type] && BOOSTS[p.type][p.boost];
        const ratio = b && b.damage ? b.damage : 1;
        const taken = Math.min(p.hits / ratio, left);
        reduced += taken * (1 - ratio);
        left -= taken;
    }
    return raw - reduced;
}

/** HP per tick a hostile can get back: its own HEAL parts plus healers around it. */
function healOn(creep, hostiles) {
    let sum = 0;
    for (let i = 0; i < hostiles.length; i++) {
        const h = hostiles[i];
        const r = h === creep ? 0 : h.pos.getRangeTo(creep);
        if (r > 3) continue;
        const power = r <= 1 ? HEAL_POWER : RANGED_HEAL_POWER;
        for (let j = 0; j < h.body.length; j++) {
            const p = h.body[j];
            if (p.type !== HEAL || p.hits <= 0) continue;
            const b = p.boost && BOOSTS[HEAL][p.boost];
            sum += power * (b ? b.heal : 1);
        }
    }
    return sum;
}

/** Hostiles the towers can actually wear down; shooting the rest only burns energy. */
function hittable(st) {
    const out = [];
    for (let i = 0; i < st.hostiles.length; i++) {
        const h = st.hostiles[i];
        if (effectiveDamage(h, towerDamage(st.towers, h.pos)) > healOn(h, st.hostiles)) out.push(h);
    }
    return out;
}

/** Our weakest rampart within reach of a hostile (range 3 covers ranged attacks). */
function rampartUnderFire(st) {
    let best = null;
    const ramparts = util.find(st.room, FIND_MY_STRUCTURES, 'ramparts', s => s.structureType === STRUCTURE_RAMPART);
    for (let i = 0; i < ramparts.length; i++) {
        const r = ramparts[i];
        if (r.hits >= r.hitsMax || (best && r.hits >= best.hits)) continue;
        for (let j = 0; j < st.hostiles.length; j++) {
            if (st.hostiles[j].pos.inRangeTo(r, 3)) {
                best = r;
                break;
            }
        }
    }
    return best;
}

/** Structures whose ramparts are thickened first. */
const KEY_STRUCTURES = [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_STORAGE, STRUCTURE_TERMINAL];

/** Energy in reserve: storage, or the source containers in a room without one. */
function reserve(st) {
    if (st.storage) return st.storage.store[RESOURCE_ENERGY] || 0;
    let n = 0;
    for (let i = 0; i < st.sources.length; i++) {
        if (st.sources[i].container) n += st.sources[i].container.store[RESOURCE_ENERGY] || 0;
    }
    return n;
}

/**
 * Can workers spend energy on thickening ramparts? Needs a reserve above
 * config.defense.workerFortify (storage, or source containers without one);
 * stays on until the reserve falls below half of it so workers do not flip
 * between fortifying and upgrading every time the spawn drains the room.
 */
function spareEnergy(st) {
    const rh = util.roomHeap(st.name);
    if (rh.spareAt === Game.time) return rh.spare;
    const cfg = config.defense.workerFortify;
    const need = st.storage ? cfg.storage : cfg.containers;
    const have = reserve(st);
    if (st.downgrade) rh.spare = false;
    else if (have >= need) rh.spare = true;
    else if (have < need / 2) rh.spare = false;
    rh.spareAt = Game.time;
    return !!rh.spare;
}

/**
 * Our ramparts below the RCL goal (config.planner.rampartTarget), the ones over
 * spawns, towers, storage and terminal first, weakest first within each group.
 */
function fortifyTargets(st) {
    const rh = util.roomHeap(st.name);
    let ids = rh.fortify && Game.time - rh.fortify.t < 10 ? rh.fortify.list : null;
    if (!ids) {
        const goal = config.planner.rampartTarget[st.rcl] || 0;
        const key = {};
        for (let t = 0; t < KEY_STRUCTURES.length; t++) {
            const list = st.byType[KEY_STRUCTURES[t]] || [];
            for (let i = 0; i < list.length; i++) if (list[i].my) key[list[i].pos.x + ':' + list[i].pos.y] = true;
        }
        const list = (st.byType[STRUCTURE_RAMPART] || [])
            .filter(r => r.my && r.hits < goal)
            .map(r => ({ id: r.id, hits: r.hits, key: key[r.pos.x + ':' + r.pos.y] ? 0 : 1 }));
        list.sort((a, b) => a.key - b.key || a.hits - b.hits);
        ids = list.map(e => e.id);
        rh.fortify = { t: Game.time, list: ids };
    }
    const out = [];
    for (let i = 0; i < ids.length; i++) {
        const r = Game.getObjectById(ids[i]);
        if (r) out.push(r);
    }
    return out;
}

function pickTarget(st, hostiles) {
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

/**
 * What a hostile actually damaged in this room last tick (from the event
 * log), or null. Counts hits on our creeps, our structures and our
 * controller; nukes are left out (safe mode does not stop them).
 */
function hostileDamage(st, mine) {
    const log = st.room.getEventLog();
    for (let i = 0; i < log.length; i++) {
        const ev = log[i];
        const attacker = Game.getObjectById(ev.objectId);
        // Our towers and creeps never hit our own things; an attacker that died since is not ours either.
        if (attacker && attacker.my) continue;
        if (ev.event === EVENT_ATTACK_CONTROLLER) return 'controller attacked';
        if (ev.event !== EVENT_ATTACK || !ev.data || ev.data.attackType === EVENT_ATTACK_TYPE_NUKE) continue;
        const target = Game.getObjectById(ev.data.targetId);
        // A hit that destroyed its target (a dismantler one-shots an extension)
        // leaves nothing to look up: last tick's list of our things knows it.
        const what = target ? (target.my ? label(target) : null) : (mine && mine[ev.data.targetId]);
        if (!what) continue;
        const who = attacker && attacker.owner ? attacker.owner.username : 'hostile';
        return who + ' hit ' + what + ' for ' + ev.data.damage + (target ? '' : ' (destroyed)');
    }
    return null;
}

function label(o) {
    return o instanceof Creep ? 'creep ' + o.name : o.structureType;
}

/** Our structures and creeps in the room by id, kept while hostiles are around. */
function rememberMine(st) {
    const mine = {};
    for (const type in st.byType) {
        const list = st.byType[type];
        for (let i = 0; i < list.length; i++) if (list[i].my) mine[list[i].id] = type;
    }
    const creeps = util.find(st.room, FIND_MY_CREEPS);
    for (let i = 0; i < creeps.length; i++) mine[creeps[i].id] = label(creeps[i]);
    return mine;
}

/** Safe mode only once a hostile has actually damaged our creeps, structures or controller here. */
function maybeSafeMode(st, mine) {
    const ctrl = st.ctrl;
    if (!st.danger || !ctrl.safeModeAvailable || ctrl.safeMode || ctrl.safeModeCooldown || ctrl.upgradeBlocked) return;
    const reason = hostileDamage(st, mine);
    if (!reason) return;

    const res = ctrl.activateSafeMode();
    if (res === OK) {
        util.error(st.name + ': SAFE MODE (' + reason + ')');
        Game.notify('Safe mode activated in ' + st.name + ': ' + reason);
    } else {
        const rh = util.roomHeap(st.name);
        if (!rh.safeFailAt || Game.time - rh.safeFailAt > 100) {
            rh.safeFailAt = Game.time;
            util.error(st.name + ': safe mode failed (' + res + ') after ' + reason);
        }
    }
}

function run(room, st) {
    const rh = util.roomHeap(st.name);

    const targets = st.hostiles.length && st.towers.length ? hittable(st) : [];
    if (targets.length) {
        const target = pickTarget(st, targets);
        for (let i = 0; i < st.towers.length; i++) st.towers[i].attack(target);
    } else if (st.hostiles.length && st.towers.length) {
        // Out-healed (e.g. boosted TOUGH + HEAL): hold fire and out-repair its damage instead.
        if (!rh.outhealedAt || Game.time - rh.outhealedAt > 500) {
            rh.outhealedAt = Game.time;
            util.warn(st.name + ': towers cannot out-damage the hostiles\' healing; repairing ramparts instead');
        }
        const rampart = rampartUnderFire(st);
        const hurt = util.find(room, FIND_MY_CREEPS, 'hurt', c => c.hits < c.hitsMax);
        for (let i = 0; i < st.towers.length; i++) {
            const tower = st.towers[i];
            if (rampart) tower.repair(rampart);
            else if (hurt.length) tower.heal(tower.pos.findClosestByRange(hurt));
        }
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
    const mine = rh.mine;
    rh.mine = st.hostiles.length ? rememberMine(st) : null;
    if (st.danger) {
        maybeSafeMode(st, mine);
        if (!rh.alertAt || Game.time - rh.alertAt > 500) {
            rh.alertAt = Game.time;
            const owners = {};
            for (let i = 0; i < st.hostiles.length; i++) owners[st.hostiles[i].owner.username] = true;
            util.warn(st.name + ': ' + st.hostiles.length + ' hostile creep(s) from ' + Object.keys(owners).join(','));
        }
    }
}

module.exports = { run, spareEnergy, fortifyTargets, KEY_STRUCTURES };
