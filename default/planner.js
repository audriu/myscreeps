/**
 * Room layout planner. Idempotent: counts what exists, places what is missing.
 *
 * Rules that keep the base usable:
 *  - nothing non-walkable is ever placed next to a spawn;
 *  - blocking structures go on a checkerboard around the anchor so every
 *    structure stays reachable through diagonal lanes;
 *  - active spawns that are boxed in get cheap neighbours (extensions, walls,
 *    links) destroyed until they have exits again.
 */
const config = require('config');
const util = require('util');

const PLAN = config.planner;

// Lower rank = cheaper to lose when freeing a spawn.
const DESTROY_RANK = {
    [STRUCTURE_EXTENSION]: 1,
    [STRUCTURE_WALL]: 1,
    [STRUCTURE_LINK]: 2,
    [STRUCTURE_LAB]: 3,
    [STRUCTURE_OBSERVER]: 3,
    [STRUCTURE_NUKER]: 3,
    [STRUCTURE_FACTORY]: 4,
    [STRUCTURE_POWER_SPAWN]: 4,
    [STRUCTURE_TOWER]: 5,
};

function idx(x, y) {
    return y * 50 + x;
}

function inBounds(x, y, margin) {
    margin = margin || 0;
    return x >= margin && x <= 49 - margin && y >= margin && y <= 49 - margin;
}

function ring(cx, cy, d) {
    const out = [];
    if (d === 0) return [{ x: cx, y: cy }];
    for (let x = cx - d; x <= cx + d; x++) {
        out.push({ x, y: cy - d });
        out.push({ x, y: cy + d });
    }
    for (let y = cy - d + 1; y <= cy + d - 1; y++) {
        out.push({ x: cx - d, y });
        out.push({ x: cx + d, y });
    }
    return out;
}

function chebyshev(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

function buildContext(room, st) {
    const name = room.name;
    const terrain = util.terrain(name);
    const blocked = new Uint8Array(2500);
    const occupied = new Uint8Array(2500);
    const road = new Uint8Array(2500);
    const rampart = new Uint8Array(2500);

    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) blocked[idx(x, y)] = 1;
        }
    }

    const byType = st.byType;
    const count = {};
    for (const type in byType) {
        const list = byType[type];
        count[type] = (count[type] || 0) + list.length;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            const k = idx(s.pos.x, s.pos.y);
            if (util.isBlockingStructure(s)) blocked[k] = 1;
            if (type === STRUCTURE_RAMPART) rampart[k] = 1;
            else occupied[k] = 1;
            if (type === STRUCTURE_ROAD) road[k] = 1;
        }
    }

    // Miners park on source containers for life: those tiles are obstacles.
    for (let i = 0; i < st.sources.length; i++) {
        const c = st.sources[i].container;
        if (c) blocked[idx(c.pos.x, c.pos.y)] = 1;
    }

    const siteAt = {};
    for (let i = 0; i < st.sites.length; i++) {
        const s = st.sites[i];
        const k = idx(s.pos.x, s.pos.y);
        count[s.structureType] = (count[s.structureType] || 0) + 1;
        siteAt[k] = s.structureType;
        if (util.isBlockingType(s.structureType)) blocked[k] = 1;
        if (s.structureType === STRUCTURE_RAMPART) rampart[k] = 1;
        else occupied[k] = 1;
        if (s.structureType === STRUCTURE_ROAD) road[k] = 1;
    }

    const spawnPos = [];
    for (let i = 0; i < st.spawns.length; i++) spawnPos.push({ x: st.spawns[i].pos.x, y: st.spawns[i].pos.y });
    for (let i = 0; i < st.sites.length; i++) {
        if (st.sites[i].structureType === STRUCTURE_SPAWN) spawnPos.push({ x: st.sites[i].pos.x, y: st.sites[i].pos.y });
    }

    const anchor = st.anchor;
    const mineral = util.find(room, FIND_MINERALS)[0] || null;

    const ctx = {
        room,
        st,
        terrain,
        blocked,
        occupied,
        road,
        rampart,
        count,
        siteAt,
        spawnPos,
        anchor,
        mineral,
        parity: (anchor.x + anchor.y) % 2,
        reach: null,
        sitesFull: false,
    };
    ctx.reach = computeReach(ctx);
    return ctx;
}

/** Flood fill of walkable tiles starting next to spawns and the controller. */
/**
 * The main region: walkable tiles connected to the controller area. Every
 * spawn exit, source and structure must touch it. If the controller sits in a
 * tiny pocket, the source areas are used as seeds instead.
 */
function computeReach(ctx, withSources) {
    const reach = new Uint8Array(2500);
    const queue = [];
    const seed = (x, y) => {
        if (!inBounds(x, y) || ctx.blocked[idx(x, y)] || reach[idx(x, y)]) return;
        reach[idx(x, y)] = 1;
        queue.push(x, y);
    };
    if (ctx.st.ctrl && !withSources) {
        const r = ring(ctx.st.ctrl.pos.x, ctx.st.ctrl.pos.y, 1);
        for (let j = 0; j < r.length; j++) seed(r[j].x, r[j].y);
    } else {
        for (let i = 0; i < ctx.st.sources.length; i++) {
            const r = ring(ctx.st.sources[i].pos.x, ctx.st.sources[i].pos.y, 1);
            for (let j = 0; j < r.length; j++) seed(r[j].x, r[j].y);
        }
    }
    for (let q = 0; q < queue.length; q += 2) {
        const x = queue[q];
        const y = queue[q + 1];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx || dy) seed(x + dx, y + dy);
            }
        }
    }
    if (!withSources && queue.length < 300) return computeReach(ctx, true);
    return reach;
}

function nearSpawn(ctx, x, y, range) {
    for (let i = 0; i < ctx.spawnPos.length; i++) {
        if (chebyshev(x, y, ctx.spawnPos[i].x, ctx.spawnPos[i].y) <= range) return true;
    }
    return false;
}

function nearImportant(ctx, x, y, ctrlMin, accessOk) {
    const st = ctx.st;
    for (let i = 0; i < st.sources.length; i++) {
        if (chebyshev(x, y, st.sources[i].pos.x, st.sources[i].pos.y) < 2) return true;
    }
    if (ctx.mineral && chebyshev(x, y, ctx.mineral.pos.x, ctx.mineral.pos.y) < 2) return true;
    if (st.ctrl && chebyshev(x, y, st.ctrl.pos.x, st.ctrl.pos.y) < ctrlMin) return true;
    if (accessOk) return false;
    // Containers and links are access points: keep their neighbours free.
    const access = (st.byType[STRUCTURE_CONTAINER] || []).concat(st.byType[STRUCTURE_LINK] || []);
    for (let i = 0; i < access.length; i++) {
        if (chebyshev(x, y, access[i].pos.x, access[i].pos.y) <= 1) return true;
    }
    for (const k in ctx.siteAt) {
        if (ctx.siteAt[k] !== STRUCTURE_CONTAINER && ctx.siteAt[k] !== STRUCTURE_LINK) continue;
        const sx = k % 50;
        const sy = (k - sx) / 50;
        if (chebyshev(x, y, sx, sy) <= 1) return true;
    }
    return false;
}

function lanes(ctx, x, y) {
    let n = 0;
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < 4; i++) {
        const nx = x + d[i][0];
        const ny = y + d[i][1];
        if (!inBounds(nx, ny)) continue;
        const k = idx(nx, ny);
        if (!ctx.blocked[k] && ctx.reach[k]) n++;
    }
    return n;
}

function walkableNeighbours(ctx, x, y, excludeX, excludeY) {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(nx, ny, 1)) continue;
            if (nx === excludeX && ny === excludeY) continue;
            if (!ctx.blocked[idx(nx, ny)]) n++;
        }
    }
    return n;
}

/** Can a blocking structure go here without hurting traffic? */
function canPlaceBlocking(ctx, x, y, opts) {
    opts = opts || {};
    if (!inBounds(x, y, 3)) return false;
    const k = idx(x, y);
    if (ctx.blocked[k] || ctx.occupied[k] || ctx.rampart[k]) return false;
    if (!opts.anyParity && (x + y) % 2 !== ctx.parity) return false;
    if (nearSpawn(ctx, x, y, 1)) return false;
    if (nearImportant(ctx, x, y, opts.ctrlMin != null ? opts.ctrlMin : 3, opts.accessOk)) return false;
    if (lanes(ctx, x, y) < (opts.minLanes != null ? opts.minLanes : 2)) return false;
    return true;
}

function place(ctx, type, x, y) {
    if (ctx.sitesFull) return false;
    const res = ctx.room.createConstructionSite(x, y, type);
    if (res === OK) {
        const k = idx(x, y);
        ctx.count[type] = (ctx.count[type] || 0) + 1;
        ctx.siteAt[k] = type;
        if (util.isBlockingType(type)) ctx.blocked[k] = 1;
        if (type === STRUCTURE_RAMPART) ctx.rampart[k] = 1;
        else ctx.occupied[k] = 1;
        if (type === STRUCTURE_ROAD) ctx.road[k] = 1;
        if (type === STRUCTURE_SPAWN) ctx.spawnPos.push({ x, y });
        return true;
    }
    if (res === ERR_FULL) ctx.sitesFull = true;
    return false;
}

function have(ctx, type) {
    return ctx.count[type] || 0;
}

function allowed(type, rcl) {
    const row = CONTROLLER_STRUCTURES[type];
    return row ? (row[rcl] || 0) : 0;
}

/* ------------------------------------------------------------------ */
/* One-time adoption                                                   */
/* ------------------------------------------------------------------ */

function adopt(room, st) {
    let removed = 0;
    for (let i = 0; i < st.sites.length; i++) {
        if (st.sites[i].remove() === OK) removed++;
    }
    const anchorSpawn = st.activeSpawns.length ? st.activeSpawns[0] : st.spawns[0];
    let anchor = anchorSpawn ? anchorSpawn.pos : findSpawnSpot(room, st);
    st.mem.plan = {
        ver: PLAN.version,
        anchor: anchor ? { x: anchor.x, y: anchor.y } : null,
        dirty: true,
        roadsAt: 0,
    };
    if (anchor) st.mem.plan.idle = findIdleSpot(room, st, anchor);
    util.log(room.name + ': planner v' + PLAN.version + ' adopted room (removed ' + removed +
        ' old sites, anchor ' + (anchor ? anchor.x + ',' + anchor.y : 'none') + ')');
}

/** Pick a spawn location for a room that has none: open ground between sources and controller. */
function findSpawnSpot(room, st) {
    const terrain = util.terrain(room.name);
    const ctrl = st.ctrl;
    const mineral = util.find(room, FIND_MINERALS)[0];
    const byType = st.byType;
    const occupied = {};
    for (const type in byType) {
        for (let i = 0; i < byType[type].length; i++) {
            const p = byType[type][i].pos;
            occupied[idx(p.x, p.y)] = true;
        }
    }
    const candidates = [];
    for (let y = 5; y <= 44; y++) {
        for (let x = 5; x <= 44; x++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            if (occupied[idx(x, y)]) continue;
            let score = 0;
            let bad = false;
            if (ctrl) {
                const d = chebyshev(x, y, ctrl.pos.x, ctrl.pos.y);
                if (d < 4) bad = true;
                score -= d;
            }
            for (let i = 0; i < st.sources.length; i++) {
                const d = chebyshev(x, y, st.sources[i].pos.x, st.sources[i].pos.y);
                if (d < 3) bad = true;
                score -= d;
            }
            if (mineral && chebyshev(x, y, mineral.pos.x, mineral.pos.y) < 3) bad = true;
            if (!bad) candidates.push({ x, y, score });
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(candidates.length, 400); i++) {
        const c = candidates[i];
        let walls = 0;
        for (let dx = -2; dx <= 2 && walls === 0; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (terrain.get(c.x + dx, c.y + dy) === TERRAIN_MASK_WALL) {
                    walls++;
                    break;
                }
            }
        }
        if (walls === 0) return new RoomPosition(c.x, c.y, room.name);
    }
    if (candidates.length) return new RoomPosition(candidates[0].x, candidates[0].y, room.name);
    return null;
}

/** An open patch of ground near the anchor where idle creeps wait without blocking lanes. */
function findIdleSpot(room, st, anchor) {
    const terrain = util.terrain(room.name);
    const parity = (anchor.x + anchor.y) % 2;
    const occupied = {};
    const byType = st.byType;
    for (const type in byType) {
        if (type === STRUCTURE_ROAD || type === STRUCTURE_RAMPART) continue;
        for (let i = 0; i < byType[type].length; i++) {
            const p = byType[type][i].pos;
            occupied[idx(p.x, p.y)] = true;
        }
    }
    let best = null;
    let bestScore = -Infinity;
    for (let d = 3; d <= 10; d++) {
        const r = ring(anchor.x, anchor.y, d);
        for (let i = 0; i < r.length; i++) {
            const p = r[i];
            if (!inBounds(p.x, p.y, 3)) continue;
            if ((p.x + p.y) % 2 === parity) continue;
            if (terrain.get(p.x, p.y) === TERRAIN_MASK_WALL || occupied[idx(p.x, p.y)]) continue;
            let nearSp = false;
            for (let s = 0; s < st.spawns.length; s++) {
                if (chebyshev(p.x, p.y, st.spawns[s].pos.x, st.spawns[s].pos.y) <= 2) nearSp = true;
            }
            if (nearSp) continue;
            // Openness: free tiles within range 2.
            let open = 0;
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    const x = p.x + dx;
                    const y = p.y + dy;
                    if (!inBounds(x, y, 1)) continue;
                    if (terrain.get(x, y) === TERRAIN_MASK_WALL || occupied[idx(x, y)]) continue;
                    open++;
                }
            }
            const score = open * 3 - d;
            if (score > bestScore) {
                bestScore = score;
                best = { x: p.x, y: p.y };
            }
            if (open >= 22 && d <= 5) return best;
        }
    }
    return best || { x: anchor.x, y: anchor.y };
}

/* ------------------------------------------------------------------ */
/* Spawn exits                                                         */
/* ------------------------------------------------------------------ */

/** Tiles permanently occupied by parked miners (source containers) are not exits. */
function isParkingTile(ctx, x, y) {
    const st = ctx.st;
    for (let i = 0; i < st.sources.length; i++) {
        const c = st.sources[i].container;
        if (c && c.pos.x === x && c.pos.y === y) return true;
        if (!c && chebyshev(x, y, st.sources[i].pos.x, st.sources[i].pos.y) <= 1) return true;
    }
    return false;
}

/** Ring tiles that are walkable, connected to the rest of the room and not a parking spot. */
function exitsAround(ctx, x, y) {
    let n = 0;
    const r = ring(x, y, 1);
    for (let i = 0; i < r.length; i++) {
        const k = idx(r[i].x, r[i].y);
        if (inBounds(r[i].x, r[i].y, 1) && !ctx.blocked[k] && ctx.reach[k] && !isParkingTile(ctx, r[i].x, r[i].y)) n++;
    }
    return n;
}

function reachNeighbours(ctx, x, y) {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(nx, ny, 1)) continue;
            const k = idx(nx, ny);
            if (!ctx.blocked[k] && ctx.reach[k]) n++;
        }
    }
    return n;
}

/** What stands on a tile and could be removed to open a path (null if nothing removable). */
function removableAt(ctx, x, y, allowExpensive) {
    const room = ctx.room;
    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
    for (let j = 0; j < sites.length; j++) {
        if (sites[j].my && util.isBlockingType(sites[j].structureType)) return { obj: sites[j], rank: 0, site: true };
    }
    const structs = room.lookForAt(LOOK_STRUCTURES, x, y);
    let best = null;
    for (let j = 0; j < structs.length; j++) {
        const str = structs[j];
        if (!util.isBlockingStructure(str)) continue;
        const rank = DESTROY_RANK[str.structureType];
        if (rank == null) return null;
        if (str.owner && !str.my) return null;
        if (rank >= 5 && !allowExpensive) return null;
        if (!best || rank > best.rank) best = { obj: str, rank, site: false };
    }
    return best;
}

/**
 * Cheapest chain of removable structures from a spawn's ring to open ground
 * (Dijkstra: walkable tiles cost 1, removable structures cost by rank).
 */
/** Tiny binary heap of [cost, index] pairs. */
function heapPush(h, item) {
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p][0] <= h[i][0]) break;
        const t = h[p];
        h[p] = h[i];
        h[i] = t;
        i = p;
    }
}

function heapPop(h) {
    const top = h[0];
    const last = h.pop();
    if (h.length) {
        h[0] = last;
        let i = 0;
        for (;;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let m = i;
            if (l < h.length && h[l][0] < h[m][0]) m = l;
            if (r < h.length && h[r][0] < h[m][0]) m = r;
            if (m === i) break;
            const t = h[m];
            h[m] = h[i];
            h[i] = t;
            i = m;
        }
    }
    return top;
}

function tunnel(ctx, origin, allowExpensive, skipFirst, reachOverride) {
    const reachArr = reachOverride || ctx.reach;
    const dist = new Float64Array(2500).fill(Infinity);
    const prev = new Int32Array(2500).fill(-1);
    const closed = new Uint8Array(2500);
    const removable = {};
    const start = idx(origin.x, origin.y);
    dist[start] = 0;
    const open = [[0, start]];
    const costOf = (x, y) => {
        const k = idx(x, y);
        if (!inBounds(x, y, 1)) return Infinity;
        if (ctx.terrain.get(x, y) === TERRAIN_MASK_WALL) return Infinity;
        if (!ctx.blocked[k]) return 1;
        if (!(k in removable)) removable[k] = removableAt(ctx, x, y, allowExpensive);
        const r = removable[k];
        if (!r) return Infinity;
        const base = [1, 12, 25, 40, 50, 80][r.rank];
        return 1 + (base == null ? 100 : base);
    };
    let goal = -1;
    let guard = 0;
    while (open.length && guard++ < 6000) {
        const cur = heapPop(open)[1];
        if (closed[cur]) continue;
        closed[cur] = 1;
        if (cur !== start && !ctx.blocked[cur] && reachArr[cur]) {
            goal = cur;
            break;
        }
        if (dist[cur] > 400) break;
        const cx = cur % 50;
        const cy = (cur - cx) / 50;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                const nk = idx(nx, ny);
                if (cur === start && skipFirst && skipFirst[nk]) continue;
                const c = costOf(nx, ny);
                if (c === Infinity) continue;
                if (dist[cur] + c < dist[nk]) {
                    dist[nk] = dist[cur] + c;
                    prev[nk] = cur;
                    heapPush(open, [dist[nk], nk]);
                }
            }
        }
    }
    if (goal < 0) return null;
    const chain = [];
    for (let k = goal; k !== start && k >= 0; k = prev[k]) {
        if (ctx.blocked[k] && removable[k]) chain.push({ k, x: k % 50, y: (k - (k % 50)) / 50, r: removable[k] });
    }
    return chain;
}

function removeChain(ctx, chain, label) {
    const st = ctx.st;
    let done = 0;
    for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        const res = c.r.site ? c.r.obj.remove() : c.r.obj.destroy();
        if (res === OK) {
            util.warn(ctx.room.name + ': ' + label + ' at ' + c.x + ',' + c.y + ' by ' +
                (c.r.site ? 'removing site ' : 'destroying ') + c.r.obj.structureType);
            ctx.blocked[c.k] = 0;
            ctx.occupied[c.k] = 0;
            ctx.reach[c.k] = 1;
            done++;
            st.mem.plan.dirty = true;
        } else {
            util.warn(ctx.room.name + ': could not remove ' + c.r.obj.structureType + ' at ' + c.x + ',' + c.y + ' (' + res + ')');
            break;
        }
    }
    if (done) ctx.reach = computeReach(ctx);
    return done;
}

/** Make sure every source area connects to the main region. */
function ensureConnected(ctx) {
    const st = ctx.st;
    if (!st.ctrl) return;
    for (let i = 0; i < st.sources.length; i++) {
        const p = st.sources[i].pos;
        const ringTiles = ring(p.x, p.y, 1);
        let connected = false;
        for (let j = 0; j < ringTiles.length; j++) {
            const k = idx(ringTiles[j].x, ringTiles[j].y);
            if (inBounds(ringTiles[j].x, ringTiles[j].y) && !ctx.blocked[k] && ctx.reach[k]) connected = true;
        }
        if (connected) continue;
        const chain = tunnel(ctx, p, true, null);
        if (chain && chain.length) removeChain(ctx, chain, 'connecting source ' + p.x + ',' + p.y);
    }
}

/** Structures nobody can stand next to are useless: open a way or remove them. */
function fixUnreachable(ctx) {
    const st = ctx.st;
    const cheap = [STRUCTURE_EXTENSION, STRUCTURE_LINK, STRUCTURE_LAB];
    const valuable = [STRUCTURE_TOWER, STRUCTURE_STORAGE, STRUCTURE_TERMINAL];
    let removed = 0;
    const check = (list, isCheap) => {
        for (let i = 0; i < list.length && removed < 6; i++) {
            const s = list[i];
            if (!s.my) continue;
            if (reachNeighbours(ctx, s.pos.x, s.pos.y) > 0) continue;
            if (isCheap) {
                if (s.destroy() === OK) {
                    util.warn(ctx.room.name + ': destroying unreachable ' + s.structureType + ' at ' + s.pos.x + ',' + s.pos.y);
                    const k = idx(s.pos.x, s.pos.y);
                    ctx.blocked[k] = 0;
                    ctx.occupied[k] = 0;
                    ctx.count[s.structureType]--;
                    removed++;
                    st.mem.plan.dirty = true;
                }
            } else {
                const chain = tunnel(ctx, s.pos, false, null);
                if (chain && chain.length && chain.length <= 4) removed += removeChain(ctx, chain, 'reaching ' + s.structureType);
            }
        }
    };
    for (let t = 0; t < valuable.length; t++) check(st.byType[valuable[t]] || [], false);
    for (let t = 0; t < cheap.length; t++) check(st.byType[cheap[t]] || [], true);
    if (removed) ctx.reach = computeReach(ctx);
}

/**
 * Rooms that fell many levels keep dozens of dead extensions and towers that
 * turn the base into a maze. Inactive ones off the checkerboard are removed;
 * the planner rebuilds them in sane places as the room recovers.
 */
function pruneInactive(ctx) {
    if (!PLAN.pruneInactive) return;
    const st = ctx.st;
    const types = [STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_LINK, STRUCTURE_LAB];
    let removed = 0;
    for (let t = 0; t < types.length && removed < 12; t++) {
        const list = st.byType[types[t]] || [];
        const cap = allowed(types[t], st.rcl);
        if (list.length <= cap) continue;
        for (let i = 0; i < list.length && removed < 12; i++) {
            const s = list[i];
            if (!s.my || st.active[s.id]) continue;
            if ((s.pos.x + s.pos.y) % 2 === ctx.parity) continue;
            if (s.destroy() === OK) {
                const k = idx(s.pos.x, s.pos.y);
                ctx.blocked[k] = 0;
                ctx.occupied[k] = 0;
                ctx.count[s.structureType]--;
                removed++;
            }
        }
    }
    if (removed) {
        util.warn(ctx.room.name + ': pruned ' + removed + ' inactive off-grid structures');
        st.mem.plan.dirty = true;
        ctx.reach = computeReach(ctx);
    }
}

function unboxSpawns(room, st, ctx) {
    const spawns = st.activeSpawns;
    const exits = {};
    for (let s = 0; s < spawns.length; s++) {
        const spawn = spawns[s];
        let free = exitsAround(ctx, spawn.pos.x, spawn.pos.y);
        let attempts = 0;
        while (free < PLAN.spawnFreeTiles && attempts < 3) {
            attempts++;
            // Already-open ring tiles are excluded so each pass opens a new exit.
            const skip = {};
            const r = ring(spawn.pos.x, spawn.pos.y, 1);
            for (let i = 0; i < r.length; i++) {
                const k = idx(r[i].x, r[i].y);
                if (inBounds(r[i].x, r[i].y, 1) && !ctx.blocked[k]) skip[k] = true;
            }
            // Expensive structures (towers) only go when the spawn has no exit at all.
            const chain = tunnel(ctx, spawn.pos, free === 0, skip);
            if (!chain || !chain.length) break;
            if (!removeChain(ctx, chain, 'opening ' + spawn.name)) break;
            free = exitsAround(ctx, spawn.pos.x, spawn.pos.y);
        }
        // Free ring tiles that are walled pockets would trap released creeps: open them too.
        const r = ring(spawn.pos.x, spawn.pos.y, 1);
        for (let i = 0; i < r.length; i++) {
            const k = idx(r[i].x, r[i].y);
            if (!inBounds(r[i].x, r[i].y, 1) || ctx.blocked[k] || ctx.reach[k]) continue;
            const chain = tunnel(ctx, { x: r[i].x, y: r[i].y }, false, null);
            if (chain && chain.length && chain.length <= 2) removeChain(ctx, chain, 'opening pocket at ' + r[i].x + ',' + r[i].y);
        }
        exits[spawn.id] = exitDirections(ctx, spawn);
    }
    st.mem.plan.exits = exits;
}

const DIRS = [[0, -1, TOP], [1, -1, TOP_RIGHT], [1, 0, RIGHT], [1, 1, BOTTOM_RIGHT],
    [0, 1, BOTTOM], [-1, 1, BOTTOM_LEFT], [-1, 0, LEFT], [-1, -1, TOP_LEFT]];

function exitDirections(ctx, spawn) {
    const out = [];
    for (let i = 0; i < DIRS.length; i++) {
        const x = spawn.pos.x + DIRS[i][0];
        const y = spawn.pos.y + DIRS[i][1];
        if (!inBounds(x, y, 1)) continue;
        const k = idx(x, y);
        if (!ctx.blocked[k] && ctx.reach[k] && !isParkingTile(ctx, x, y)) out.push(DIRS[i][2]);
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

function siteBudget(st) {
    const total = util.cache('siteTotal', () => Object.keys(Game.constructionSites).length);
    const rooms = util.ownedRooms().length || 1;
    const perRoom = util.clamp(Math.floor(95 / rooms), 3, PLAN.maxSitesPerRoom);
    return Math.min(perRoom - st.sites.length, 95 - total);
}

function placeOnBoard(ctx, type, need, maxRing, opts) {
    let placed = 0;
    for (let d = 1; d <= maxRing && placed < need; d++) {
        const r = ring(ctx.anchor.x, ctx.anchor.y, d);
        for (let i = 0; i < r.length && placed < need; i++) {
            if (!canPlaceBlocking(ctx, r[i].x, r[i].y, opts)) continue;
            if (place(ctx, type, r[i].x, r[i].y)) placed++;
            if (ctx.sitesFull) return placed;
        }
    }
    return placed;
}

function placeNear(ctx, type, center, minRing, maxRing, opts) {
    for (let d = minRing; d <= maxRing; d++) {
        const r = ring(center.x, center.y, d);
        for (let i = 0; i < r.length; i++) {
            if (!canPlaceBlocking(ctx, r[i].x, r[i].y, opts)) continue;
            if (place(ctx, type, r[i].x, r[i].y)) return true;
            if (ctx.sitesFull) return false;
        }
    }
    return false;
}

function hasSiteOrStructNear(ctx, type, x, y, range) {
    const room = ctx.room;
    const list = ctx.st.byType[type] || [];
    for (let i = 0; i < list.length; i++) {
        if (chebyshev(list[i].pos.x, list[i].pos.y, x, y) <= range) return true;
    }
    for (let i = 0; i < ctx.st.sites.length; i++) {
        const s = ctx.st.sites[i];
        if (s.structureType === type && chebyshev(s.pos.x, s.pos.y, x, y) <= range) return true;
    }
    void room;
    return false;
}

function placeContainerNear(ctx, target, range, preferFar) {
    let best = null;
    let bestScore = -Infinity;
    for (let d = 1; d <= range; d++) {
        const r = ring(target.x, target.y, d);
        for (let i = 0; i < r.length; i++) {
            const x = r[i].x;
            const y = r[i].y;
            if (!inBounds(x, y, 1)) continue;
            const k = idx(x, y);
            if (ctx.blocked[k] || ctx.occupied[k]) continue;
            if (nearSpawn(ctx, x, y, 1)) continue;
            const nb = walkableNeighbours(ctx, x, y, -1, -1);
            if (nb < 2) continue;
            let score = -chebyshev(x, y, ctx.anchor.x, ctx.anchor.y) * 2 + nb * 0.1;
            if (preferFar && d === 1) score -= 3;
            if (score > bestScore) {
                bestScore = score;
                best = { x, y };
            }
        }
    }
    if (best) return place(ctx, STRUCTURE_CONTAINER, best.x, best.y);
    return false;
}

function placeLinkNear(ctx, around, maxRange, extra) {
    let best = null;
    let bestScore = -Infinity;
    for (let d = 1; d <= maxRange; d++) {
        const r = ring(around.x, around.y, d);
        for (let i = 0; i < r.length; i++) {
            const x = r[i].x;
            const y = r[i].y;
            if (!canPlaceBlocking(ctx, x, y, { anyParity: true, minLanes: 1, ctrlMin: 2, accessOk: true })) continue;
            if (extra && !extra(x, y)) continue;
            const score = -d * 2 + walkableNeighbours(ctx, x, y, -1, -1) * 0.1;
            if (score > bestScore) {
                bestScore = score;
                best = { x, y };
            }
        }
    }
    if (best) return place(ctx, STRUCTURE_LINK, best.x, best.y);
    return false;
}

function placeAll(room, st, ctx) {
    let budget = siteBudget(st);
    if (budget <= 0) return;
    const rcl = st.rcl;
    const used = () => budget <= 0 || ctx.sitesFull;
    const spend = n => { budget -= n; };

    // First spawn of a new room.
    if (!st.spawns.length && have(ctx, STRUCTURE_SPAWN) === 0 && allowed(STRUCTURE_SPAWN, rcl) > 0) {
        const a = ctx.anchor;
        if (place(ctx, STRUCTURE_SPAWN, a.x, a.y)) spend(1);
        else {
            const spot = findSpawnSpot(room, st);
            if (spot) {
                st.mem.plan.anchor = { x: spot.x, y: spot.y };
                st.mem.plan.dirty = true;
            }
            return;
        }
    }
    if (used()) return;

    // Extensions.
    const extNeed = allowed(STRUCTURE_EXTENSION, rcl) - have(ctx, STRUCTURE_EXTENSION);
    if (extNeed > 0) spend(placeOnBoard(ctx, STRUCTURE_EXTENSION, Math.min(extNeed, budget), 12));
    if (used()) return;

    // Towers.
    const towerNeed = allowed(STRUCTURE_TOWER, rcl) - have(ctx, STRUCTURE_TOWER);
    if (towerNeed > 0) spend(placeOnBoard(ctx, STRUCTURE_TOWER, Math.min(towerNeed, budget), 7));
    if (used()) return;

    // Ramparts on critical structures come before everything else that is
    // optional: a bare tower or spawn is the first thing a raid takes down.
    if (rcl >= PLAN.rampartsFromRcl) spend(placeRamparts(ctx, budget));
    if (used()) return;

    // Storage.
    if (allowed(STRUCTURE_STORAGE, rcl) > have(ctx, STRUCTURE_STORAGE)) {
        if (placeNear(ctx, STRUCTURE_STORAGE, ctx.anchor, 2, 5)) spend(1);
    }
    if (used()) return;

    // Containers next to sources and the controller.
    for (let i = 0; i < st.sources.length && !used(); i++) {
        const src = st.sources[i];
        if (src.container) continue;
        if (hasSiteOrStructNear(ctx, STRUCTURE_CONTAINER, src.pos.x, src.pos.y, 1)) continue;
        if (placeContainerNear(ctx, src.pos, 1, false)) spend(1);
    }
    if (used()) return;
    if (st.ctrl && !st.ctrlContainer && !hasSiteOrStructNear(ctx, STRUCTURE_CONTAINER, st.ctrl.pos.x, st.ctrl.pos.y, 3)) {
        if (placeContainerNear(ctx, st.ctrl.pos, 2, true)) spend(1);
    }
    if (used()) return;

    // Links: controller first, then storage, then sources.
    let linkCap = allowed(STRUCTURE_LINK, rcl) - have(ctx, STRUCTURE_LINK);
    if (linkCap > 0 && st.ctrl && !st.ctrlLink && !hasSiteOrStructNear(ctx, STRUCTURE_LINK, st.ctrl.pos.x, st.ctrl.pos.y, 3)) {
        const around = st.ctrlContainer ? st.ctrlContainer.pos : st.ctrl.pos;
        const ctrlPos = st.ctrl.pos;
        const ok = placeLinkNear(ctx, around, st.ctrlContainer ? 1 : 3,
            (x, y) => chebyshev(x, y, ctrlPos.x, ctrlPos.y) <= 3 && chebyshev(x, y, ctrlPos.x, ctrlPos.y) >= 2);
        if (ok) {
            spend(1);
            linkCap--;
        }
    }
    if (used()) return;
    if (linkCap > 0 && st.storage && !st.storageLink &&
        !hasSiteOrStructNear(ctx, STRUCTURE_LINK, st.storage.pos.x, st.storage.pos.y, 2)) {
        if (placeLinkNear(ctx, st.storage.pos, 2, (x, y) => (x + y) % 2 === ctx.parity)) {
            spend(1);
            linkCap--;
        }
    }
    if (used()) return;
    for (let i = 0; i < st.sources.length && linkCap > 0 && !used(); i++) {
        const src = st.sources[i];
        if (src.link) continue;
        if (!src.container) continue;
        if (hasSiteOrStructNear(ctx, STRUCTURE_LINK, src.pos.x, src.pos.y, 2)) continue;
        const sp = src.pos;
        if (placeLinkNear(ctx, src.container.pos, 1, (x, y) => chebyshev(x, y, sp.x, sp.y) >= 1)) {
            spend(1);
            linkCap--;
        }
    }
    if (used()) return;

    // Terminal.
    if (allowed(STRUCTURE_TERMINAL, rcl) > have(ctx, STRUCTURE_TERMINAL) && st.storage) {
        if (placeNear(ctx, STRUCTURE_TERMINAL, st.storage.pos, 1, 3)) spend(1);
    }
    if (used()) return;

    // Extra spawns at RCL7+.
    const spawnNeed = allowed(STRUCTURE_SPAWN, rcl) - have(ctx, STRUCTURE_SPAWN);
    for (let n = 0; n < spawnNeed && !used(); n++) {
        if (placeNear(ctx, STRUCTURE_SPAWN, ctx.anchor, 2, 6, { minLanes: 4 })) spend(1);
        else break;
    }
    if (used()) return;

    // Roads from RCL3: spawn rings, then paths to containers.
    if (rcl >= PLAN.roadsFromRcl) spend(placeRoads(ctx, budget));
}

function placeRoads(ctx, budget) {
    let placed = 0;
    const st = ctx.st;
    const room = ctx.room;

    // Ring roads around spawns keep exits open and fast.
    for (let s = 0; s < ctx.spawnPos.length && placed < budget; s++) {
        const r = ring(ctx.spawnPos[s].x, ctx.spawnPos[s].y, 1);
        for (let i = 0; i < r.length && placed < budget; i++) {
            const x = r[i].x;
            const y = r[i].y;
            if (!inBounds(x, y, 1)) continue;
            const k = idx(x, y);
            if (ctx.road[k] || ctx.occupied[k] || ctx.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            if (place(ctx, STRUCTURE_ROAD, x, y)) placed++;
            if (ctx.sitesFull) return placed;
        }
    }
    if (placed >= budget) return placed;

    // Paths: anchor -> every source container, controller container.
    if (st.mem.plan.roadsDone && Game.time - (st.mem.plan.roadsAt || 0) < 1500) return placed;

    const matrix = new PathFinder.CostMatrix();
    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
            const k = idx(x, y);
            if (ctx.blocked[k]) matrix.set(x, y, 255);
            else if (ctx.road[k]) matrix.set(x, y, 1);
            else if (ctx.terrain.get(x, y) === TERRAIN_MASK_SWAMP) matrix.set(x, y, 6);
            else matrix.set(x, y, 3);
        }
    }

    const goals = [];
    for (let i = 0; i < st.sources.length; i++) {
        const src = st.sources[i];
        const p = src.container ? src.container.pos : src.pos;
        goals.push({ pos: p, range: src.container ? 0 : 1 });
    }
    if (st.ctrl) {
        const p = st.ctrlContainer ? st.ctrlContainer.pos : st.ctrl.pos;
        goals.push({ pos: p, range: st.ctrlContainer ? 1 : 2 });
    }

    const origin = new RoomPosition(ctx.anchor.x, ctx.anchor.y, room.name);
    let missing = 0;
    for (let g = 0; g < goals.length; g++) {
        const res = PathFinder.search(origin, goals[g], {
            roomCallback: name => (name === room.name ? matrix : false),
            maxRooms: 1,
            maxOps: 2000,
            plainCost: 3,
            swampCost: 6,
        });
        for (let i = 0; i < res.path.length; i++) {
            const p = res.path[i];
            const k = idx(p.x, p.y);
            if (ctx.road[k] || ctx.occupied[k] || ctx.blocked[k]) continue;
            if (chebyshev(p.x, p.y, goals[g].pos.x, goals[g].pos.y) === 0 && goals[g].range === 0) continue;
            missing++;
            if (placed >= budget || ctx.sitesFull) continue;
            if (place(ctx, STRUCTURE_ROAD, p.x, p.y)) placed++;
        }
    }
    st.mem.plan.roadsAt = Game.time;
    st.mem.plan.roadsDone = missing === 0;
    return placed;
}

function placeRamparts(ctx, budget) {
    let placed = 0;
    const st = ctx.st;
    const types = [STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_STORAGE, STRUCTURE_TERMINAL];
    for (let t = 0; t < types.length && placed < budget; t++) {
        const list = st.byType[types[t]] || [];
        for (let i = 0; i < list.length && placed < budget; i++) {
            const s = list[i];
            if (!s.my) continue;
            const k = idx(s.pos.x, s.pos.y);
            if (ctx.rampart[k]) continue;
            if (place(ctx, STRUCTURE_RAMPART, s.pos.x, s.pos.y)) placed++;
            if (ctx.sitesFull) return placed;
        }
    }
    return placed;
}

/* ------------------------------------------------------------------ */

function run(room, st) {
    if (!st.ctrl || !st.ctrl.my) return;
    const mem = st.mem;
    if (!mem.plan || mem.plan.ver !== PLAN.version) {
        adopt(room, st);
        return;
    }
    const plan = mem.plan;
    const due = plan.dirty || ((Game.time + util.hashString(room.name)) % PLAN.interval === 0);
    if (!due) return;
    if (Game.cpu.bucket < config.cpu.plannerMinBucket) return;
    // Heavy passes are spread out: a few rooms per tick, and never when the tick is already expensive.
    const budget = util.cache('plannerBudget', () => ({ n: 0 }));
    if (budget.n >= PLAN.maxPassesPerTick || Game.cpu.getUsed() > Game.cpu.limit * 0.5) {
        plan.dirty = true;
        return;
    }
    budget.n++;
    plan.dirty = false;
    if (st.hostiles.length) return;
    if (!plan.anchor) {
        const spot = findSpawnSpot(room, st);
        if (!spot) return;
        plan.anchor = { x: spot.x, y: spot.y };
        plan.idle = findIdleSpot(room, st, spot);
        st.anchor = spot;
    }

    const ctx = buildContext(room, st);
    pruneInactive(ctx);
    ensureConnected(ctx);
    unboxSpawns(room, st, ctx);
    fixUnreachable(ctx);
    placeAll(room, st, ctx);
}

module.exports = { run, adopt };
