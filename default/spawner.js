/**
 * Per-room spawning. Needs are derived from live state every tick; bodies are
 * sized to the room's capacity and the spawn waits for energy instead of
 * producing tiny creeps (except in emergencies, which shrink to fit).
 */
const config = require('config');
const util = require('util');
const bodies = require('bodies');
const roomState = require('roomState');
const war = require('war');

const POP = config.population;

function alive(list, minTtl) {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.spawning || c.ticksToLive == null || c.ticksToLive > minTtl) n++;
    }
    return n;
}

function sumParts(list, type) {
    let n = 0;
    for (let i = 0; i < list.length; i++) n += util.countParts(list[i], type);
    return n;
}

/** Path length from the anchor to a source (cached ~1500 ticks). */
function haulDistance(st, src) {
    const rh = util.roomHeap(st.name);
    rh.dist = rh.dist || {};
    const entry = rh.dist[src.id];
    if (entry && Game.time - entry.t < 1500) return entry.d;
    const goal = src.container ? { pos: src.container.pos, range: 0 } : { pos: src.pos, range: 1 };
    const res = PathFinder.search(st.anchor, goal, { maxRooms: 1, maxOps: 2000, plainCost: 2, swampCost: 10 });
    const d = res.path.length || 25;
    rh.dist[src.id] = { t: Game.time, d };
    return d;
}

function upgraderWorkWanted(st) {
    const storageEnergy = st.storage ? (st.storage.store[RESOURCE_ENERGY] || 0) : 0;
    if (st.rcl === 8) {
        if (storageEnergy > 300000) return 15;
        if (storageEnergy > 100000) return 8;
        return 3;
    }
    let w = st.sources.length * 10 - 4 - (st.sites.length ? 4 : 0);
    if (storageEnergy > 50000) w += 5;
    if (storageEnergy > 150000) w += 5;
    if (storageEnergy > 400000) w += 6;
    // Energy arriving from outside (couriers) or piling up at the controller.
    w += st.count('courier') * 4;
    if (st.ctrlContainer && (st.ctrlContainer.store[RESOURCE_ENERGY] || 0) > 1500) w += 3;
    if (st.downgrade) w = Math.max(w, 6);
    return util.clamp(w, 2, 24);
}

function wants(room, st) {
    const list = [];
    const n = st.count;
    const roadsOk = st.roads >= 10;

    const miners = st.creeps.miner || [];
    const haulers = st.creeps.hauler || [];
    const workers = st.creeps.worker || [];
    const upgraders = st.creeps.upgrader || [];
    const defenders = st.creeps.defender || [];

    // Nobody alive who can carry energy: get anything out of the door.
    if (!alive(miners, 0) && !alive(haulers, 0) && !alive(workers, 0)) {
        list.push({ role: 'worker', count: 1, have: 0, priority: 1000, shrink: true, body: e => bodies.worker(e) });
    }

    if (st.danger && (!st.towers.length || st.towers.every(t => (t.store[RESOURCE_ENERGY] || 0) < 50))) {
        list.push({
            role: 'defender',
            count: Math.min(POP.maxDefenders, st.hostiles.length),
            have: alive(defenders, 0),
            priority: 900,
            shrink: true,
            body: e => bodies.defender(e),
        });
    }

    if (st.downgrade && !st.bootstrap && alive(upgraders, 50) === 0) {
        list.push({ role: 'upgrader', count: 1, have: 0, priority: 950, shrink: true, body: e => bodies.upgrader(e, 20) });
    }

    // Economy down (no miner and no hauler alive): a couple of generalists get
    // things moving while the first miner/hauler pair is being funded.
    if (st.bootstrap) {
        const want = Math.min(POP.maxBootstrapWorkers, Math.max(2, st.sources.length));
        if (alive(workers, 30) < want) {
            list.push({ role: 'worker', count: want, have: alive(workers, 30), priority: 810, shrink: true, body: e => bodies.worker(e) });
        }
    }

    // Static miners: one per source. Miners without an assignment yet count
    // against whichever source is still free.
    const haulersAlive = alive(haulers, 0);
    const fullWork = util.countParts({ body: bodies.miner(st.cap).map(p => ({ type: p })) }, WORK);
    let spare = 0;
    for (let j = 0; j < miners.length; j++) {
        const c = miners[j];
        if (!c.memory.sourceId && (c.spawning || c.ticksToLive == null || c.ticksToLive > 60)) spare++;
    }
    for (let i = 0; i < st.sources.length; i++) {
        const src = st.sources[i];
        let work = 0;
        let count = 0;
        for (let j = 0; j < miners.length; j++) {
            const c = miners[j];
            if (c.memory.sourceId === src.id && (c.spawning || c.ticksToLive == null || c.ticksToLive > 60)) {
                work += util.countParts(c, WORK);
                count++;
            }
        }
        if (!count && spare > 0) {
            spare--;
            count++;
            work += fullWork;
        }
        // Covered when the miner(s) there have (nearly) the WORK the room can afford.
        if (count && (work >= Math.min(5, fullWork) || count >= 2)) continue;
        list.push({
            role: 'miner',
            count: 1,
            have: 0,
            priority: count ? 650 : 820,
            // Economy down: any miner now beats a perfect one later.
            shrink: st.bootstrap && st.energy >= 250,
            memory: { sourceId: src.id },
            body: e => bodies.miner(e),
        });
    }

    // Haulers sized by carry parts needed for the room's haul distances.
    const minersAlive = alive(miners, 0);
    let containerEnergy = 0;
    for (let i = 0; i < st.sources.length; i++) {
        if (st.sources[i].container) containerEnergy += (st.sources[i].container.store[RESOURCE_ENERGY] || 0);
    }
    if (minersAlive > 0 || containerEnergy > 500 || (st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) > 1000)) {
        let wantedCarry = 0;
        for (let i = 0; i < st.sources.length; i++) wantedCarry += Math.ceil(haulDistance(st, st.sources[i]) * 0.4) + 2;
        if (st.storage) wantedCarry += 4;
        const maxPer = roadsOk ? Math.min(32, 2 * Math.floor(st.cap / 150)) : Math.min(25, Math.floor(st.cap / 100));
        const minCount = st.sources.length >= 2 && st.rcl >= 3 ? 2 : 1;
        let desired = util.clamp(Math.ceil(wantedCarry / Math.max(1, maxPer)), minCount, POP.maxHaulers);
        // A rich storage means upgraders and the spawn both pull from it: one more pair of hands.
        if (st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) > 100000) desired = Math.min(POP.maxHaulers, desired + 1);
        const perHauler = Math.ceil(wantedCarry / desired);
        const energyFor = roadsOk ? Math.ceil(perHauler / 2) * 150 : perHauler * 100;
        const haveCarry = sumParts(haulers, CARRY);
        // Count haulers by capacity, so a crowd of tiny legacy haulers does not block real ones.
        const equivalent = haveCarry / Math.max(1, perHauler);
        if (haveCarry < wantedCarry && equivalent < desired && haulers.length < POP.maxHaulers + 3) {
            list.push({
                role: 'hauler',
                count: desired,
                have: haulers.length,
                priority: haulersAlive === 0 ? 850 : 700,
                shrink: haulersAlive === 0,
                body: e => bodies.hauler(Math.min(e, energyFor), roadsOk),
            });
        }
    }

    // Upgraders sized by WORK parts the economy can feed.
    const wantW = upgraderWorkWanted(st);
    const haveW = sumParts(upgraders, WORK);
    const maxWork = st.rcl === 8 ? 15 : 20;
    const perUpgrader = Math.max(1, util.countParts({ body: bodies.upgrader(st.cap, maxWork).map(p => ({ type: p })) }, WORK));
    const desiredUp = util.clamp(Math.ceil(wantW / perUpgrader), 1, POP.maxUpgraders);
    if (haveW < wantW && upgraders.length < desiredUp) {
        list.push({
            role: 'upgrader',
            count: desiredUp,
            have: upgraders.length,
            priority: 500,
            shrink: false,
            body: e => bodies.upgrader(e, Math.min(maxWork, Math.max(1, wantW - haveW))),
        });
    }

    // Workers: builders / repairers / flexible labour.
    let workerWant = 1;
    if (st.sites.length > 0) workerWant++;
    if (st.sites.length > 6) workerWant++;
    if (st.rcl <= 4 && st.sources.length >= 2) workerWant++;
    workerWant = Math.min(workerWant, POP.maxWorkers);
    if (alive(workers, 30) < workerWant) {
        list.push({
            role: 'worker',
            count: workerWant,
            have: alive(workers, 30),
            priority: st.sites.length && !workers.length ? 600 : 400,
            shrink: false,
            body: e => bodies.worker(Math.min(e, st.sites.length > 6 ? 1500 : 1000)),
        });
    }

    // War effort: while Memory.war.muster is on, eligible rooms keep a squad
    // (melee, ranged and healers) and replace losses.
    const w = war.state();
    if (w && w.muster && war.roomEligible(st)) {
        const mix = war.composition(st);
        const squad = st.creeps.soldier || [];
        const bodyFor = { melee: bodies.soldier, ranged: bodies.marksman, healer: bodies.healer };
        for (let k = 0; k < war.KINDS.length; k++) {
            const kind = war.KINDS[k];
            if (!mix[kind]) continue;
            const have = alive(squad.filter(c => c.memory.kind === kind), 100);
            if (have >= mix[kind]) continue;
            list.push({
                role: 'soldier',
                count: mix[kind],
                have,
                priority: config.war.priority,
                shrink: false,
                memory: { kind },
                body: e => bodyFor[kind](e),
            });
        }
    }

    // Empire requests assigned to this room.
    const empire = Memory.empire && Memory.empire.wants ? Memory.empire.wants : [];
    const index = roomState.creepIndex();
    for (let i = 0; i < empire.length; i++) {
        const w = empire[i];
        if (w.spawnIn !== room.name) continue;
        // Stale claim requests: the room may have been claimed since the empire last planned.
        if (w.role === 'claimer' && w.memory && util.isOwned(w.memory.targetRoom)) continue;
        const pool = (index.byHome[w.home] && index.byHome[w.home][w.role]) || [];
        let have = 0;
        for (let j = 0; j < pool.length; j++) {
            const c = pool[j];
            let ok = true;
            if (w.match) {
                for (const k in w.match) if (c.memory[k] !== w.match[k]) ok = false;
            }
            if (ok && (c.spawning || c.ticksToLive == null || c.ticksToLive > 100)) have++;
        }
        list.push({
            role: w.role,
            home: w.home,
            count: w.count,
            have,
            priority: w.priority,
            shrink: false,
            memory: w.memory,
            energyCap: w.energyCap,
            body: e => bodies[w.bodyKey || w.role](e),
        });
    }

    return list;
}

/** Directions a creep can leave the spawn by: planner-verified exits when known. */
function spawnDirections(room, spawn) {
    const plan = Memory.rooms[room.name] && Memory.rooms[room.name].plan;
    if (plan && plan.exits && plan.exits[spawn.id]) return plan.exits[spawn.id];
    const rh = util.roomHeap(room.name);
    rh.dirs = rh.dirs || {};
    const entry = rh.dirs[spawn.id];
    if (entry && Game.time - entry.t < 20) return entry.dirs;
    const dirs = [];
    const offsets = [[0, -1, TOP], [1, -1, TOP_RIGHT], [1, 0, RIGHT], [1, 1, BOTTOM_RIGHT],
        [0, 1, BOTTOM], [-1, 1, BOTTOM_LEFT], [-1, 0, LEFT], [-1, -1, TOP_LEFT]];
    for (let i = 0; i < offsets.length; i++) {
        const x = spawn.pos.x + offsets[i][0];
        const y = spawn.pos.y + offsets[i][1];
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (util.isWall(room.name, x, y)) continue;
        const structs = room.lookForAt(LOOK_STRUCTURES, x, y);
        let blocked = false;
        for (let j = 0; j < structs.length; j++) if (util.isBlockingStructure(structs[j])) blocked = true;
        if (!blocked) {
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
            for (let j = 0; j < sites.length; j++) if (util.isBlockingType(sites[j].structureType)) blocked = true;
        }
        if (!blocked) dirs.push(offsets[i][2]);
    }
    rh.dirs[spawn.id] = { t: Game.time, dirs };
    return dirs;
}

/** A finished creep that cannot leave the spawn: push whoever stands on the exits. */
function clearExits(room, spawn) {
    const near = spawn.pos.findInRange(FIND_MY_CREEPS, 1);
    for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.spawning || c.fatigue > 0) continue;
        const dir = util.stepAwayFrom(c, spawn.pos);
        if (dir) c.move(dir);
    }
}

function run(room, st) {
    util.roomHeap(room.name).needEnergy = 0;
    for (let i = 0; i < st.activeSpawns.length; i++) {
        const s = st.activeSpawns[i];
        if (s.spawning && s.spawning.remainingTime === 0) clearExits(room, s);
    }
    const usable = [];
    for (let i = 0; i < st.activeSpawns.length; i++) {
        const s = st.activeSpawns[i];
        if (s.spawning) continue;
        if (spawnDirections(room, s).length === 0) continue;
        usable.push(s);
    }
    if (!usable.length) return;
    // Spawns with the most exits first: creeps leave faster and block less.
    usable.sort((a, b) => spawnDirections(room, b).length - spawnDirections(room, a).length);

    const list = wants(room, st);
    list.sort((a, b) => b.priority - a.priority);
    const rh = util.roomHeap(room.name);

    for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (w.have >= w.count) continue;

        let budget = w.shrink ? st.energy : st.cap;
        if (w.energyCap) budget = Math.min(budget, w.energyCap);
        let body = w.body(budget);
        if (!body || !body.length) continue;
        let cost = util.bodyCost(body);
        if (!rh.needEnergy) rh.needEnergy = w.shrink ? Math.min(cost, st.cap) : cost;

        if (cost > st.energy) {
            if (w.shrink) {
                body = w.body(st.energy);
                cost = util.bodyCost(body);
                if (cost > st.energy) return;
            } else {
                if (rh.waitRole !== w.role) {
                    rh.waitRole = w.role;
                    rh.waitSince = Game.time;
                }
                // Starved for too long: take what we can get (but never a useless stub).
                if (Game.time - rh.waitSince > 250 && st.energy >= Math.max(300, Math.min(cost, st.cap) * 0.4)) {
                    body = w.body(st.energy);
                    cost = util.bodyCost(body);
                    if (cost > st.energy) return;
                } else {
                    return;
                }
            }
        }

        const spawn = usable.shift();
        const suffix = usable.length || st.activeSpawns.length > 1 ? '_' + spawn.name.replace(/\D/g, '') : '';
        const name = w.role + '_' + room.name + '_' + (Game.time % 1000000) + suffix;
        const memory = Object.assign({ role: w.role, home: w.home || room.name, v: config.version }, w.memory || {});
        const res = spawn.spawnCreep(body, name, { memory, directions: spawnDirections(room, spawn) });
        if (res === OK) {
            rh.waitRole = null;
            util.log(room.name + ': spawning ' + name + ' (' + body.length + ' parts, ' + cost + 'e)' +
                (w.home && w.home !== room.name ? ' for ' + w.home : ''));
            w.have++;
            if (!usable.length) return;
        } else {
            if (!rh.spawnErrAt || Game.time - rh.spawnErrAt > 100) {
                rh.spawnErrAt = Game.time;
                util.warn(room.name + ': spawnCreep ' + w.role + ' failed with ' + res);
            }
            return;
        }
    }
}

module.exports = { run, wants, spawnDirections };
