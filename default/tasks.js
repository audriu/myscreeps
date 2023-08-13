const debuggableScreep = "ant-W32S42-50514641";

debugScreep (screep, log_message) {
    if (debuggableScreep === screep.name) {
        console.log(screep.name + " is " + screep.memory.role + " in " + screep.memory.targetRoom + " and is " + screep.memory.harvesting);
    }
}


goToYourRoom = function (creep) {
    creep.say('moving out');
    const exit = creep.room.findExitTo(creep.memory.targetRoom);
    creep.moveTo(creep.pos.findClosestByRange(exit));
}

claim = function (creep) {
    creep.say('claiming');
    const claimResult = creep.claimController(creep.room.controller)
    if (claimResult == ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller);
    } else {
        console.log("claiming room returned: " + claimResult)
        creep.signController(creep.room.controller, "")
    }
}

fight = function (creep) {
    creep.say('☠️', true);
    var enemies_b = creep.room.find(FIND_HOSTILE_STRUCTURES);
    var enemies = creep.room.find(FIND_HOSTILE_CREEPS);
    enemies = [...enemies, ...enemies_b];
    if (creep.attack(enemies[0]) == ERR_NOT_IN_RANGE) {
        creep.moveTo(enemies[0]);
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
            return (
                (structure.structureType === STRUCTURE_EXTENSION && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                (structure.structureType === STRUCTURE_SPAWN && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                (structure.structureType === STRUCTURE_TOWER && structure.store.getFreeCapacity(RESOURCE_ENERGY) >= 300));
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
            return false //means nothing to do}
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
    } else return false //means nothing to do

}

work = function (creep) {
    if (creep.memory.harvesting) {
        harvest(creep)
    } else {
        if (!unload(creep))
        ;
            //if (!build(creep))
                //upgrade(creep)
    }
}

suicide = function (creep) {
    if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive < 100) {
        creep.suicide();
    }
}

turnOnMining = function (creep) {
    if (!creep.memory.harvesting) {
        creep.memory.harvesting = true;
        const numberOfSourcesOnDestinationRoom = Game.rooms[creep.memory.targetRoom].find(FIND_SOURCES).length;
        creep.memory.preferedSource = _.random(numberOfSourcesOnDestinationRoom - 1);
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
