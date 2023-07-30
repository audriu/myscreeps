const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleColonist = require('role.colonist');
const roleFighter = require('role.fighter');
const spawning_ = require('spawning');
const tasks = require('tasks');
const towers = require('towers');
const spawning = require('./spawning');

let rooms

loop = function () {
    const diena = Memory.diena ? Memory.diena : 1
    Memory.diena = (diena > 6) ? 1 : diena + 1

    switch (diena) {
        case 1:
            console.log('Pirmadienis - kambariu rekonfiguracija' + JSON.stringify(Game.rooms));
            rooms = Object.keys(Game.rooms);
            break;
        case 2:
            console.log('Antradienis');
            break;
        case 6:
            rooms.forEach(spawning_.handle_spawning);
            spawning_.delete_dead_creeps();
            break;
        default:
    }

    rooms.forEach(towers);

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const role = creep.memory.role;

        if (creep.memory.harvesting && (creep.memory.targetRoom && creep.room.name != creep.memory.targetRoom)) {
            tasks.goToYourRoom(creep);
        } else if (creep.memory.task === 'renewing') {
            tasks.renew(creep);
        } else if (role === 'harvester') {
            roleHarvester.run(creep);
        } else if (role === 'upgrader') {
            roleUpgrader.run(creep);
        } else if (role === 'builder') {
            roleBuilder.run(creep);
        } else if (role === 'colonist' && role !== 'fighter') {
            roleColonist.run(creep);
        } else if (role === 'old') {
            tasks.old(creep);
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

hi = function () {
    console.log("hi!!!")
}

module.exports = {
    hi: hi,
    loop: loop,
    rooms: rooms
}

//Game.spawns['Spawn1'].spawnCreep([WORK, CARRY, MOVE], 'Builder1', { memory: { role: 'builder' } });
//Game.spawns['Spawn1'].room.createConstructionSite(23, 22, STRUCTURE_TOWER);
//Game.spawns['Spawn1'].room.controller.activateSafeMode();

// for (const name in Game.rooms) {
//     console.log('Room "' + name + '" has ' + Game.rooms[name].energyAvailable + ' energy');
// }

//OBSTACLE_OBJECT_TYPES: ["spawn", "creep", "powerCreep", "source", "mineral", "deposit", "controller", "constructedWall", "extension", "link", "storage", "tower", "observer", "powerSpawn", "powerBank", "lab", "terminal", "nuker", "factory", "invaderCore"]
