/**
 * Role runners. Each exports run(creep).
 */

const lib = require('lib');
const config = require('config');

function toggleWorking(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
}

const miner = {
    run(creep) {
        const home = lib.homeOf(creep);
        const sourceId = creep.memory.sourceId;
        let source = sourceId && Game.getObjectById(sourceId);

        if (!source) {
            // Assign freest source in home / target
            const room = Game.rooms[creep.memory.targetRoom || home] || creep.room;
            const sources = room.find(FIND_SOURCES);
            const taken = {};
            for (const name in Game.creeps) {
                const c = Game.creeps[name];
                if (c.memory.role === 'miner' && c.memory.sourceId && c.name !== creep.name) {
                    taken[c.memory.sourceId] = true;
                }
            }
            source = sources.find(s => !taken[s.id]) || sources[0];
            if (source) creep.memory.sourceId = source.id;
        }

        if (!source) return;

        if (creep.room.name !== source.pos.roomName) {
            lib.goToRoom(creep, source.pos.roomName);
            return;
        }

        // Prefer standing on container
        if (!creep.memory.parked) {
            const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER,
            })[0];
            if (container && !creep.pos.isEqualTo(container.pos)) {
                lib.moveTo(creep, container, { stroke: '#ffff00' });
                return;
            }
            if (container && creep.pos.isEqualTo(container.pos)) creep.memory.parked = true;
        }

        if (creep.pos.inRangeTo(source, 1)) {
            creep.harvest(source);
            // Drop into container underfoot / link later
            if (creep.store.getFreeCapacity() === 0) {
                const cont = creep.pos.lookFor(LOOK_STRUCTURES).find(s =>
                    s.structureType === STRUCTURE_CONTAINER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
                if (cont) creep.transfer(cont, RESOURCE_ENERGY);
            }
        } else {
            lib.moveTo(creep, source, { stroke: '#ffff00' });
        }
    },
};

const hauler = {
    run(creep) {
        toggleWorking(creep);
        const home = lib.homeOf(creep);
        if (!creep.memory.working) {
            // Collect from containers near sources, dropped energy
            if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
                lib.goToRoom(creep, creep.memory.targetRoom);
                return;
            }

            const room = creep.room;
            // Prefer fullest source-adjacent container
            const containers = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 100,
            });
            if (containers.length) {
                containers.sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY]);
                const t = containers[0];
                if (creep.withdraw(t, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) lib.moveTo(creep, t, { stroke: '#ffaa00' });
                return;
            }

            if (!lib.getEnergy(creep)) {
                // Idle near spawn
                if (home && creep.room.name !== home) lib.goToRoom(creep, home);
            }
            return;
        }

        // Deliver to home room
        if (home && creep.room.name !== home) {
            lib.goToRoom(creep, home);
            return;
        }
        if (!lib.deliverEnergy(creep)) {
            // Upgrade as overflow sink
            if (creep.room.controller && creep.room.controller.my) {
                if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    lib.moveTo(creep, creep.room.controller, { stroke: '#3333ff' });
                }
            }
        }
    },
};

const worker = {
    run(creep) {
        toggleWorking(creep);
        const home = lib.homeOf(creep);

        if (!creep.memory.working) {
            if (home && creep.room.name !== home && !creep.memory.allowRemoteHarvest) {
                lib.goToRoom(creep, home);
                return;
            }
            lib.getEnergy(creep);
            return;
        }

        if (home && creep.room.name !== home) {
            lib.goToRoom(creep, home);
            return;
        }

        const room = creep.room;

        // Priority: fill spawns/ext/towers → build → repair → upgrade
        if (lib.deliverEnergy(creep, { allowStorage: false })) return;

        const site = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES);
        if (site) {
            creep.say('🚧');
            if (creep.build(site) === ERR_NOT_IN_RANGE) lib.moveTo(creep, site, { stroke: '#ff0000' });
            return;
        }

        const repair = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s =>
                s.hits < s.hitsMax &&
                s.structureType !== STRUCTURE_WALL &&
                s.structureType !== STRUCTURE_RAMPART &&
                s.hits / s.hitsMax < 0.7,
        });
        if (repair) {
            creep.say('🔧');
            if (creep.repair(repair) === ERR_NOT_IN_RANGE) lib.moveTo(creep, repair, { stroke: '#ff66aa' });
            return;
        }

        if (room.controller && room.controller.my) {
            creep.say('⬆');
            if (creep.upgradeController(room.controller) === ERR_NOT_IN_RANGE) {
                lib.moveTo(creep, room.controller, { stroke: '#3333ff' });
            }
        }
    },
};

const upgrader = {
    run(creep) {
        toggleWorking(creep);
        const home = lib.homeOf(creep);
        if (home && creep.room.name !== home) {
            lib.goToRoom(creep, home);
            return;
        }

        if (!creep.memory.working) {
            // Prefer container/storage near controller
            const ctrl = creep.room.controller;
            if (ctrl) {
                const near = ctrl.pos.findInRange(FIND_STRUCTURES, 3, {
                    filter: s =>
                        (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) &&
                        s.store[RESOURCE_ENERGY] > 0,
                });
                if (near.length) {
                    if (creep.withdraw(near[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        lib.moveTo(creep, near[0], { stroke: '#ffaa00' });
                    }
                    return;
                }
            }
            lib.getEnergy(creep);
            return;
        }

        if (creep.room.controller && creep.room.controller.my) {
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                lib.moveTo(creep, creep.room.controller, { stroke: '#3333ff' });
            }
        }
    },
};

const builder = {
    run(creep) {
        toggleWorking(creep);
        const home = lib.homeOf(creep);
        const buildRoom = creep.memory.targetRoom || home;

        if (!creep.memory.working) {
            if (home && creep.room.name !== home) {
                lib.goToRoom(creep, home);
                return;
            }
            lib.getEnergy(creep);
            return;
        }

        if (buildRoom && creep.room.name !== buildRoom) {
            lib.goToRoom(creep, buildRoom);
            return;
        }

        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) lib.moveTo(creep, site, { stroke: '#ff0000' });
            return;
        }

        // Fortify
        const hitsTarget = (creep.room.controller && creep.room.controller.level >= config.fortify.lateRcl)
            ? config.fortify.rampartHitsLate
            : config.fortify.rampartHits;

        const fort = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s =>
                (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
                s.hits < hitsTarget,
        });
        if (fort) {
            if (creep.repair(fort) === ERR_NOT_IN_RANGE) lib.moveTo(creep, fort, { stroke: '#ff66aa' });
            return;
        }

        // Fall back to worker behavior
        worker.run(creep);
    },
};

const scout = {
    run(creep) {
        const target = creep.memory.targetRoom;
        if (!target) {
            // Pick adjacent unscounted / stale room
            const home = lib.homeOf(creep) || creep.room.name;
            const neighbors = lib.adjacentRooms(home);
            let best = null;
            let bestAge = -1;
            for (const n of neighbors) {
                const mem = Memory.rooms[n];
                const age = mem && mem.scouted ? Game.time - mem.scouted : 99999;
                if (age > bestAge) {
                    bestAge = age;
                    best = n;
                }
            }
            // Also wander empire frontier
            if (Memory.empire && Memory.empire.scoutQueue && Memory.empire.scoutQueue.length) {
                best = Memory.empire.scoutQueue.shift();
            }
            creep.memory.targetRoom = best || neighbors[0];
        }

        if (creep.memory.targetRoom && creep.room.name !== creep.memory.targetRoom) {
            lib.goToRoom(creep, creep.memory.targetRoom);
            return;
        }

        // Arrived — intel is written by memoryManager; pick next
        creep.say('👁');
        creep.memory.targetRoom = null;
        // Sign controller if present & free
        if (creep.room.controller && !creep.room.controller.owner) {
            // just observe
        }
    },
};

const claimer = {
    run(creep) {
        const target = creep.memory.targetRoom;
        if (!target) return;

        if (creep.room.name !== target) {
            lib.goToRoom(creep, target);
            return;
        }

        const ctrl = creep.room.controller;
        if (!ctrl) return;

        if (ctrl.my) {
            if (creep.signController(ctrl, config.signature) === ERR_NOT_IN_RANGE) {
                lib.moveTo(creep, ctrl);
            } else {
                creep.suicide();
            }
            return;
        }

        if (ctrl.owner) {
            creep.say('blocked');
            return;
        }

        const res = creep.claimController(ctrl);
        if (res === ERR_NOT_IN_RANGE) lib.moveTo(creep, ctrl, { stroke: '#00ff00' });
        else if (res === ERR_GCL_NOT_ENOUGH) creep.say('GCL');
        else if (res === OK) {
            lib.log(`Claimed ${target}`);
            creep.signController(ctrl, config.signature);
        }
    },
};

const reserver = {
    run(creep) {
        const target = creep.memory.targetRoom;
        if (!target) return;
        if (creep.room.name !== target) {
            lib.goToRoom(creep, target);
            return;
        }
        const ctrl = creep.room.controller;
        if (!ctrl || ctrl.owner) return;
        if (creep.reserveController(ctrl) === ERR_NOT_IN_RANGE) lib.moveTo(creep, ctrl, { stroke: '#88ff88' });
    },
};

const pioneer = {
    run(creep) {
        const target = creep.memory.targetRoom;
        if (!target) {
            worker.run(creep);
            return;
        }

        if (creep.room.name !== target) {
            // Carry energy into the room when possible
            if (creep.store[RESOURCE_ENERGY] === 0 && lib.homeOf(creep) &&
                creep.room.name === lib.homeOf(creep)) {
                lib.getEnergy(creep);
                return;
            }
            lib.goToRoom(creep, target);
            return;
        }

        toggleWorking(creep);

        // In target room: build spawn first, then other sites, harvest locally
        if (!creep.memory.working) {
            lib.getEnergy(creep);
            return;
        }

        // Prefer spawn construction
        const spawnSite = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: s => s.structureType === STRUCTURE_SPAWN,
        })[0];
        if (spawnSite) {
            if (creep.build(spawnSite) === ERR_NOT_IN_RANGE) lib.moveTo(creep, spawnSite, { stroke: '#ff0000' });
            return;
        }

        // Place spawn if claimed & missing
        if (creep.room.controller && creep.room.controller.my &&
            creep.room.find(FIND_MY_SPAWNS).length === 0 &&
            creep.room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length === 0) {
            // construction module usually places it; try a simple placement near controller/sources
            const pos = findSpawnPos(creep.room);
            if (pos) creep.room.createConstructionSite(pos.x, pos.y, STRUCTURE_SPAWN);
            return;
        }

        const site = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) lib.moveTo(creep, site, { stroke: '#ff0000' });
            return;
        }

        if (creep.room.controller && creep.room.controller.my) {
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                lib.moveTo(creep, creep.room.controller, { stroke: '#3333ff' });
            }
        }
    },
};

function findSpawnPos(room) {
    const ctrl = room.controller;
    const sources = room.find(FIND_SOURCES);
    // Bias toward midpoint of controller and first source
    let x = ctrl.pos.x;
    let y = ctrl.pos.y;
    if (sources.length) {
        x = Math.round((ctrl.pos.x + sources[0].pos.x) / 2);
        y = Math.round((ctrl.pos.y + sources[0].pos.y) / 2);
    }
    for (let r = 0; r < 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const px = x + dx;
                const py = y + dy;
                if (px < 2 || px > 47 || py < 2 || py > 47) continue;
                const pos = new RoomPosition(px, py, room.name);
                const terrain = room.getTerrain().get(px, py);
                if (terrain === TERRAIN_MASK_WALL) continue;
                const blocked = pos.lookFor(LOOK_STRUCTURES).length || pos.lookFor(LOOK_CONSTRUCTION_SITES).length;
                if (blocked) continue;
                // Need open area (spawn footprint)
                return pos;
            }
        }
    }
    return null;
}

const defender = {
    run(creep) {
        const home = lib.homeOf(creep);
        const targetRoom = creep.memory.targetRoom || home;

        if (targetRoom && creep.room.name !== targetRoom) {
            lib.goToRoom(creep, targetRoom);
            return;
        }

        const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (hostile) {
            creep.say('⚔');
            if (creep.attack(hostile) === ERR_NOT_IN_RANGE) lib.moveTo(creep, hostile, { stroke: '#ff0000' });
            return;
        }

        const hStruct = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType !== STRUCTURE_CONTROLLER,
        });
        if (hStruct) {
            if (creep.attack(hStruct) === ERR_NOT_IN_RANGE) lib.moveTo(creep, hStruct, { stroke: '#ff0000' });
            return;
        }

        // Park near spawn
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn && !creep.pos.inRangeTo(spawn, 3)) lib.moveTo(creep, spawn);
    },
};

const remoteMiner = {
    run(creep) {
        miner.run(creep);
    },
};

const remoteHauler = {
    run(creep) {
        toggleWorking(creep);
        const home = lib.homeOf(creep);
        const remote = creep.memory.targetRoom;

        if (!creep.memory.working) {
            if (remote && creep.room.name !== remote) {
                lib.goToRoom(creep, remote);
                return;
            }
            // Pull from remote containers / dropped
            if (!lib.getEnergy(creep)) {
                const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
                // Wait near source for miner drops
                if (source && !creep.pos.inRangeTo(source, 2)) lib.moveTo(creep, source);
            }
            return;
        }

        if (home && creep.room.name !== home) {
            lib.goToRoom(creep, home);
            return;
        }
        if (!lib.deliverEnergy(creep)) {
            if (creep.room.controller && creep.room.controller.my) {
                if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    lib.moveTo(creep, creep.room.controller);
                }
            }
        }
    },
};

module.exports = {
    miner,
    hauler,
    worker,
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
