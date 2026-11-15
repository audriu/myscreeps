/**
 * Offensive squads. Driven entirely from the console through Memory.war
 * (see config.war for the switches). This module keeps the shared state:
 * which room is the rally point, whether the squad has gathered, whether
 * the target has been cleared. Spawning lives in spawner.js (role
 * 'soldier'), behaviour in roles.js.
 */
const config = require('config');
const util = require('util');
const roomState = require('roomState');

const KINDS = ['melee', 'ranged', 'healer'];

function state() {
    const w = Memory.war;
    if (!w || typeof w !== 'object') return null;
    return w;
}

/** Every soldier alive (spawning ones included), optionally only one kind. */
function soldiers(kind) {
    return util.cache('war|soldiers|' + (kind || ''), () => {
        const out = [];
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            if (c.memory.role !== 'soldier') continue;
            if (kind && c.memory.kind !== kind) continue;
            out.push(c);
        }
        return out;
    });
}

/** Soldiers the room should hold while mustering, split by kind. */
function composition(st) {
    const cfg = config.war;
    const total = cfg.maxPerRoom;
    const healers = Math.round(total * cfg.healers);
    const fighters = total - healers;
    const ranged = Math.round(fighters * cfg.ranged);
    return { melee: fighters - ranged, ranged, healer: healers };
}

/**
 * Low-energy muster (Memory.war.cheap = true, or a number for the floor):
 * the storage gate is dropped, soldiers are built from whatever energy the
 * room holds once it reaches the floor, and the terminal reserve is spent.
 * Returns the energy floor for this room, or 0 when the mode is off.
 */
function cheapFloor(st) {
    const w = state();
    if (!w || !w.cheap) return 0;
    const floor = typeof w.cheap === 'number' && w.cheap > 0 ? w.cheap : config.war.cheapMin;
    return st ? Math.min(st.cap, floor) : floor;
}

/** Energy haulers leave in a terminal: none while a low-energy muster is on. */
function terminalKeep() {
    return cheapFloor() ? 0 : config.terminal.keep;
}

/** Does this room take part in the war effort right now? */
function roomEligible(st) {
    const cfg = config.war;
    if (st.rcl < cfg.minRcl || st.bootstrap || !st.activeSpawns.length) return false;
    if (!cheapFloor(st) && st.storage && (st.storage.store[RESOURCE_ENERGY] || 0) < cfg.minStorage) return false;
    return true;
}

/** Owned room closest to the target (linear distance), the staging area. */
function pickRally(target) {
    const owned = util.ownedRooms();
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < owned.length; i++) {
        const name = owned[i].name;
        if (util.isAvoided(name)) continue;
        const d = Game.map.getRoomLinearDistance(name, target);
        if (d < bestD) {
            bestD = d;
            best = name;
        }
    }
    return best;
}

function rallyPos(w) {
    const room = w.rally && Game.rooms[w.rally];
    if (!room || !room.controller || !room.controller.my) return null;
    return roomState.get(room).anchor;
}

/* ------------------------------------------------------------------ */
/* Controller attack (Memory.war.unclaim = true)                        */
/* ------------------------------------------------------------------ */

/** Every unclaimer alive (spawning ones included). */
function unclaimers() {
    return util.cache('war|unclaimers', () => {
        const out = [];
        for (const name in Game.creeps) if (Game.creeps[name].memory.role === 'unclaimer') out.push(Game.creeps[name]);
        return out;
    });
}

/** Someone other than us owns or reserves this controller. */
function enemyController(ctrl) {
    if (!ctrl || ctrl.my) return false;
    if (ctrl.owner) return true;
    return !!(ctrl.reservation && !util.isOwned(ctrl.pos.roomName) && ctrl.reservation.username !== myName());
}

function myName() {
    for (const n in Game.spawns) return Game.spawns[n].owner.username;
    return null;
}

/** CLAIM parts a room can put into one unclaimer (CLAIM+MOVE pairs at 650 each). */
function unclaimParts(cap) {
    return Math.min(25, Math.floor(cap / (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])));
}

/** Unclaimers per strike: Memory.war.unclaim = 4 (true means 1). */
function unclaimCount(w) {
    const n = typeof w.unclaim === 'number' ? Math.floor(w.unclaim) : 1;
    return util.clamp(n, 1, 8); // 8 tiles around a controller
}

/**
 * Spawn rooms for the unclaimers, one per slot. Rooms within reach of the
 * target are ranked by CLAIM parts (nearest on ties); rooms with less than
 * half the best room's parts are left out, and the strong rooms take turns
 * when there are more slots than rooms.
 */
function pickUnclaimFrom(target, count) {
    const owned = util.ownedRooms();
    const cands = [];
    for (let i = 0; i < owned.length; i++) {
        const st = roomState.get(owned[i]);
        if (st.bootstrap || !st.activeSpawns.length) continue;
        const d = Game.map.getRoomLinearDistance(st.name, target);
        if (d > config.war.unclaimRange) continue;
        const parts = unclaimParts(st.cap);
        if (parts) cands.push({ name: st.name, parts, d });
    }
    cands.sort((a, b) => (b.parts - a.parts) || (a.d - b.d));
    const strong = cands.filter(c => c.parts * 2 >= cands[0].parts);
    const out = [];
    for (let i = 0; i < count && strong.length; i++) out.push(strong[i % strong.length].name);
    return out;
}

/** Keep the unclaim plan current: spawn rooms, when the controller opens, done. Runs from war.run(). */
function planUnclaim(w) {
    const tRoom = Game.rooms[w.target];
    const ctrl = tRoom && tRoom.controller;
    if (tRoom) {
        if (!enemyController(ctrl)) {
            if (!w.unclaimDone) {
                w.unclaimDone = Game.time;
                util.warn('WAR: the controller in ' + w.target + ' is no longer theirs');
                Game.notify('War: ' + w.target + ' controller is neutral now (' + (w.unclaimHits || 0) + ' controller attacks)');
            }
            return;
        }
        delete w.unclaimDone;
        const wait = Math.max(ctrl.upgradeBlocked || 0, ctrl.safeMode || 0);
        w.unclaimAt = Game.time + wait;
        if (wait) delete w.unclaimReady;
        w.unclaimLeft = ctrl.level ? ctrl.level + ':' + ctrl.ticksToDowngrade : null;
        // What the last strike really took off (all hits of one tick add up).
        const s = w.unclaimStrike;
        if (s && Game.time > s.t) {
            const took = s.before - ctrl.ticksToDowngrade - (Game.time - s.t);
            util.log('WAR: strike on ' + w.target + ' by ' + s.creeps + ' unclaimer(s), ' + s.parts + ' CLAIM: -' + took +
                ' ticks (expected -' + s.parts * CONTROLLER_CLAIM_DOWNGRADE + '), ' + ctrl.ticksToDowngrade + ' left at RCL' + ctrl.level);
            delete w.unclaimStrike;
        }
    }
    const count = unclaimCount(w);
    const from = Array.isArray(w.unclaimFrom) ? w.unclaimFrom : [];
    if (from.length !== count || Game.time % 500 === 0 || from.some(r => !util.isOwned(r))) {
        const next = pickUnclaimFrom(w.target, count);
        if (next.join() !== from.join()) {
            util.log('WAR: ' + count + ' unclaimer(s) for ' + w.target + ' from ' + (next.join(', ') || 'nowhere (no room in range can afford CLAIM)'));
        }
        w.unclaimFrom = next;
    }
}

/** Unclaimers of this target that have not struck yet and can still make it. */
function unclaimTeam(target) {
    return util.cache('war|unclaimTeam|' + target, () => unclaimers().filter(c =>
        c.memory.targetRoom === target && !c.memory.struck && (c.spawning || c.ticksToLive > 50)));
}

/**
 * Strike now? Hits only add up within one tick (the 1000-tick block starts
 * after it), so the team waits at the controller until all of them stand
 * there. It strikes early when a waiting member is about to die of old age,
 * or unclaimSync ticks after the first one got there.
 */
function unclaimGo(w, ctrl) {
    if (ctrl.upgradeBlocked || ctrl.safeMode) return false;
    const team = unclaimTeam(w.target);
    let ready = 0;
    let dying = false;
    for (let i = 0; i < team.length; i++) {
        const c = team[i];
        if (c.spawning || !c.pos.isNearTo(ctrl)) continue;
        ready++;
        if (c.ticksToLive <= 60) dying = true;
    }
    if (!ready) return false;
    if (!w.unclaimReady || w.unclaimReady > Game.time) w.unclaimReady = Game.time;
    if (ready === team.length || dying) return true;
    return Game.time - w.unclaimReady >= config.war.unclaimSync;
}

/** Spawn request for this room's unclaimers, or null. Timed so they reach the controller as the block ends. */
function unclaimWant(st) {
    const w = state();
    if (!w || !w.target || !w.unclaim || w.unclaimDone || !Array.isArray(w.unclaimFrom)) return null;
    let slots = 0;
    for (let i = 0; i < w.unclaimFrom.length; i++) if (w.unclaimFrom[i] === st.name) slots++;
    if (!slots) return null;
    if (w.unclaimAt && w.unclaimAt - Game.time > config.war.unclaimLead) return null;
    const team = unclaimTeam(w.target);
    let have = 0;
    for (let i = 0; i < team.length; i++) if (team[i].memory.from === st.name) have++;
    if (have >= slots) return null;
    // The whole team must be out within unclaimWindow ticks or the first ones die
    // waiting (a CLAIM creep lives 600 ticks): one spawn, five slots -> 11 CLAIM each.
    const spawns = Math.max(1, st.activeSpawns.length);
    const maxClaim = Math.max(1, Math.floor(config.war.unclaimWindow * spawns / (CREEP_SPAWN_TIME * 2 * slots)));
    // Late members only waste energy: skip one that cannot reach the controller
    // before the team has to strike (its oldest member about to expire, or the
    // sync wait over).
    let deadline = Infinity;
    for (let i = 0; i < team.length; i++) {
        if (!team[i].spawning) deadline = Math.min(deadline, Game.time + team[i].ticksToLive - 60);
    }
    if (w.unclaimReady) deadline = Math.min(deadline, w.unclaimReady + config.war.unclaimSync);
    const eta = Game.time + maxClaim * 2 * CREEP_SPAWN_TIME + (Game.map.getRoomLinearDistance(st.name, w.target) + 1) * 60;
    if (eta > deadline) return null;
    return {
        role: 'unclaimer',
        count: slots,
        have,
        priority: config.war.priority + 10,
        shrink: false,
        memory: { targetRoom: w.target, from: st.name },
        body: e => {
            const n = Math.max(1, Math.min(maxClaim, unclaimParts(e)));
            const body = [];
            for (let i = 0; i < n; i++) body.push(CLAIM);
            for (let i = 0; i < n; i++) body.push(MOVE);
            return body;
        },
    };
}

/** Never worth hitting: the controller, roads, portals, keeper lairs, and power banks (they hit back). */
const SWEEP_SKIP = {
    [STRUCTURE_CONTROLLER]: true,
    [STRUCTURE_ROAD]: true,
    [STRUCTURE_PORTAL]: true,
    [STRUCTURE_KEEPER_LAIR]: true,
    [STRUCTURE_POWER_BANK]: true,
};

/** Structures that are never spared for what they hold: they shoot, make defenders (spawns and the extensions feeding them), block our spawn, or nuke. */
const ALWAYS_KILL = {
    [STRUCTURE_TOWER]: true,
    [STRUCTURE_SPAWN]: true,
    [STRUCTURE_EXTENSION]: true,
    [STRUCTURE_NUKER]: true,
};

/**
 * Harmless structure (not ours) still holding energy or any other resource
 * (config.war.spareEnergy): left standing so it is there when we settle the room.
 */
function sparesEnergy(s) {
    if (!config.war.spareEnergy || s.my || ALWAYS_KILL[s.structureType] || !s.store) return false;
    for (const r in s.store) if (s.store[r] > 0) return true;
    return false;
}

/**
 * Final sweep (config.war.finalSweep): every structure in the room with hit
 * points that is not ours: ramparts, walls, containers, covered and
 * ownerless leftovers. Roads and harmless structures holding energy or resources stay.
 * Never in our own rooms.
 */
function sweepTargets(room) {
    if (!config.war.finalSweep || (room.controller && room.controller.my)) return [];
    return util.find(room, FIND_STRUCTURES, 'sweep', s => !s.my && s.hits != null && !SWEEP_SKIP[s.structureType] && !sparesEnergy(s));
}

/** Anything left to kill in the target room (needs vision). */
function remainingTargets(roomName) {
    const room = Game.rooms[roomName];
    if (!room) return null;
    const creeps = room.find(FIND_HOSTILE_CREEPS).length;
    if (config.war.finalSweep && !(room.controller && room.controller.my)) return creeps + sweepTargets(room).length;
    let structs = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType !== STRUCTURE_CONTROLLER && s.hits != null && !sparesEnergy(s),
    }).length;
    if (config.war.razeAll) {
        structs += room.find(FIND_STRUCTURES, {
            filter: s => !s.my && s.structureType === STRUCTURE_CONTAINER && !sparesEnergy(s),
        }).length;
    }
    if (unrestricted(roomName)) structs += room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_WALL }).length;
    return creeps + structs;
}

function run() {
    const w = state();
    if (!w) return;
    if (w.target && !util.roomCoords(w.target)) {
        util.warn('Memory.war.target "' + w.target + '" is not a room name; clearing it');
        delete w.target;
    }
    if (!w.target) {
        delete w.unclaimFrom;
        delete w.unclaimReady;
        delete w.unclaimStrike;
        delete w.unclaimAt;
        delete w.unclaimDone;
        delete w.unclaimLeft;
        delete w.safeUntil;
        delete w.rally;
        delete w.go;
        delete w.wave;
        delete w.since;
        delete w.cleared;
        return;
    }
    const cfg = config.war;
    const all = soldiers();
    if (!w.since) {
        w.since = Game.time;
        if (!w.wave) w.wave = Math.max(1, all.length);
        util.warn('WAR: target ' + w.target + ' set with ' + all.length + ' soldier(s) alive');
        Game.notify('War: target ' + w.target + ' set with ' + all.length + ' soldiers');
    }
    if (!w.rally || !util.isOwned(w.rally)) {
        w.rally = pickRally(w.target);
        if (w.rally) util.log('WAR: rally room ' + w.rally);
    }
    if (!w.go) {
        const pos = rallyPos(w);
        let gathered = 0;
        if (pos) {
            for (let i = 0; i < all.length; i++) {
                const c = all[i];
                if (!c.spawning && c.pos.roomName === pos.roomName && c.pos.inRangeTo(pos, 8)) gathered++;
            }
        }
        const need = Math.ceil(w.wave * cfg.gatherShare);
        const waited = Game.time - w.since;
        if (gathered && (gathered >= need || waited > cfg.maxGather || !pos)) {
            w.go = Game.time;
            util.warn('WAR: ' + gathered + ' soldier(s) gathered, marching on ' + w.target);
            Game.notify('War: marching on ' + w.target + ' with ' + gathered + ' soldiers');
        } else if (Game.time % 50 === 0) {
            util.log('WAR: gathering at ' + (w.rally || '?') + ' ' + gathered + '/' + need + ' (' + waited + ' ticks)');
        }
    }
    // Safe mode blocks every hostile action: wait it out at the rally room instead of feeding the towers.
    const tRoom = Game.rooms[w.target];
    if (tRoom && tRoom.controller && tRoom.controller.safeMode) {
        const until = Game.time + tRoom.controller.safeMode;
        if (!w.safeUntil || Math.abs(w.safeUntil - until) > 5) {
            w.safeUntil = until;
            util.warn('WAR: ' + w.target + ' is in safe mode for ' + tRoom.controller.safeMode + ' ticks; squad waits at ' + (w.rally || 'home'));
            Game.notify('War: ' + w.target + ' is in safe mode for ' + tRoom.controller.safeMode + ' ticks, squad waiting');
        }
    } else if (w.safeUntil && (tRoom || Game.time > w.safeUntil)) {
        delete w.safeUntil;
        util.warn('WAR: safe mode in ' + w.target + ' is over; resuming');
        Game.notify('War: safe mode in ' + w.target + ' over, squad resuming');
    }
    if (w.unclaim) planUnclaim(w);
    const left = remainingTargets(w.target);
    if (left === 0 && !w.cleared) {
        w.cleared = Game.time;
        util.warn('WAR: ' + w.target + ' cleared; soldiers hold the room');
        Game.notify('War: ' + w.target + ' cleared, nothing hostile left');
    } else if (left > 0 && w.cleared) {
        delete w.cleared;
    }
    if (Game.time % config.logEvery === 0) {
        let inTarget = 0;
        for (let i = 0; i < all.length; i++) if (all[i].pos.roomName === w.target) inTarget++;
        util.log('WAR: ' + (w.safeUntil ? 'waiting (safe mode ' + (w.safeUntil - Game.time) + ')' : w.go ? 'attacking' : 'gathering') + ' ' + w.target + ' soldiers=' + all.length +
            ' inTarget=' + inTarget + (left == null ? ' (no vision)' : ' hostilesLeft=' + left) +
            (w.muster ? '' : ' (muster off: no reinforcements)') +
            (w.unclaim ? ' unclaim=' + (w.unclaimDone ? 'done' : 'RCL' + (w.unclaimLeft || '?') + ' hits=' + (w.unclaimHits || 0) + ' x' + unclaimCount(w) + ' from=' + (Array.isArray(w.unclaimFrom) ? w.unclaimFrom.join('+') : '-')) : ''));
    }
}

/* ------------------------------------------------------------------ */
/* The way in (config.war.breach)                                      */
/* ------------------------------------------------------------------ */

const FAR = 1e7;
const DX = [0, 1, 1, 1, 0, -1, -1, -1];   // TOP .. TOP_LEFT
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const WALL_TICKS_MAX = 20000;             // no wall counts for more ticks than this
const MIN_DPS = 60;                       // what a squad is taken to deal at the least (two ATTACK parts)

/** What a creep takes off a wall per tick: live ATTACK and RANGED_ATTACK parts, boosts included. */
function power(creep) {
    let n = 0;
    const body = creep.body;
    for (let i = 0; i < body.length; i++) {
        const p = body[i];
        if (p.hits <= 0) continue;
        if (p.type === ATTACK) n += ATTACK_POWER * ((p.boost && BOOSTS[ATTACK][p.boost] && BOOSTS[ATTACK][p.boost].attack) || 1);
        else if (p.type === RANGED_ATTACK) n += RANGED_ATTACK_POWER * ((p.boost && BOOSTS[RANGED_ATTACK][p.boost] && BOOSTS[RANGED_ATTACK][p.boost].rangedAttack) || 1);
    }
    return n;
}

/**
 * Damage per tick the squad puts on one wall: its two strongest soldiers in the room (a gap is
 * rarely wider, and the strongest work their way to the front). The figure only follows the
 * squad when it is off by a quarter, so one death or arrival does not turn everybody around.
 */
function squadDps(room) {
    const list = util.find(room, FIND_MY_CREEPS, 'soldiers', c => c.memory.role === 'soldier');
    let a = 0;
    let b = 0;
    for (let i = 0; i < list.length; i++) {
        const p = power(list[i]);
        if (p > a) {
            b = a;
            a = p;
        } else if (p > b) b = p;
    }
    const dps = Math.max(MIN_DPS, a + b);
    const h = util.roomHeap(room.name);
    if (h.siegeDps && Math.abs(dps - h.siegeDps) < h.siegeDps * 0.25) return h.siegeDps;
    h.siegeDps = dps;
    return dps;
}

function heapPush(h, v) {
    let i = h.length;
    h.push(v);
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p] <= v) break;
        h[i] = h[p];
        i = p;
    }
    h[i] = v;
}

function heapPop(h) {
    const top = h[0];
    const last = h.pop();
    const n = h.length;
    if (n) {
        let i = 0;
        for (;;) {
            let c = 2 * i + 1;
            if (c >= n) break;
            if (c + 1 < n && h[c + 1] < h[c]) c++;
            if (h[c] >= last) break;
            h[i] = h[c];
            i = c;
        }
        h[i] = last;
    }
    return top;
}

/**
 * One search for the whole squad (cached for the tick): for every tile of the room the ticks it
 * takes to get next to the nearest target, and the tile to step on next. Plains and roads cost a
 * tick, swamp five. A wall or a hostile rampart can be gone through too: it costs its hits
 * divided by what the squad deals per tick. So the way leads around a wall when that is quicker
 * and through its weakest spot when it is not, and a soldier's target is the one nearest by that
 * cost, not the one nearest in a straight line behind a wall.
 *
 * goals: what the soldiers are after this tick (creeps and structures). Returns null when the
 * search failed; the caller then falls back to the straight-line choice.
 */
function plan(room, goals) {
    return util.cache(room.name + '|warPlan', () => {
        try {
            return buildPlan(room, goals);
        } catch (e) {
            util.error('war plan for ' + room.name + ': ' + (e && e.stack ? e.stack : e));
            return null;
        }
    });
}

function buildPlan(room, goals) {
    const terrain = util.terrain(room.name);
    const dps = squadDps(room);
    const enter = new Float64Array(2500);   // ticks to step onto a tile; 0: nobody ever stands there
    const goalAt = {};                      // tile -> target
    const bar = {};                         // tile -> the wall or rampart that has to go first
    const debt = {};                        // tile -> hits to take down before it opens
    const hard = {};                        // tile -> blocked by something we do not break
    // Exit tiles are left out: a creep standing on one is carried off to the next room.
    for (let y = 1; y < 49; y++) {
        for (let x = 1; x < 49; x++) {
            const t = terrain.get(x, y);
            enter[y * 50 + x] = (t & TERRAIN_MASK_WALL) ? 0 : ((t & TERRAIN_MASK_SWAMP) ? 5 : 1);
        }
    }
    for (let i = 0; i < goals.length; i++) {
        const k = goals[i].pos.y * 50 + goals[i].pos.x;
        if (!goalAt[k]) goalAt[k] = goals[i];
    }
    const structs = util.find(room, FIND_STRUCTURES);
    for (let i = 0; i < structs.length; i++) {
        const s = structs[i];
        const k = s.pos.y * 50 + s.pos.x;
        const type = s.structureType;
        if (type === STRUCTURE_ROAD) {
            if (enter[k]) enter[k] = 1;
        } else if (type === STRUCTURE_RAMPART) {
            // The rampart takes every hit aimed at its tile, so it is the thing to hit there.
            if (s.my || s.isPublic) continue;
            debt[k] = (debt[k] || 0) + s.hits;
            bar[k] = s;
        } else if (type === STRUCTURE_PORTAL) {
            hard[k] = true;
        } else if (util.isBlockingStructure(s) && goalAt[k] !== s) {
            // Walls, and what stands under a rampart, are broken; the controller, what we
            // spare for its contents and anything of ours stay where they are.
            if (s.hits > 0 && !s.my && (type === STRUCTURE_WALL || (s.owner && !sparesEnergy(s)))) {
                debt[k] = (debt[k] || 0) + s.hits;
                if (!bar[k]) bar[k] = s;
            } else hard[k] = true;
        }
    }
    const fixed = util.find(room, FIND_SOURCES).concat(util.find(room, FIND_MINERALS));
    for (let i = 0; i < fixed.length; i++) hard[fixed[i].pos.y * 50 + fixed[i].pos.x] = true;
    for (const k in debt) if (enter[k]) enter[k] = 1 + Math.min(WALL_TICKS_MAX, Math.ceil(debt[k] / dps));
    for (const k in hard) {
        enter[k] = 0;
        delete bar[k];
    }

    // Dijkstra outward from the targets. dist: ticks from a tile until a soldier stands next to
    // a target (the tile's own cost not counted); next: the tile to step on from there.
    const dist = new Float64Array(2500).fill(FAR);
    const next = new Int16Array(2500).fill(-1);
    const heap = [];
    for (const k in goalAt) {
        dist[k] = 0;
        heapPush(heap, +k);
    }
    while (heap.length) {
        const key = heapPop(heap);
        const u = key % 4096;
        const d = (key - u) / 4096;
        if (d > dist[u]) continue;
        const step = d + (goalAt[u] ? 0 : enter[u]);
        const ux = u % 50;
        const uy = (u - ux) / 50;
        for (let i = 0; i < 8; i++) {
            const x = ux + DX[i];
            const y = uy + DY[i];
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            const w = y * 50 + x;
            if (!enter[w] || step >= dist[w]) continue;
            dist[w] = step;
            next[w] = u;
            heapPush(heap, step * 4096 + w);
        }
    }
    return { room, dps, enter, goalAt, bar, dist, next, ways: {}, region: null };
}

/** The best tile next to this one to go on from: for a creep on an exit tile or in a corner the search left out. */
function nearby(p, k) {
    const kx = k % 50;
    const ky = (k - kx) / 50;
    let best = -1;
    let bestCost = FAR;
    for (let i = 0; i < 8; i++) {
        const x = kx + DX[i];
        const y = ky + DY[i];
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;
        const w = y * 50 + x;
        if (p.goalAt[w]) return w;
        if (!p.enter[w] || p.dist[w] >= FAR) continue;
        const c = p.dist[w] + p.enter[w];
        if (c < bestCost) {
            bestCost = c;
            best = w;
        }
    }
    return best;
}

/**
 * What lies ahead of a creep standing at pos: { goal } when the nearest target can be walked
 * to, { barrier, tile } when a wall or rampart has to go first (the first one on the way), or
 * null when there is no way at all. cost: ticks to get there.
 */
function way(p, pos) {
    const start = pos.y * 50 + pos.x;
    if (start in p.ways) return p.ways[start];
    let res = null;
    if (p.goalAt[start]) res = { goal: p.goalAt[start], barrier: null, tile: start, cost: 0 };
    else {
        let k = p.dist[start] < FAR ? start : nearby(p, start);
        const cost = k >= 0 ? p.dist[k] : FAR;
        for (let n = 0; k >= 0 && n < 2500; n++) {
            if (k !== start) {
                if (p.goalAt[k]) {
                    res = { goal: p.goalAt[k], barrier: null, tile: k, cost };
                    break;
                }
                if (p.bar[k]) {
                    res = { goal: null, barrier: p.bar[k], tile: k, cost };
                    break;
                }
            }
            k = p.next[k];
        }
    }
    return (p.ways[start] = res);
}

/** The next tile on the way from pos: { x, y, k }, or null. */
function step(p, pos) {
    const start = pos.y * 50 + pos.x;
    const k = p.dist[start] < FAR ? p.next[start] : nearby(p, start);
    if (k < 0) return null;
    return { x: k % 50, y: (k - k % 50) / 50, k };
}

/**
 * A free tile next to pos that is nearer the target than pos itself, the nearest such: the way
 * around somebody standing on the direct line. { x, y, k } or null.
 */
function around(p, pos) {
    const start = pos.y * 50 + pos.x;
    const at = occupants(p.room);
    let best = -1;
    let bestCost = p.dist[start];
    for (let i = 0; i < 8; i++) {
        const x = pos.x + DX[i];
        const y = pos.y + DY[i];
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        const w = y * 50 + x;
        if (!p.enter[w] || p.bar[w] || p.goalAt[w] || at[w] || p.dist[w] >= bestCost) continue;
        bestCost = p.dist[w];
        best = w;
    }
    if (best < 0) return null;
    return { x: best % 50, y: (best - best % 50) / 50, k: best };
}

/** The wall or rampart next to pos that it is cheapest to go on through, or null. */
function beside(p, pos) {
    let best = null;
    let bestCost = FAR;
    for (let i = 0; i < 8; i++) {
        const x = pos.x + DX[i];
        const y = pos.y + DY[i];
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        const w = y * 50 + x;
        if (!p.bar[w] || p.goalAt[w]) continue;
        const c = p.enter[w] + p.dist[w];
        if (c < bestCost) {
            bestCost = c;
            best = p.bar[w];
        }
    }
    return best;
}

/** Tiles that can be walked between without breaking anything carry the same number (0: not walkable). */
function regions(p) {
    if (p.region) return p.region;
    const region = p.region = new Int16Array(2500);
    const open = k => p.enter[k] > 0 && !p.bar[k] && !(p.goalAt[k] && p.goalAt[k].structureType && util.isBlockingStructure(p.goalAt[k]));
    let n = 0;
    const queue = [];
    for (let s = 0; s < 2500; s++) {
        if (region[s] || !open(s)) continue;
        region[s] = ++n;
        queue.length = 0;
        queue.push(s);
        for (let q = 0; q < queue.length; q++) {
            const kx = queue[q] % 50;
            const ky = (queue[q] - kx) / 50;
            for (let i = 0; i < 8; i++) {
                const x = kx + DX[i];
                const y = ky + DY[i];
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                const w = y * 50 + x;
                if (region[w] || !open(w)) continue;
                region[w] = n;
                queue.push(w);
            }
        }
    }
    return region;
}

/** Every creep in the room by tile (per-tick cache). */
function occupants(room) {
    return util.cache(room.name + '|occupants', () => {
        const out = {};
        const list = util.find(room, FIND_CREEPS);
        for (let i = 0; i < list.length; i++) out[list[i].pos.y * 50 + list[i].pos.x] = list[i];
        return out;
    });
}

/**
 * A free tile next to the wall at `tile` that a creep at pos can walk to (its side of the
 * wall, nobody standing on it), the nearest one; null when every place is taken.
 */
function freeSpot(p, pos, tile) {
    const region = regions(p);
    const start = pos.y * 50 + pos.x;
    let mine = region[start];
    if (!mine) {
        const k = nearby(p, start);
        mine = k >= 0 ? region[k] : 0;
    }
    if (!mine) return null;
    const at = occupants(p.room);
    const tx = tile % 50;
    const ty = (tile - tx) / 50;
    let best = null;
    let bestRange = Infinity;
    for (let i = 0; i < 8; i++) {
        const x = tx + DX[i];
        const y = ty + DY[i];
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        const w = y * 50 + x;
        if (region[w] !== mine || at[w]) continue;
        const range = Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y));
        if (range < bestRange) {
            bestRange = range;
            best = new RoomPosition(x, y, p.room.name);
        }
    }
    return best;
}

/** Nothing spared in this room: walls and rampart-covered structures are ordinary targets. */
function unrestricted(roomName) {
    const w = state();
    if (w && w.everything) return true;
    const list = config.war.unrestrictedRooms || [];
    return list.indexOf(roomName) !== -1;
}

/** Target under safe mode (known from vision or remembered until it expires). */
function safeModeActive(w) {
    return !!(w && w.safeUntil && Game.time < w.safeUntil);
}

module.exports = { KINDS, state, soldiers, composition, roomEligible, cheapFloor, terminalKeep, unclaimWant, unclaimGo, enemyController, sparesEnergy, sweepTargets, rallyPos, safeModeActive, unrestricted, power, plan, way, step, around, beside, freeSpot, occupants, run };
