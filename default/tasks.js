const debuggableScreep = "ant-W32S42-50516135";

debugScreep = function (screep, log_message) {
    if (debuggableScreep === screep.name) {
        console.log(screep.name + " is " + screep.memory.role + " in " + screep.memory.targetRoom + "  :::  " + log_message);
    }
}

goToYourRoom = function (creep) {
    creep.say('moving out');
    const exit = creep.room.findExitTo(creep.memory.targetRoom);
    creep.moveTo(creep.pos.findClosestByRange(exit), { maxRooms: 1 });
}

claim = function (creep) {
    const isClaimed = creep.room.controller && creep.room.controller.owner;
    const isOwnedByMe = isClaimed && creep.room.controller.owner.username === "Dzioba";

    if (isOwnedByMe) {
        if (creep.signController(creep.room.controller, "🐸") == ERR_NOT_IN_RANGE) {
            creep.say('Signing');
            creep.moveTo(creep.room.controller);
        }
    } else if (creep.claimController(creep.room.controller) == ERR_NOT_IN_RANGE) {
        creep.say('Claiming');
        creep.moveTo(creep.room.controller);
    } else {
        creep.say('Claimed');
    }
}

fight = function (creep) {
    creep.say('☠️', true);
    var structures = creep.room.find(FIND_STRUCTURES);
    var nonWallStructures = structures.filter(struct =>
        struct.structureType !== STRUCTURE_WALL &&
        struct.structureType !== STRUCTURE_CONTROLLER);

    var enemies = creep.room.find(FIND_HOSTILE_CREEPS);
    enemies = [...nonWallStructures, ...enemies];
    // If there are hostile creeps, find the closest one
    if (enemies.length > 0) {
        const closestHostile = creep.pos.findClosestByRange(enemies);
        console.log(`Closest enemy is ${closestHostile}`);
        if (creep.attack(closestHostile) == ERR_NOT_IN_RANGE) {
            creep.moveTo(closestHostile,
                {
                    visualizePathStyle: {
                        stroke: '#ff0000',
                        lineWidth: 1
                    }
                });
        }
    }
}

upgrade = function (creep) {
    creep.say('upgrading')
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#3333ff' } });
    }
}

harvest = function (creep) {
    const source = creep.room.find(FIND_SOURCES)[creep.memory.preferedSource || 0];
    creep.say('⛏');

    const harvestRes = creep.harvest(source);
    if (harvestRes === ERR_NOT_IN_RANGE || creep.store.getUsedCapacity() === 0) {
        creep.moveTo(source, { visualizePathStyle: { stroke: '#fff455' } });
    } else if (harvestRes === ERR_NOT_ENOUGH_RESOURCES) {
        creep.memory.harvesting = false;
    }

    if (creep.store.getFreeCapacity() === 0) {
        creep.memory.harvesting = false;
    }
}

unload = function (creep) {
    creep.say('🌽↓');
    debugScreep(creep, "unload 1");
    let targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            const isMyStructure = structure.owner && structure.owner.username === "Dzioba";
            return (
                isMyStructure &&
                ((structure.structureType === STRUCTURE_EXTENSION && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                    (structure.structureType === STRUCTURE_SPAWN && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                    (structure.structureType === STRUCTURE_TOWER && structure.store.getFreeCapacity(RESOURCE_ENERGY) >= 300))
            );
        }
    });
    targets = _.sortBy(targets, s => creep.pos.getRangeTo(s))
    if (targets.length > 0) {
        debugScreep(creep, "unload 2");
        if (creep.transfer(targets[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
        }
    } else {
        debugScreep(creep, "unload 3");
        creep.say('🌽c');
        let containers = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (
                    (structure.structureType === STRUCTURE_CONTAINER && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                    (structure.structureType === STRUCTURE_STORAGE && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0));
            }
        });
        containers = _.sortBy(containers, s => creep.pos.getRangeTo(s))
        if (containers.length > 0) {
            if (creep.transfer(containers[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(containers[0], { visualizePathStyle: { stroke: '#ffffff' } });
            }
        } else {
            debugScreep(creep, "unload 9");
            return "ntd" //means nothing to do
        }
    }
}

build = function (creep) {
    const construction_targets = creep.room.find(FIND_CONSTRUCTION_SITES);
    if (construction_targets.length > 0) {
        const targets = _.sortBy(construction_targets, s => creep.pos.getRangeTo(s))
        creep.say('🚧🔨');
        if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
            creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ff0000' } });
        }
    } else return "ntd" //means nothing to do

}

work = function (creep) {
    if (creep.memory.harvesting) {
        harvest(creep)
    } else {
        let unloadResult = unload(creep);
        debugScreep(creep, "unloading returns:: " + unloadResult);
        if (unload(creep) == "ntd")
            if (build(creep) == "ntd")
                upgrade(creep)
    }
}

suicide = function (creep) {
    if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive < 100) {
        creep.suicide();
    }
}

turnOnMining = function (creep) {
    if (!creep.memory.harvesting) {
        sources = creep.room.find(FIND_SOURCES);
        if (!sources)
            return;
        creep.memory.harvesting = true;
        const numberOfSources = sources.length;
        creep.memory.preferedSource = _.random(numberOfSources - 1);
    }
}

module.exports = {
    goToYourRoom: goToYourRoom,
    claim: claim,
    fight: fight,
    upgrade: upgrade,
    harvest: harvest,
    unload: unload,
    build: build,
    work: work,
    suicide: suicide,
    turnOnMining: turnOnMining
};
