/**
 * Minerals, labs, the factory and the terminal network.
 *
 * One room is the hub (Memory.empire.hub, picked automatically): everything
 * that is not energy flows there through the terminals, its labs run the
 * reactions and hold the boosts, its factory turns batteries into energy.
 *
 * This module decides; creeps carry. moves() lists what has to be carried
 * inside a room (from, to, resource, amount): idle haulers do the simple
 * ones, a `chemist` is spawned where labs, a factory or a big pile need one.
 */
const config = require('config');
const util = require('util');
const roomState = require('roomState');

const CFG = config.industry;

// Product -> its two reagents.
const RECIPE = {};
for (const a in REACTIONS) for (const b in REACTIONS[a]) RECIPE[REACTIONS[a][b]] = [a, b];

// What a boost has to do for each body part to count.
const EFFECT = { [ATTACK]: 'attack', [RANGED_ATTACK]: 'rangedAttack', [HEAL]: 'heal', [TOUGH]: 'damage', [MOVE]: 'fatigue', [WORK]: 'upgradeController' };

function nonEnergy(store) {
    let n = 0;
    for (const r in store) if (r !== RESOURCE_ENERGY && store[r] > 0) n += store[r];
    return n;
}

function amount(s, r) {
    return s && s.store ? (s.store[r] || 0) : 0;
}

/** What our storage and terminal in this room hold of a resource. */
function stock(st, r) {
    return amount(st.storage, r) + amount(st.terminal, r);
}

/** Everything in the room that could feed its labs: storage, terminal, labs and stores other players left. */
function avail(st, r) {
    let n = stock(st, r);
    for (let i = 0; i < st.labs.length; i++) n += st.labs[i].store[r] || 0;
    for (let i = 0; i < st.lootOther.length; i++) n += st.lootOther[i].store[r] || 0;
    return n;
}

/** A store in the room to take a resource from: storage, terminal, then leftovers. */
function source(st, r) {
    if (amount(st.storage, r) > 0) return st.storage;
    if (amount(st.terminal, r) > 0) return st.terminal;
    for (let i = 0; i < st.lootOther.length; i++) if ((st.lootOther[i].store[r] || 0) > 0) return st.lootOther[i];
    return null;
}

function hubName() {
    const e = Memory.empire;
    return e && e.hub && util.isOwned(e.hub) ? e.hub : null;
}

function isHub(name) {
    return hubName() === name;
}

/** Room state of the hub, or null. */
function hubState() {
    const name = hubName();
    return name ? roomState.get(Game.rooms[name]) : null;
}

/** Would the hub take more of this resource (it holds less than its cap)? Never true in the hub itself. */
function shippable(st, r) {
    const hub = hubState();
    if (!hub || hub.name === st.name || !hub.terminal) return false;
    return stock(hub, r) < (r === RESOURCE_BATTERY ? CFG.batteryCap : CFG.hubCap);
}

/** The biggest storage another player left in this room: where leftovers are gathered while we have no store of our own. */
function warehouse(st) {
    // It refused a deposit before (roles.finishMove): not for a long while again.
    if (st.mem.noDeposit && Game.time - st.mem.noDeposit < 50000) return null;
    let best = null;
    for (let i = 0; i < st.loot.length; i++) {
        const s = st.loot[i];
        if (s.structureType === STRUCTURE_STORAGE && (!best || s.store.getFreeCapacity() > best.store.getFreeCapacity())) best = s;
    }
    return best;
}

/**
 * Where a resource that is not energy goes inside this room. Away from the
 * hub: the terminal while the hub still takes it (it is shipped from there),
 * else storage. In the hub: storage. Without a store of our own: a storage
 * somebody left behind, so the other leftovers can be emptied and removed.
 */
function destination(st, r, from) {
    const stor = st.storageActive ? st.storage : null;
    const term = st.terminal;
    const list = [];
    const termRoom = term && nonEnergy(term.store) < CFG.terminalMax;
    if (termRoom && !isHub(st.name) && (shippable(st, r) || !stor)) list.push(term);
    if (stor) list.push(stor);
    else if (termRoom) list.push(term);
    else if (!term) list.push(warehouse(st));
    for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (d && (!from || d.id !== from.id) && d.store.getFreeCapacity(r) > 0) return d;
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Labs                                                                 */
/* ------------------------------------------------------------------ */

/** The strongest boost for a body part that the room has at least 300 of. */
function bestBoost(st, type, taken) {
    const table = BOOSTS[type];
    const key = EFFECT[type];
    let best = null;
    let bestV = 0;
    for (const r in table) {
        const v = table[r][key];
        if (v == null || (taken && taken[r])) continue;
        // TOUGH: the smaller the damage share the better.
        const strength = key === 'damage' ? 1 / v : v;
        if (strength > bestV && avail(st, r) >= 300) {
            bestV = strength;
            best = r;
        }
    }
    return best;
}

/** The two labs every other lab can react from (range 2 of both). */
function pickInputs(st, lm) {
    const labs = st.labs;
    let best = null;
    for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
            if (!labs[i].pos.inRangeTo(labs[j], 2)) continue;
            let n = 0;
            for (let k = 0; k < labs.length; k++) {
                if (k !== i && k !== j && labs[k].pos.inRangeTo(labs[i], 2) && labs[k].pos.inRangeTo(labs[j], 2)) n++;
            }
            if (!best || n > best.n) best = { n, a: labs[i].id, b: labs[j].id };
        }
    }
    if (best && best.n > 0) {
        lm.a = best.a;
        lm.b = best.b;
    } else {
        delete lm.a;
        delete lm.b;
    }
    lm.n = labs.length;
}

/** A reaction that can run now on the way to `r`: r itself, or the reagent that is missing. */
function resolve(st, r, depth) {
    const rc = RECIPE[r];
    if (!rc || depth > 4) return null;
    const a = avail(st, rc[0]);
    const b = avail(st, rc[1]);
    if (a >= CFG.labMin && b >= CFG.labMin) {
        const n = Math.min(a, b, CFG.labBatch);
        return { p: r, a: rc[0], b: rc[1], left: n - n % LAB_REACTION_AMOUNT };
    }
    return (a < CFG.labMin && resolve(st, rc[0], depth + 1)) || (b < CFG.labMin && resolve(st, rc[1], depth + 1)) || null;
}

/** Next reaction: the first goal the room is short of and can work toward. */
function pickJob(st) {
    const goals = (Memory.empire && Array.isArray(Memory.empire.labGoals)) ? Memory.empire.labGoals : CFG.goals;
    for (let i = 0; i < goals.length; i++) {
        const g = goals[i];
        if (!g || !RECIPE[g.res] || avail(st, g.res) >= g.keep) continue;
        const job = resolve(st, g.res, 0);
        if (job) return job;
    }
    return null;
}

/**
 * What each lab should hold (kept in the room heap as labWant):
 *  - Memory.war.boost on: one war boost per lab, the strongest tier in stock;
 *  - otherwise the current reaction: two reagent labs, the rest collect the
 *    product; a lab that is not needed keeps the upgrade boost ready.
 */
function planLabs(st) {
    const lm = st.mem.labs || (st.mem.labs = {});
    if (lm.n !== st.labs.length || !Game.getObjectById(lm.a) || !Game.getObjectById(lm.b)) pickInputs(st, lm);
    const want = {};
    const war = !!(Memory.war && Memory.war.boost);
    lm.mode = war ? 'boost' : 'react';
    const A = Game.getObjectById(lm.a);
    const B = Game.getObjectById(lm.b);
    if (war) {
        lm.job = null;
        const taken = {};
        let t = 0;
        for (let i = 0; i < st.labs.length; i++) {
            let r = null;
            while (t < CFG.warBoosts.length && !r) r = bestBoost(st, CFG.warBoosts[t++], taken);
            if (!r) break;
            taken[r] = true;
            want[st.labs[i].id] = { r, fill: LAB_MINERAL_CAPACITY, low: LAB_MINERAL_CAPACITY / 2, energy: LAB_ENERGY_CAPACITY };
        }
    } else {
        let job = A && B ? lm.job : null;
        // Done, or a reagent ran out half way.
        if (job && (job.left <= 0 || avail(st, job.a) < LAB_REACTION_AMOUNT || avail(st, job.b) < LAB_REACTION_AMOUNT)) job = null;
        if (!job && A && B) {
            job = pickJob(st);
            if (job) util.log(st.name + ': labs make ' + job.left + ' ' + job.p + ' from ' + job.a + ' + ' + job.b);
        }
        lm.job = job;
        const up = bestBoost(st, WORK, null);
        const makesBoost = !!(job && BOOSTS[WORK][job.p] && BOOSTS[WORK][job.p].upgradeController);
        // A lab to keep the upgrade boost in: one that is not reacting (with four or more labs one is set aside).
        let spare = null;
        for (let i = st.labs.length - 1; i >= 0 && !spare; i--) {
            const lab = st.labs[i];
            if (lab.id === lm.a || lab.id === lm.b) continue;
            const reacts = job && A && B && lab.pos.inRangeTo(A, 2) && lab.pos.inRangeTo(B, 2);
            if (!reacts || (st.labs.length >= 4 && !makesBoost)) spare = lab.id;
        }
        for (let i = 0; i < st.labs.length; i++) {
            const lab = st.labs[i];
            if (job && (lab.id === lm.a || lab.id === lm.b)) {
                want[lab.id] = { r: lab.id === lm.a ? job.a : job.b, fill: Math.min(job.left, 1500), low: Math.min(job.left, 300) };
            } else if (lab.id === spare) {
                if (up) want[lab.id] = { r: up, fill: 900, low: 300, energy: 1000 };
            } else if (job && lab.pos.inRangeTo(A, 2) && lab.pos.inRangeTo(B, 2)) {
                want[lab.id] = { r: job.p, out: 1500, keep: makesBoost ? 600 : 0, energy: makesBoost ? 1000 : 0 };
            }
        }
    }
    util.roomHeap(st.name).labWant = want;
}

function react(st) {
    const lm = st.mem.labs;
    if (!lm || lm.mode !== 'react' || !lm.job || lm.job.left <= 0 || lm.wake > Game.time) return;
    const job = lm.job;
    const A = Game.getObjectById(lm.a);
    const B = Game.getObjectById(lm.b);
    if (!A || !B) return;
    let a = A.store[job.a] || 0;
    let b = B.store[job.b] || 0;
    if (a < LAB_REACTION_AMOUNT || b < LAB_REACTION_AMOUNT) return;
    const want = util.roomHeap(st.name).labWant || {};
    let cooling = 0;
    for (let i = 0; i < st.labs.length; i++) {
        const lab = st.labs[i];
        const w = want[lab.id];
        if (!w || !w.out || w.r !== job.p) continue;
        if (lab.cooldown) {
            cooling = cooling ? Math.min(cooling, lab.cooldown) : lab.cooldown;
            continue;
        }
        if (lab.mineralType && lab.mineralType !== job.p) continue;
        if ((lab.store[job.p] || 0) + LAB_REACTION_AMOUNT > LAB_MINERAL_CAPACITY) continue;
        if (a < LAB_REACTION_AMOUNT || b < LAB_REACTION_AMOUNT || job.left <= 0) break;
        if (lab.runReaction(A, B) === OK) {
            job.left -= LAB_REACTION_AMOUNT;
            a -= LAB_REACTION_AMOUNT;
            b -= LAB_REACTION_AMOUNT;
            cooling = cooling ? Math.min(cooling, REACTION_TIME[job.p]) : REACTION_TIME[job.p];
        }
    }
    // Nothing to do until the first lab has cooled down.
    lm.wake = Game.time + (cooling || 5);
}

/**
 * A lab that can boost one of this creep's unboosted parts with what the
 * plan put there. 'wait' when such a lab is planned but not loaded yet,
 * null when the room has nothing for this creep.
 */
function boostLab(creep, st) {
    const want = util.roomHeap(st.name).labWant;
    if (!want) return null;
    let best = null;
    let bestD = Infinity;
    let pending = false;
    for (let i = 0; i < st.labs.length; i++) {
        const lab = st.labs[i];
        const w = want[lab.id];
        if (!w || !w.r || !w.energy) continue;
        let type = null;
        for (const t in BOOSTS) if (BOOSTS[t][w.r]) type = t;
        if (!type) continue;
        let open = false;
        for (let j = 0; j < creep.body.length; j++) if (creep.body[j].type === type && !creep.body[j].boost) open = true;
        if (!open) continue;
        if ((lab.store[w.r] || 0) < LAB_BOOST_MINERAL || (lab.store[RESOURCE_ENERGY] || 0) < LAB_BOOST_ENERGY) {
            if (avail(st, w.r) >= LAB_BOOST_MINERAL) pending = true;
            continue;
        }
        const d = creep.pos.roomName === lab.pos.roomName ? creep.pos.getRangeTo(lab) : 100;
        if (d < bestD) {
            bestD = d;
            best = lab;
        }
    }
    return best || (pending ? 'wait' : null);
}

/* ------------------------------------------------------------------ */
/* Carrying inside a room                                               */
/* ------------------------------------------------------------------ */

/** Resources of a store, the ones worth most first (compounds before base minerals, batteries last). */
function byWorth(store) {
    const out = [];
    for (const r in store) if (r !== RESOURCE_ENERGY && store[r] > 0) out.push(r);
    out.sort((a, b) => (a === RESOURCE_BATTERY ? 0 : a.length) - (b === RESOURCE_BATTERY ? 0 : b.length)).reverse();
    return out;
}

function labMoves(st, add) {
    const want = util.roomHeap(st.name).labWant;
    if (!want) return;
    const energy = st.storage ? (st.storage.store[RESOURCE_ENERGY] || 0) : 0;
    for (let i = 0; i < st.labs.length; i++) {
        const lab = st.labs[i];
        const w = want[lab.id] || {};
        const have = lab.mineralType;
        if (have && have !== w.r) {
            add(lab, destination(st, have, lab), have, lab.store[have], 1);
            continue;
        }
        if (w.r) {
            const n = lab.store[w.r] || 0;
            if (w.out) {
                if (n >= w.out) add(lab, destination(st, w.r, lab), w.r, n - (w.keep || 0), 1);
            } else if (n < w.low) {
                const s = source(st, w.r);
                if (s) add(s, lab, w.r, Math.min(w.fill - n, s.store[w.r]), 1);
            }
        }
        const e = lab.store[RESOURCE_ENERGY] || 0;
        if (w.energy && e < w.energy / 2 && energy > 1000) add(st.storage, lab, RESOURCE_ENERGY, w.energy - e, 1);
    }
}

function build(st, list) {
    const add = (from, to, r, n, k) => {
        if (from && to && n > 0) list.push({ f: from.id, t: to.id, r, n, k: k || 0 });
    };
    const hub = isHub(st.name);
    if (hub && st.labs.length) labMoves(st, add);

    // Factory: batteries in, energy out.
    const fac = st.factory;
    if (fac) {
        if ((fac.store[RESOURCE_BATTERY] || 0) < 100) {
            const s = source(st, RESOURCE_BATTERY);
            if (s) add(s, fac, RESOURCE_BATTERY, Math.min(1000, s.store[RESOURCE_BATTERY]), 1);
        }
        if ((fac.store[RESOURCE_ENERGY] || 0) >= 1000 && st.storage) add(fac, st.storage, RESOURCE_ENERGY, fac.store[RESOURCE_ENERGY], 1);
    }

    // The mineral miner's container.
    const box = st.mineralContainer;
    if (box) {
        for (const r in box.store) {
            if (r !== RESOURCE_ENERGY && box.store[r] >= 400) add(box, destination(st, r, box), r, box.store[r]);
        }
    }

    // What other players left behind, tombstones and ruins.
    for (let i = 0; i < st.lootOther.length; i++) {
        const s = st.lootOther[i];
        const types = byWorth(s.store);
        // Into our own stores the most valuable first; into another player's storage the
        // cheapest first, so a refused deposit costs a load of base minerals at worst.
        if (!st.storageActive && !st.terminal) types.reverse();
        for (let j = 0; j < types.length; j++) {
            const to = destination(st, types[j], s);
            if (to) {
                add(s, to, types[j], s.store[types[j]]);
                break;
            }
        }
    }

    // Between storage and terminal: out to the terminal what the hub still takes, back what it does not.
    const term = st.terminal;
    const stor = st.storageActive ? st.storage : null;
    if (term && stor) {
        if (hub) {
            for (const r in term.store) if (r !== RESOURCE_ENERGY && term.store[r] > 0) add(term, stor, r, term.store[r]);
        } else {
            let room = CFG.terminalMax - nonEnergy(term.store);
            for (const r in stor.store) {
                if (r === RESOURCE_ENERGY || !(stor.store[r] > 0) || room <= 0 || !shippable(st, r)) continue;
                // Too little to ever be sent: leave it where it is.
                if (stor.store[r] + (term.store[r] || 0) < TERMINAL_MIN_SEND) continue;
                const n = Math.min(stor.store[r], room, CFG.batch * 2);
                add(stor, term, r, n);
                room -= n;
            }
            for (const r in term.store) {
                if (r !== RESOURCE_ENERGY && term.store[r] > 0 && !shippable(st, r)) add(term, stor, r, term.store[r]);
            }
        }
    }
}

/** What has to be carried inside this room right now: [{ f, t, r, n, k }] (k = 1: lab or factory work, chemists only). */
function moves(st) {
    const rh = util.roomHeap(st.name);
    if (rh.moves && Game.time - rh.moves.t < 5) return rh.moves.list;
    const list = [];
    if (CFG.enabled && (st.terminal || st.lootOther.length || st.mineralContainer || st.factory || st.labs.length)) build(st, list);
    rh.moves = { t: Game.time, list };
    return list;
}

/**
 * Does this room need a chemist: lab or factory work, or a pile too big for
 * idle haulers. 0: no; 1: yes; 2: a big one (tens of thousands to move).
 */
function chemistWanted(st) {
    const rh = util.roomHeap(st.name);
    if (rh.chem && Game.time - rh.chem.t < 25) return rh.chem.v;
    const list = moves(st);
    let v = 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i].k) v = 1;
        n += list[i].n;
    }
    if (n >= CFG.chemistAt) v = 1;
    if (n >= CFG.chemistAt * 10) v = 2;
    rh.chem = { t: Game.time, v };
    return v;
}

/** Energy the terminal should hold to pay for shipping what sits in it. */
function terminalFee(st) {
    if (!CFG.enabled || !st.terminal || isHub(st.name)) return 0;
    const store = st.terminal.store;
    // Only for something that can actually go out (a terminal sends 100 at least).
    for (const r in store) if (r !== RESOURCE_ENERGY && store[r] >= TERMINAL_MIN_SEND) return CFG.feeEnergy;
    return 0;
}

/* ------------------------------------------------------------------ */
/* Minerals                                                             */
/* ------------------------------------------------------------------ */

/**
 * Is this room's mineral worth mining now: the empire holds less than the
 * cap, the room less than its own, and the storage has the energy to keep a
 * miner (no extractor is built for a room that could not use it).
 */
function wantsMineral(st) {
    if (!CFG.enabled || !st.mineral || !st.storage || st.bootstrap) return false;
    if ((st.storage.store[RESOURCE_ENERGY] || 0) < CFG.minEnergy) return false;
    const totals = util.heap.stockTotals;
    if (!totals) return false;
    const r = st.mineral.mineralType;
    return (totals[r] || 0) < CFG.mineralCap && stock(st, r) < CFG.roomStock;
}

/* ------------------------------------------------------------------ */
/* Per tick, per room                                                   */
/* ------------------------------------------------------------------ */

function run(st) {
    if (!CFG.enabled) return;
    const fac = st.factory;
    if (fac && !fac.cooldown && (fac.store[RESOURCE_BATTERY] || 0) >= 50 && fac.store.getFreeCapacity() >= 500) {
        fac.produce(RESOURCE_ENERGY);
    }
    if (!st.labs.length || !isHub(st.name)) return;
    if (Game.time % 10 === 0 || !util.roomHeap(st.name).labWant) planLabs(st);
    react(st);
}

/* ------------------------------------------------------------------ */
/* Empire pass                                                          */
/* ------------------------------------------------------------------ */

/** Everything a room holds that is not energy (ours and leftovers). */
function holdings(st) {
    let n = nonEnergy(st.storage ? st.storage.store : null) + nonEnergy(st.terminal ? st.terminal.store : null);
    for (let i = 0; i < st.lootOther.length; i++) n += nonEnergy(st.lootOther[i].store);
    return n;
}

/**
 * The hub: an owned room with our terminal and storage. Highest RCL first,
 * then the most central one that is close to where the stock lies. Kept in
 * Memory.empire.hub once picked (set it from the console to move it).
 */
function pickHub(states) {
    const e = Memory.empire;
    if (e.hub && util.isOwned(e.hub)) return e.hub;
    let rich = null;
    let richN = 0;
    for (let i = 0; i < states.length; i++) {
        const n = holdings(states[i]);
        if (n > richN) {
            richN = n;
            rich = states[i].name;
        }
    }
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        if (!st.terminal || !st.storageActive || !st.activeSpawns.length) continue;
        let d = 0;
        for (let j = 0; j < states.length; j++) d += util.roomDistance(st.name, states[j].name);
        const score = st.rcl * 100 + 20 * st.ctrl.progress / (st.ctrl.progressTotal || st.ctrl.progress || 1) -
            10 * d / states.length - (rich ? 15 * util.roomDistance(st.name, rich) : 0);
        if (score > bestScore) {
            bestScore = score;
            best = st.name;
        }
    }
    if (best && e.hub !== best) {
        e.hub = best;
        util.log('Hub: ' + best + ' collects minerals and compounds, runs the labs and the factory (Memory.empire.hub)');
    }
    return best;
}

/** Terminals send what is not energy to the hub; a room without storage of its own sends the rest anywhere it fits. */
function ship(states, hub) {
    const sent = {};
    // One log line per 100 ticks, summed up.
    const log = util.heap.shipLog || (util.heap.shipLog = {});
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        const term = st.terminal;
        if (!term || term.cooldown || st === hub) continue;
        const energy = term.store[RESOURCE_ENERGY] || 0;
        if (energy < 100) continue;
        // No storage of ours but leftovers to empty: everything has to go so theirs can be replaced.
        const evacuate = !st.storage && st.lootOther.length > 0;
        const types = byWorth(term.store);
        for (let j = 0; j < types.length; j++) {
            const r = types[j];
            if (term.store[r] < TERMINAL_MIN_SEND) continue;
            let dest = null;
            let room = 0;
            if (hub && hub.terminal && hub.terminal.store.getFreeCapacity() > 30000) {
                room = (r === RESOURCE_BATTERY ? CFG.batteryCap : CFG.hubCap) - stock(hub, r) - (sent[r] || 0);
                if (room > 0) dest = hub;
            }
            if (!dest && evacuate) {
                for (let k = 0; k < states.length; k++) {
                    const o = states[k];
                    if (o === st || o === hub || !o.terminal || !o.storageActive || o.terminal.store.getFreeCapacity() < 30000) continue;
                    if (o.storage.store.getFreeCapacity() > 200000 && (!dest || o.storage.store.getFreeCapacity() > dest.storage.store.getFreeCapacity())) dest = o;
                }
                room = CFG.batch;
            }
            if (!dest) continue;
            let n = Math.min(term.store[r], CFG.batch, room);
            const cost = Game.market.calcTransactionCost(n, st.name, dest.name);
            if (cost > energy) n = Math.floor(n * energy / cost);
            if (n < TERMINAL_MIN_SEND) continue;
            if (term.send(r, n, dest.name) === OK) {
                if (dest === hub) sent[r] = (sent[r] || 0) + n;
                const key = st.name + '>' + dest.name + ' ' + r;
                log[key] = (log[key] || 0) + n;
            }
            break;
        }
    }
    if (Game.time % 100 < 20) {
        const lines = [];
        for (const key in log) lines.push(key + ' ' + log[key]);
        if (lines.length) util.log('Shipped: ' + lines.join(', '));
        util.heap.shipLog = {};
    }
}

/** Every 20 ticks: the hub, what the empire holds in total, and the shipments. */
function plan(states) {
    if (!CFG.enabled) return;
    const totals = {};
    const count = store => {
        if (store) for (const r in store) if (r !== RESOURCE_ENERGY && store[r] > 0) totals[r] = (totals[r] || 0) + store[r];
    };
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        count(st.storage && st.storage.store);
        count(st.terminal && st.terminal.store);
        for (let j = 0; j < st.lootOther.length; j++) count(st.lootOther[j].store);
        for (let j = 0; j < st.labs.length; j++) count(st.labs[j].store);
        if (st.factory) count(st.factory.store);
    }
    util.heap.stockTotals = totals;
    const name = pickHub(states);
    let hub = null;
    for (let i = 0; i < states.length; i++) if (states[i].name === name) hub = states[i];
    ship(states, hub);
}

/** Is a factory worth building: batteries somewhere in the empire. */
function wantsFactory() {
    const totals = util.heap.stockTotals;
    return !!(CFG.enabled && totals && (totals[RESOURCE_BATTERY] || 0) >= CFG.factoryMin);
}

module.exports = {
    run, plan, moves, destination, chemistWanted, terminalFee, wantsMineral, wantsFactory,
    hubName, isHub, hubState, boostLab, nonEnergy, warehouse,
};
