module.exports = {
    run: function (creep) {
        const link0 = Game.getObjectById('6252a81257a3be2c2cb4e65b');
        if (creep.memory.harvesting) {
            creep.say('🖇⛏️');
            if (creep.store.getFreeCapacity() > 0) {
                const withdrawRes = creep.withdraw(link0, RESOURCE_ENERGY);
                if (withdrawRes === ERR_NOT_IN_RANGE) {
                    creep.moveTo(link0, { visualizePathStyle: { stroke: '#3333ff' } });
                } else if (withdrawRes === ERR_NOT_ENOUGH_RESOURCES && creep.store.getUsedCapacity() > 0) {
                    creep.memory.harvesting = false;
                }
            } else {
                creep.memory.harvesting = false;
            }
        } else {
            creep.say('🖇🔼');
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#3333ff' } });
            }
        }
    }
};
