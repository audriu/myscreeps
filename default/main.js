const taskRenew = require('task.renew');
const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleUpgraderLink = require('role.upgrader.link');
const roleBuilder = require('role.builder');
const spawning_ = require('spawning');
const towers = require('towers');
const links = require('links');

module.exports.loop = function () {

    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
            console.log('Clearing non-existing creep memory:', name);
        }
    }

    spawning_.handle_spawning();
    towers();
    links();

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const role = creep.memory.role;

        // if (creep.ticksToLive < 100){
        //     creep.memory.task = 'renewing';
        // }

        if (creep.memory.task === 'renewing') {
            taskRenew.run(creep);
        } else {
            if (role === 'harvester') {
                roleHarvester.run(creep);
            } else if (role === 'upgrader') {
                roleUpgrader.run(creep);
            } else if (role === 'upgrader_link') {
                roleUpgraderLink.run(creep);
            } else if (role === 'builder') {
                roleBuilder.run(creep);
            }
        }
    }
}