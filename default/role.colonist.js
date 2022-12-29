module.exports = {
    run: function (creep) {
        // if (creep.room.name == 'W33S42') {
        //      creep.say(creep.claimController(Game.rooms['W32S42']));
        //     if (creep.claimController(Game.rooms['W32S42']) == ERR_NOT_IN_RANGE) {
        //         // move towards the controller
        //         creep.moveTo(creep.room.controller);
        //     }
        // } else 


        // if in target room
        if (creep.room.name != creep.memory.targetRoom) {
            //creep.say(creep.memory.targetRoom);
            creep.say(creep.room.name);
            // find exit to target room
            var exit = creep.room.findExitTo(creep.memory.targetRoom);
            // move to exit
            creep.moveTo(creep.pos.findClosestByRange(exit));
        }
        else {
            creep.say('claiming');
            // try to claim controller
            if (creep.claimController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                // move towards the controller
                creep.moveTo(creep.room.controller);
            }
        }
    },
    bodyPlan: [CLAIM, MOVE],
    bodyPrice: 650
};

//Game.spawns['Spawn1'].spawnCreep([CLAIM, MOVE],'colonist1',{memory:{role:'colonist',targetRoom:'W32S42'}});