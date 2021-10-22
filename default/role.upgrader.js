const tasks = require('tasks');

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            const source = creep.room.find(FIND_SOURCES)[1];
            tasks.harvest(creep, source);
        } else {
            creep.say('U🔼');
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#3333ff' } });
            }
        }
    }
};
