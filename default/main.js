const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleColonist = require('role.colonist');
const roleFighter = require('role.fighter');
const spawning = require('spawning');
const tasks = require('tasks');
const towers = require('towers');

module.exports = {
    loop: function () {
        const diena = Memory.diena ? Memory.diena : 1
        Memory.diena = (diena > 6) ? 1 : diena + 1

        switch (diena) {
            case 1:
                Memory.rooms = Object.keys(Game.rooms);
                break;
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

            if (creep.memory.harvesting && (creep.memory.targetRoom && (creep.room.name != creep.memory.targetRoom))) {
                tasks.goToYourRoom(creep);
            } else if (role === 'harvester') {
                roleHarvester.run(creep);
            } else if (role === 'upgrader') {
                roleUpgrader.run(creep);
            } else if (role === 'builder') {
                roleBuilder.run(creep);
            } else if (role === 'colonist' && role !== 'fighter') {
                tasks.claim(creep);
            } else if (role === 'fighter') {
                roleFighter.run(creep);
            }

            if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive > 100) {
                creep.memory.harvesting = true;
            } else if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive < 100) {
                creep.suicide();
            }
        }
    }
}

//Game.spawns['Spawn1'].spawnCreep([CLAIM, MOVE],'colonist1',{memory:{role:'colonist',targetRoom:'W32S42'}});
// bodyPlan: [CLAIM, MOVE], bodyPrice: 650