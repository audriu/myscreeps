const tasks = require('tasks');

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            const source = creep.room.find(FIND_SOURCES)[1];
            tasks.harvest(creep, source);
        } else {
            const repair_targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => structure.hits < (structure.hitsMax * 0.5) && structure.structureType != STRUCTURE_WALL
            })

            repair_targets.sort((a, b) => a.hits - b.hits);

            if (repair_targets.length > 5) {
                creep.say('🚧🛠️');
                if (creep.repair(repair_targets[0]) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(repair_targets[0]);
                }
            } else {
                const construction_targets = creep.room.find(FIND_CONSTRUCTION_SITES);
                const targets = _.sortBy(construction_targets, s => creep.pos.getRangeTo(s))

                if (targets.length) {
                    creep.say('🚧🔨');
                    if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ff0000' } });
                    }
                } else {
                    creep.say('🚧🔼L"');
                    //const link0 = Game.getObjectById('62529f7ba8265e7dbcf55a13');
                    //if (link0 && creep.transfer(link0, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    //    creep.say('🚧🔼L"');
                    //    creep.moveTo(link0, { visualizePathStyle: { stroke: '#ffffff' } });
                    //}
                    // if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    //     creep.say('🚧🔼');
                    //     creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#00ff00'}});
                    // }
                }
            }
        }
    }
};
