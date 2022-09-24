module.exports = {
    goToYourRoom: function (creep) {
        creep.say('moving out');
        const exit = creep.room.findExitTo(creep.memory.targetRoom);
        creep.moveTo(creep.pos.findClosestByRange(exit));
    },
    old: function (creep) {
        const tower2 = Game.getObjectById('628f893839dd93c718005417');
        creep.say('💀');
        creep.moveTo(tower2, { visualizePathStyle: { stroke: '#000000', strokeWidth: 1, opacity: 0.1 } });
    },
    harvest: function (creep, source) {
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
    renew: function (creep) {
        creep.say('renewing');
        const renewingStatus = Game.spawns['Spawn1'].renewCreep(creep);

        switch (renewingStatus) {
            case 0:
                break;
            case -4:
                creep.moveTo(Game.spawns['Spawn1'], { visualizePathStyle: { stroke: '#000000' } })
                break;
            case -6:
                creep.moveTo(Game.spawns['Spawn1'], { visualizePathStyle: { stroke: '#000000' } })
                break;
            case -8:
                delete creep.memory.renewing;
                break;
            case -9:
                creep.moveTo(Game.spawns['Spawn1'], { visualizePathStyle: { stroke: '#000000' } })
                break;
            default:
                console.log("renew status: ", renewingStatus);
        }
    },
};
