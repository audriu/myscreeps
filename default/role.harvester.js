const tasks = require('tasks');

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            const source = creep.room.find(FIND_SOURCES)[0];
            tasks.harvest(creep, source);
        } else {
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

                // } else if (Game.spawns['Spawn1'].energy < Game.spawns['Spawn1'].energyCapacity) {
                //     if (creep.transfer(Game.spawns['Spawn1'], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                //         creep.moveTo(Game.spawns['Spawn1'], {visualizePathStyle: {stroke: '#ffffff'}});
                //     }
            } else {
                creep.say('🌽c');
                let containers = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (
                            (structure.structureType === STRUCTURE_CONTAINER && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0));
                    }
                });
                containers = _.sortBy(containers, s => creep.pos.getRangeTo(s))
                if (containers.length > 0) {
                    if (creep.transfer(containers[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(containers[0], { visualizePathStyle: { stroke: '#ffffff' } });
                    }

                } else {
                    const link1 = Game.getObjectById('6252b52bb5872f357e731d29');
                    if (creep.transfer(link1, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(link1, { visualizePathStyle: { stroke: '#ffffff' } });
                    } else {
                        creep.say('🌽!');
                        creep.memory.harvesting = true;
                    }
                }
            }
        }
    }
};
