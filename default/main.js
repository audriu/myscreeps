const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleUpgraderLink = require('role.upgrader.link');
const roleBuilder = require('role.builder');
const roleColonist = require('role.colonist');
const spawning_ = require('spawning');
const tasks = require('tasks');
const towers = require('towers');
const links = require('links');

module.exports.loop = function () {

    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
            console.log('Clearing non-existing creep memory:', name);
        }
    }

    const rooms = ['W34S42', 'W33S42'];
    rooms.forEach(spawning_.handle_spawning);
    rooms.forEach(towers);

    links();

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const role = creep.memory.role;

        if (creep.memory.targetRoom && creep.room.name != creep.memory.targetRoom) {
            tasks.goToYourRoom(creep);
        } else if (creep.memory.task === 'renewing') {
            tasks.renew(creep);
        } else {
            if (role === 'harvester') {
                roleHarvester.run(creep);
            } else if (role === 'upgrader') {
                roleUpgrader.run(creep);
            } else if (role === 'upgrader_link') {
                roleUpgraderLink.run(creep);
            } else if (role === 'builder') {
                roleBuilder.run(creep);
            } else if (role === 'colonist') {
                roleColonist.run(creep);
            } else if (role === 'old') {
                tasks.old(creep);
            }
        }

        if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive > 100) {
            creep.memory.harvesting = true;
        } else if (creep.store[RESOURCE_ENERGY] === 0 && creep.ticksToLive < 100) {
            creep.memory.role = 'old';
        }
    }
}
