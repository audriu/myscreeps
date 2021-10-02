module.exports = {
    run: function (creep) {
        const sources = creep.room.find(FIND_SOURCES);
        if (creep.memory.harvesting) {
            creep.say('U⛏️');
            if (creep.store.getFreeCapacity() > 0) {
                if (creep.harvest(sources[1]) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(sources[1], {visualizePathStyle: {stroke: '#3333ff'}});
                }
            } else {
                creep.memory.harvesting = false;
            }
        } else {
            creep.say('U🔼');
            if (creep.store[RESOURCE_ENERGY] === 0) {
                if (creep.harvest(sources[0]) === ERR_NOT_IN_RANGE) {
                    creep.say('dis');
                    creep.moveTo(sources[0], {visualizePathStyle: {stroke: '#3333ff'}});
                }
            } else {
                if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#3333ff'}});
                }
            }
            if (creep.store[RESOURCE_ENERGY] === 0)
                creep.memory.harvesting = true;
        }
    }
};