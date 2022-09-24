const tasks = require('tasks');

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            tasks.harvest(creep, 1);
        } else {
            creep.say('U🔼');
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#3333ff' } });
            }
        }
    }
};
