module.exports = {
    run: function (creep) {
        creep.say('^');
        const renewingStatus = Game.spawns['Spawn1'].renewCreep(creep);

        switch (renewingStatus) {
            case 0:
                break;
            case -4:
                creep.moveTo(Game.spawns['Spawn1'], {visualizePathStyle: {stroke: '#000000'}})
                break;
            case -6:
                creep.moveTo(Game.spawns['Spawn1'], {visualizePathStyle: {stroke: '#000000'}})
                break;
            case -8:
                delete creep.memory.renewing;
                break;
            case -9:
                creep.moveTo(Game.spawns['Spawn1'], {visualizePathStyle: {stroke: '#000000'}})
                break;
            default:
                console.log("renew status: ", renewingStatus);
        }

    }
};