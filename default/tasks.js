module.exports = {
    goToYourRoom: function (creep) {
        creep.say('moving out');
        const exit = creep.room.findExitTo(creep.memory.targetRoom);
        creep.moveTo(creep.pos.findClosestByRange(exit));
    },
    old: function (creep) {
        creep.say('💀');
        creep.suicide();
    },
    harvest: function (creep, source_number) {
        let source = creep.room.find(FIND_SOURCES)[source_number];
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
