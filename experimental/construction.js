/**
 * Places missing structures based on RCL. Idempotent — safe on existing bases.
 */

const config = require('config');
const lib = require('lib');

const STRUCTURE_CAPS = {
    [STRUCTURE_SPAWN]:      [0, 1, 1, 1, 1, 1, 1, 2, 3],
    [STRUCTURE_EXTENSION]:  [0, 0, 5, 10, 20, 30, 40, 50, 60],
    [STRUCTURE_TOWER]:      [0, 0, 0, 1, 1, 2, 2, 3, 6],
    [STRUCTURE_STORAGE]:    [0, 0, 0, 0, 1, 1, 1, 1, 1],
    [STRUCTURE_CONTAINER]:  [5, 5, 5, 5, 5, 5, 5, 5, 5],
    [STRUCTURE_TERMINAL]:   [0, 0, 0, 0, 0, 0, 1, 1, 1],
    [STRUCTURE_EXTRACTOR]:  [0, 0, 0, 0, 0, 0, 1, 1, 1],
    [STRUCTURE_LINK]:       [0, 0, 0, 0, 0, 2, 3, 4, 6],
    [STRUCTURE_LAB]:        [0, 0, 0, 0, 0, 0, 3, 6, 10],
    [STRUCTURE_FACTORY]:    [0, 0, 0, 0, 0, 0, 0, 1, 1],
    [STRUCTURE_OBSERVER]:   [0, 0, 0, 0, 0, 0, 0, 0, 1],
    [STRUCTURE_NUKER]:      [0, 0, 0, 0, 0, 0, 0, 0, 1],
    [STRUCTURE_POWER_SPAWN]:[0, 0, 0, 0, 0, 0, 0, 0, 1],
};

function cap(structureType, rcl) {
    const row = STRUCTURE_CAPS[structureType];
    if (!row) return 0;
    return row[Math.min(rcl, 8)] || 0;
}

function countStructures(room, structureType) {
    const built = room.find(FIND_STRUCTURES, { filter: s => s.structureType === structureType }).length;
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === structureType }).length;
    return built + sites;
}

function openSiteSlots(room) {
    return config.maxSitesPerRoom - room.find(FIND_MY_CONSTRUCTION_SITES).length;
}

function isBuildable(room, x, y) {
    if (x < 1 || x > 48 || y < 1 || y > 48) return false;
    const terrain = room.getTerrain().get(x, y);
    if (terrain === TERRAIN_MASK_WALL) return false;
    const pos = new RoomPosition(x, y, room.name);
    if (pos.lookFor(LOOK_STRUCTURES).some(s =>
        s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART)) return false;
    if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length) return false;
    return true;
}

/** Spiral positions around an anchor. */
function spiral(anchor, maxR) {
    const positions = [];
    for (let r = 1; r <= maxR; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                positions.push({ x: anchor.x + dx, y: anchor.y + dy });
            }
        }
    }
    return positions;
}

function place(room, structureType, x, y) {
    const res = room.createConstructionSite(x, y, structureType);
    return res === OK;
}

function anchorFor(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (spawn) return spawn.pos;
    if (room.controller) return room.controller.pos;
    return new RoomPosition(25, 25, room.name);
}

function planExtensions(room, rcl, budget) {
    const need = cap(STRUCTURE_EXTENSION, rcl) - countStructures(room, STRUCTURE_EXTENSION);
    if (need <= 0 || budget <= 0) return budget;

    const anchor = anchorFor(room);
    // Checkerboard-ish around spawn: avoid blocking roads on even sum
    for (const p of spiral(anchor, 10)) {
        if (budget <= 0 || need <= 0) break;
        if ((p.x + p.y) % 2 !== (anchor.x + anchor.y) % 2) continue;
        if (!isBuildable(room, p.x, p.y)) continue;
        // Keep distance from sources/minerals
        const nearSource = room.find(FIND_SOURCES).some(s => s.pos.inRangeTo(p.x, p.y, 1));
        if (nearSource) continue;
        if (place(room, STRUCTURE_EXTENSION, p.x, p.y)) {
            budget--;
            // need-- tracked via recount conceptually
        }
    }
    return budget;
}

function planTowers(room, rcl, budget) {
    let need = cap(STRUCTURE_TOWER, rcl) - countStructures(room, STRUCTURE_TOWER);
    if (need <= 0 || budget <= 0) return budget;

    const anchor = anchorFor(room);
    for (const p of spiral(anchor, 6)) {
        if (budget <= 0 || need <= 0) break;
        if (!isBuildable(room, p.x, p.y)) continue;
        if (place(room, STRUCTURE_TOWER, p.x, p.y)) {
            budget--;
            need--;
        }
    }
    return budget;
}

function planStorage(room, rcl, budget) {
    if (cap(STRUCTURE_STORAGE, rcl) <= countStructures(room, STRUCTURE_STORAGE)) return budget;
    if (budget <= 0) return budget;

    const anchor = anchorFor(room);
    for (const p of spiral(anchor, 4)) {
        if (!isBuildable(room, p.x, p.y)) continue;
        if (place(room, STRUCTURE_STORAGE, p.x, p.y)) return budget - 1;
    }
    return budget;
}

function planTerminal(room, rcl, budget) {
    if (cap(STRUCTURE_TERMINAL, rcl) <= countStructures(room, STRUCTURE_TERMINAL)) return budget;
    if (budget <= 0) return budget;
    const storage = room.storage;
    const anchor = storage ? storage.pos : anchorFor(room);
    for (const p of spiral(anchor, 3)) {
        if (!isBuildable(room, p.x, p.y)) continue;
        if (place(room, STRUCTURE_TERMINAL, p.x, p.y)) return budget - 1;
    }
    return budget;
}

function planExtractor(room, rcl, budget) {
    if (cap(STRUCTURE_EXTRACTOR, rcl) <= 0) return budget;
    if (countStructures(room, STRUCTURE_EXTRACTOR) > 0) return budget;
    if (budget <= 0) return budget;
    const mineral = room.find(FIND_MINERALS)[0];
    if (!mineral) return budget;
    if (place(room, STRUCTURE_EXTRACTOR, mineral.pos.x, mineral.pos.y)) return budget - 1;
    return budget;
}

function planContainers(room, budget) {
    if (budget <= 0) return budget;
    const existing = countStructures(room, STRUCTURE_CONTAINER);
    let remaining = Math.max(0, 5 - existing);
    if (remaining <= 0) return budget;

    // Source containers
    for (const source of room.find(FIND_SOURCES)) {
        if (budget <= 0 || remaining <= 0) break;
        const near = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
        });
        const nearSites = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
        });
        if (near.length || nearSites.length) continue;

        // Best adjacent plain/swamp tile closest to spawn/controller
        const anchor = anchorFor(room);
        let best = null;
        let bestDist = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                if (!isBuildable(room, x, y)) continue;
                const d = Math.abs(x - anchor.x) + Math.abs(y - anchor.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = { x, y };
                }
            }
        }
        if (best && place(room, STRUCTURE_CONTAINER, best.x, best.y)) {
            budget--;
            remaining--;
        }
    }

    // Controller container
    if (budget > 0 && remaining > 0 && room.controller) {
        const ctrl = room.controller;
        const near = ctrl.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
        });
        const nearSites = ctrl.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
        });
        if (!near.length && !nearSites.length) {
            for (const p of spiral(ctrl.pos, 2)) {
                if (!isBuildable(room, p.x, p.y)) continue;
                if (place(room, STRUCTURE_CONTAINER, p.x, p.y)) {
                    budget--;
                    remaining--;
                }
                break;
            }
        }
    }

    return budget;
}

function planSpawn(room, rcl, budget) {
    const need = cap(STRUCTURE_SPAWN, rcl) - countStructures(room, STRUCTURE_SPAWN);
    if (need <= 0 || budget <= 0) return budget;

    // First spawn in a new room
    if (room.find(FIND_MY_SPAWNS).length === 0) {
        const ctrl = room.controller;
        const sources = room.find(FIND_SOURCES);
        let x = 25;
        let y = 25;
        if (ctrl && sources[0]) {
            x = Math.round((ctrl.pos.x + sources[0].pos.x) / 2);
            y = Math.round((ctrl.pos.y + sources[0].pos.y) / 2);
        } else if (ctrl) {
            x = ctrl.pos.x;
            y = ctrl.pos.y + 2;
        }
        for (const p of spiral({ x, y }, 8)) {
            if (!isBuildable(room, p.x, p.y)) continue;
            if (p.x < 2 || p.x > 47 || p.y < 2 || p.y > 47) continue;
            if (place(room, STRUCTURE_SPAWN, p.x, p.y)) return budget - 1;
        }
        return budget;
    }

    // Extra spawns near existing
    const anchor = anchorFor(room);
    for (const p of spiral(anchor, 5)) {
        if (!isBuildable(room, p.x, p.y)) continue;
        if (place(room, STRUCTURE_SPAWN, p.x, p.y)) return budget - 1;
    }
    return budget;
}

function planRoads(room, budget) {
    if (!config.roads.enabled) return budget;
    if (!room.controller || room.controller.level < config.roads.minRcl) return budget;
    if (budget <= 0) return budget;

    // Only place a few roads per tick along spawn↔sources and spawn↔controller
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return budget;

    const goals = [room.controller].concat(room.find(FIND_SOURCES));
    for (const goal of goals) {
        if (!goal || budget <= 0) break;
        const path = spawn.pos.findPathTo(goal.pos, {
            ignoreCreeps: true,
            swampCost: 2,
            plainCost: 2,
        });
        for (const step of path) {
            if (budget <= 0) break;
            // Skip destination tile for sources (container) / controller
            if (goal.pos.x === step.x && goal.pos.y === step.y) continue;
            if (!isBuildable(room, step.x, step.y)) {
                // already has structure — if no road, try add road under rampart only
                const pos = new RoomPosition(step.x, step.y, room.name);
                const hasRoad = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_ROAD) ||
                    pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_ROAD);
                if (hasRoad) continue;
                const blocking = pos.lookFor(LOOK_STRUCTURES).some(s =>
                    s.structureType !== STRUCTURE_RAMPART);
                if (blocking) continue;
            }
            // Cheap check: only place if no road
            const pos = new RoomPosition(step.x, step.y, room.name);
            const hasRoad = pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_ROAD) ||
                pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_ROAD);
            if (hasRoad) continue;
            if (room.getTerrain().get(step.x, step.y) === TERRAIN_MASK_WALL) continue;
            if (place(room, STRUCTURE_ROAD, step.x, step.y)) budget--;
        }
    }
    return budget;
}

function planRamparts(room, budget) {
    // Light ramparts on spawns/towers/storage once RCL>=3
    if (!room.controller || room.controller.level < 3 || budget <= 0) return budget;

    const critical = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER ||
            s.structureType === STRUCTURE_STORAGE ||
            s.structureType === STRUCTURE_TERMINAL,
    });

    for (const s of critical) {
        if (budget <= 0) break;
        const has = s.pos.lookFor(LOOK_STRUCTURES).some(x => x.structureType === STRUCTURE_RAMPART) ||
            s.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(x => x.structureType === STRUCTURE_RAMPART);
        if (has) continue;
        if (place(room, STRUCTURE_RAMPART, s.pos.x, s.pos.y)) budget--;
    }
    return budget;
}

/**
 * Run construction planner for one owned room.
 */
function run(room) {
    if (!room.controller || !room.controller.my) return;
    if (!lib.bucketOk('low') && Game.time % 11 !== 0) return;

    // Throttle: plan every few ticks per room
    const mem = Memory.rooms[room.name] = Memory.rooms[room.name] || {};
    if (mem.lastBuildPlan && Game.time - mem.lastBuildPlan < 10) return;
    mem.lastBuildPlan = Game.time;

    let budget = openSiteSlots(room);
    if (budget <= 0) return;

    const rcl = room.controller.level;

    // Priority order
    budget = planSpawn(room, rcl, budget);
    budget = planExtensions(room, rcl, budget);
    budget = planTowers(room, rcl, budget);
    budget = planStorage(room, rcl, budget);
    budget = planContainers(room, budget);
    budget = planTerminal(room, rcl, budget);
    budget = planExtractor(room, rcl, budget);
    budget = planRamparts(room, budget);

    // Roads less often
    if (Game.time % 50 === 0) {
        budget = planRoads(room, budget);
    }
}

module.exports = {
    run,
    cap,
};
