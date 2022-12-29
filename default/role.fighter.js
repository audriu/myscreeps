module.exports = {
    run: function (creep) {
        // if in target room
        if (creep.room.name != creep.memory.targetRoom) {
            console.log('Fighting enemies in another the room');
            //creep.say(creep.memory.targetRoom);
            creep.say(creep.room.name);
            // find exit to target room
            var exit = creep.room.findExitTo(creep.memory.targetRoom);
            // move to exit
            creep.moveTo(creep.pos.findClosestByRange(exit));
        }
        else {
            //console.log('Fighting enemies in the room');
            creep.say('fighting');
            var enemies_b = creep.room.find(FIND_HOSTILE_STRUCTURES);
            var enemies = creep.room.find(FIND_HOSTILE_CREEPS);
            enemies = [...enemies, ...enemies_b];
            //console.log('Fighting enemies in the room:' + enemies);
            //attacker.moveTo(enemies[0]);
            //attacker.attack(enemies[0]);
            if (creep.attack(enemies[0]) == ERR_NOT_IN_RANGE) {
                creep.moveTo(enemies[0]);
            }
        }
    },
    bodyPlan: [CLAIM, MOVE],
    bodyPrice: 650
};

//Game.spawns['Spawn1'].spawnCreep([ATTACK, ATTACK, MOVE, MOVE], 'fighter1', { memory: { role: 'fighter', targetRoom: 'W32S41' } });