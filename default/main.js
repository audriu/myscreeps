const spawning = require('spawning');
const tasks = require('tasks');
const towers = require('towers');

module.exports = {
    loop: function () {
        const diena = Memory.diena ? Memory.diena : 1
        Memory.diena = (diena > 6) ? 1 : diena + 1

        switch (diena) {
            case 6:
                spawning.handleSpawningForRooms();
                break;
            case 7:
                spawning.delete_dead_creeps();
                break;
            default:
        }

        towers();

        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const role = creep.memory.role;

            if (role === 'fighter') {
                creep.memory.targetRoom = 'W13N56';
            }

            if (role === 'ant' && creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive > 100) {
                tasks.turnOnMining(creep);
            } else if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive < 100) {
                tasks.suicide(creep);
            }

            if (creep.memory.targetRoom && (creep.room.name != creep.memory.targetRoom)) {
                tasks.goToYourRoom(creep);
            } else if (role === 'ant') {
                tasks.work(creep);
            } else if (role === 'colonist') {
                tasks.claim(creep);
            } else if (role === 'fighter') {
                tasks.fight(creep);
            }
        }
    }
}

//Game.spawns['Spawn1'].spawnCreep([CLAIM, MOVE],'colonist1',{memory:{role:'colonist',targetRoom:'W13N57'}});
//Game.spawns['Spawn1'].spawnCreep([ATTACK, MOVE],'badass ' + Game.time ,{memory:{role:'fighter',targetRoom:'E41S59'}});
// bodyPlan: [CLAIM, MOVE], bodyPrice: 650