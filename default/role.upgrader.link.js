module.exports = {
    run: function (creep) {
        const link0 = Game.getObjectById('6159d9c9047f4407ad073350');
        if (creep.memory.harvesting) {
            creep.say('u-⛏️');
            if (creep.store.getFreeCapacity() > 0) {
                if (creep.withdraw(link0, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(link0, {visualizePathStyle: {stroke: '#3333ff'}});
                }
            } else {
                creep.memory.harvesting = false;
            }
        } else {
            creep.say('u-🔼');

            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#3333ff'}});
            }

            if (creep.store[RESOURCE_ENERGY] === 0)
                creep.memory.harvesting = true;
        }
    }
};