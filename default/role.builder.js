module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            creep.say('🚧⛏️');
            if (creep.store.getFreeCapacity() > 0) {
                const sources = creep.room.find(FIND_SOURCES);
                if (creep.harvest(sources[1]) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(sources[1], {visualizePathStyle: {stroke: '#ffaa00'}});
                }
            } else {
                creep.memory.harvesting = false;
            }
        } else {
            const repair_targets = creep.room.find(FIND_STRUCTURES, {
                filter: object => object.hits < (object.hitsMax - 500)
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
                        creep.moveTo(targets[0], {visualizePathStyle: {stroke: '#ff0000'}});
                    }
                } else {
                    creep.say('🚧🔼');
                    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#00ff00'}});
                    }
                }
            }

            if (creep.store[RESOURCE_ENERGY] === 0)
                creep.memory.harvesting = true;
        }
    }
};