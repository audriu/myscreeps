module.exports = {
    goToYourRoom: function (creep) {
        creep.say('moving out');
        const exit = creep.room.findExitTo(creep.memory.targetRoom);
        creep.moveTo(creep.pos.findClosestByRange(exit));
    },
    claim: function (creep) {
        creep.say('claiming');
        const claimResult = creep.claimController(creep.room.controller)
        if (claimResult == ERR_NOT_IN_RANGE) {
            creep.moveTo(creep.room.controller);
        } else {
            console.log("claiming room returned: " + claimResult)
            creep.signController(creep.room.controller, "")
        }
    },
    upgrade: function (creep) {
        creep.say('upgrading')
        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#3333ff' } });
        }
    },
    harvest: function (creep, source_number) {
        let source = creep.room.find(FIND_SOURCES)[source_number];
        if (!source) {
            source = creep.room.find(FIND_SOURCES)[0];
        }

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
    },
    unload: function (creep) {
        creep.say('🌽↓');
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
            if (creep.transfer(targets[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
            }
        } else {
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
            } else return false //means nothing to do
        }
    },
    build: function (creep) {
        const construction_targets = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (construction_targets.length > 0) {
            const targets = _.sortBy(construction_targets, s => creep.pos.getRangeTo(s))
            creep.say('🚧🔨');
            if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
                creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ff0000' }});
            }
        } else return false //means nothing to do

    }
};
