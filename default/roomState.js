/**
 * Per-tick snapshot of everything a room's logic needs. Built once per room
 * per tick and shared by defense, spawning, planning and creeps.
 */
const config = require('config');
const util = require('util');

const DANGER_PARTS = [ATTACK, RANGED_ATTACK, WORK, CLAIM, HEAL];

/** Names of creeps "spawning" in spawns that cannot release them (inactive or sealed). */
function stuckSpawning() {
    return util.cache('stuckSpawning', () => {
        const h = util.heap;
        if (!h.stuckSpawn || Game.time - h.stuckSpawn.t > 25) {
            const names = {};
            for (const sn in Game.spawns) {
                const spawn = Game.spawns[sn];
                if (!spawn.spawning) continue;
                const plan = Memory.rooms[spawn.room.name] && Memory.rooms[spawn.room.name].plan;
                const sealed = !!(plan && plan.exits && plan.exits[spawn.id] && plan.exits[spawn.id].length === 0);
                if (sealed || !spawn.isActive()) names[spawn.spawning.name] = true;
            }
            h.stuckSpawn = { t: Game.time, names };
        }
        return h.stuckSpawn.names;
    });
}

/** Creeps grouped by home room and role (per-tick cache). */
function creepIndex() {
    return util.cache('creepIndex', () => {
        const byHome = {};
        let total = 0;
        const stuck = stuckSpawning();
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            const m = c.memory;
            total++;
            if (!m.role || !m.home) continue;
            if (c.spawning && stuck[name]) continue;
            const h = byHome[m.home] || (byHome[m.home] = {});
            (h[m.role] || (h[m.role] = [])).push(c);
        }
        return { byHome, total };
    });
}

function refreshActive(room, rh, byType, rcl) {
    const active = {};
    const types = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_LINK, STRUCTURE_LAB];
    for (let t = 0; t < types.length; t++) {
        const type = types[t];
        const list = byType[type] || [];
        if (!list.length) continue;
        const cap = CONTROLLER_STRUCTURES[type] ? CONTROLLER_STRUCTURES[type][rcl] : 0;
        const allActive = list.length <= cap;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (!s.my) continue;
            active[s.id] = allActive ? true : s.isActive();
        }
    }
    rh.active = active;
    rh.activeRcl = rcl;
    rh.activeAt = Game.time;
}

function build(room) {
    const name = room.name;
    const mem = Memory.rooms[name] || (Memory.rooms[name] = {});
    const byType = util.structuresByType(room);
    const ctrl = room.controller;
    const rcl = ctrl ? ctrl.level : 0;
    const rh = util.roomHeap(name);

    if (!rh.active || rh.activeRcl !== rcl || Game.time - rh.activeAt > 50) refreshActive(room, rh, byType, rcl);
    const active = rh.active;

    const spawns = (byType[STRUCTURE_SPAWN] || []).filter(s => s.my);
    spawns.sort((a, b) => (a.name < b.name ? -1 : 1));
    const activeSpawns = spawns.filter(s => active[s.id]);
    const extensions = (byType[STRUCTURE_EXTENSION] || []).filter(s => s.my && active[s.id]);
    const towers = (byType[STRUCTURE_TOWER] || []).filter(s => s.my && active[s.id]);
    const links = (byType[STRUCTURE_LINK] || []).filter(s => s.my && active[s.id]);
    const storage = room.storage && room.storage.my ? room.storage : null;
    const terminal = room.terminal && room.terminal.my && rcl >= 6 ? room.terminal : null;
    const containers = byType[STRUCTURE_CONTAINER] || [];
    const roads = (byType[STRUCTURE_ROAD] || []).length;

    const sources = util.find(room, FIND_SOURCES);
    const srcInfo = [];
    for (let i = 0; i < sources.length; i++) {
        srcInfo.push({ id: sources[i].id, source: sources[i], pos: sources[i].pos, container: null, link: null });
    }

    let ctrlContainer = null;
    for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        let matched = false;
        for (let j = 0; j < srcInfo.length; j++) {
            if (c.pos.inRangeTo(srcInfo[j].pos, 1)) {
                srcInfo[j].container = c;
                matched = true;
                break;
            }
        }
        if (!matched && ctrl && c.pos.inRangeTo(ctrl.pos, 3)) ctrlContainer = c;
    }

    let ctrlLink = null;
    let storageLink = null;
    const sourceLinks = [];
    for (let i = 0; i < links.length; i++) {
        const l = links[i];
        if (ctrl && l.pos.inRangeTo(ctrl.pos, 3)) {
            ctrlLink = l;
            continue;
        }
        if (storage && l.pos.inRangeTo(storage.pos, 2)) {
            storageLink = l;
            continue;
        }
        for (let j = 0; j < srcInfo.length; j++) {
            if (l.pos.inRangeTo(srcInfo[j].pos, 2)) {
                srcInfo[j].link = l;
                sourceLinks.push(l);
                break;
            }
        }
    }

    const hostiles = util.find(room, FIND_HOSTILE_CREEPS);
    let danger = false;
    for (let i = 0; i < hostiles.length; i++) {
        if (util.hasParts(hostiles[i], DANGER_PARTS)) {
            danger = true;
            break;
        }
    }

    const energy = room.energyAvailable;
    const cap = room.energyCapacityAvailable;
    let refill = [];
    if (energy < cap) {
        refill = activeSpawns.concat(extensions).filter(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    }
    const towersNeedy = towers.filter(t => (t.store[RESOURCE_ENERGY] || 0) < TOWER_CAPACITY * 0.7);

    const creeps = creepIndex().byHome[name] || {};
    const count = role => (creeps[role] ? creeps[role].length : 0);

    const downgradeMax = ctrl ? CONTROLLER_DOWNGRADE[rcl] || 20000 : 20000;
    const downgrade = !!(ctrl && ctrl.my && ctrl.ticksToDowngrade < downgradeMax * config.population.downgradeAlarm);

    const anchorMem = mem.plan && mem.plan.anchor;
    const anchor = anchorMem
        ? new RoomPosition(anchorMem.x, anchorMem.y, name)
        : (spawns.length ? spawns[0].pos : (ctrl ? ctrl.pos : new RoomPosition(25, 25, name)));
    const idleMem = mem.plan && mem.plan.idle;
    const idle = idleMem ? new RoomPosition(idleMem.x, idleMem.y, name) : anchor;

    const bootstrap = count('miner') === 0 && count('hauler') === 0;

    return {
        room,
        name,
        mem,
        ctrl,
        rcl,
        byType,
        active,
        spawns,
        activeSpawns,
        extensions,
        towers,
        towersNeedy,
        links,
        ctrlLink,
        storageLink,
        sourceLinks,
        storage,
        storageActive: !!(storage && rcl >= 4),
        terminal,
        containers,
        roads,
        sources: srcInfo,
        ctrlContainer,
        hostiles,
        danger,
        dropped: util.find(room, FIND_DROPPED_RESOURCES, 'e', r => r.resourceType === RESOURCE_ENERGY && r.amount >= 30),
        tombstones: util.find(room, FIND_TOMBSTONES, 'e', t => (t.store[RESOURCE_ENERGY] || 0) > 0),
        ruins: util.find(room, FIND_RUINS, 'e', r => (r.store[RESOURCE_ENERGY] || 0) > 0),
        sites: util.find(room, FIND_MY_CONSTRUCTION_SITES),
        creeps,
        count,
        energy,
        cap,
        refill,
        downgrade,
        anchor,
        idle,
        bootstrap,
    };
}

function get(room) {
    return util.cache('state|' + room.name, () => build(room));
}

module.exports = { get, creepIndex };
