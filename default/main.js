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
                creep.memory.targetRoom = 'E12N40';
            }

            if (role === 'ant') {
                if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive > 100) {
                    tasks.turnOnMining(creep);
                } else if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive < 100) {
                    tasks.suicide(creep);
                }
            }

            if (creep.memory.targetRoom && (creep.room.name != creep.memory.targetRoom)) {
                tasks.goToYourRoom(creep);
            } else if (role === 'ant') {
                tasks.work(creep);
            } else if (role === 'colonist') {
                tasks.claim(creep);
            } else if (role === 'fighter') {
                //creep.memory.targetRoom = 'E13N39';
                tasks.fight(creep);
            }
        }
    }
}

//Game.spawns['Spawn1'].spawnCreep([CLAIM, MOVE],'colonist1',{memory:{role:'colonist',targetRoom:'E11N34'}});
//Game.spawns['Spawn1'].spawnCreep([ATTACK, MOVE],'badass ' + Game.time ,{memory:{role:'fighter',targetRoom:'E41S59'}});
// bodyPlan: [CLAIM, MOVE], bodyPrice: 650


//Spawn in random spawn and configure just room and not spawn name. Default if null.
//Change sources if harvesting from empty and another is full
//Maybe to set default source - better solution I think