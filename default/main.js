const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleUpgraderLink = require('role.upgrader.link');
const roleBuilder = require('role.builder');
const roleColonist = require('role.colonist');
const roleFighter = require('role.fighter');
const spawning_ = require('spawning');
const tasks = require('tasks');
const towers = require('towers');
const links = require('links');

hi = function () {
    console.log("hi!!!")
}

module.exports = {
    hi: hi
}


module.exports.loop = function () {
    const diena = Memory.diena ? Memory.diena : 1
    Memory.diena = (diena > 6) ? 1 : diena + 1

    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }

    switch (diena) {
        case 1:
            console.log('Pirmadienis - kambariu rekonfiguracija' + JSON.stringify(Game.rooms));
            break;
        case 2:

            break;
        default:

    }

    const rooms = ['W34S42', 'W33S42', 'W32S42', 'W32S41', 'W33S41', 'W32S43', 'W33S43'];
    rooms.forEach(spawning_.handle_spawning);
    rooms.forEach(towers);

    links();

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
        } else if (role === 'upgrader_link') {
            roleUpgraderLink.run(creep);
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
            creep.memory.role = 'old';
        }
    }
}
