const roleRenew = require('role.renew');
const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const spawning_ = require('spawning');
const towers = require('towers');

module.exports.loop = function () {

    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
            console.log('Clearing non-existing creep memory:', name);
        }
    }

    spawning_.handle_spawning();
    towers();

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const role = creep.memory.role;

        if (creep.ticksToLive < 100){
            creep.memory.renewing = true;
        }

        if (creep.memory.renewing) {
            roleRenew.run(creep);
        } else {
            if (role === 'harvester') {
                roleHarvester.run(creep);
            }
            if (role === 'upgrader') {
                roleUpgrader.run(creep);
            }
            if (role === 'builder') {
                roleBuilder.run(creep);
            }
        }
    }
}