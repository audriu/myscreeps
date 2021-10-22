const tasks = require('tasks');

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            const source = creep.room.find(FIND_SOURCES)[1];
            tasks.harvest(creep, source);
        } else {
            const repair_targets = creep.room.find(FIND_STRUCTURES, {
                filter: object => object.hits < (object.hitsMax * 0.5)
            });

            repair_targets.sort((a, b) => a.hits - b.hits);

            if (repair_targets.length > 0) {
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
                    creep.say('🚧🔼');
                    const link2 = Game.getObjectById('6159c5531306ec299858b96e');
                    if (creep.transfer(link2, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(link2, { visualizePathStyle: { stroke: '#ffffff' } });
                    }
                    //if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    //    creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#00ff00'}});
                    //}
                }
            }
        }
    }
};
