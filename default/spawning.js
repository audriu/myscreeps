const functions = require('functions');
const shuffleArray = functions.shuffleArray;
const role_colonist = require('role.colonist');

const body_plan_worker = [
    WORK, WORK, WORK, WORK,// WORK, WORK, 
    MOVE, MOVE, MOVE, MOVE,
    CARRY, CARRY, CARRY, CARRY//, CARRY
];
//{"move": 50, "work": 100, "attack": 80, "carry": 50, "heal": 250, "ranged_attack": 150, "tough": 10, "claim": 600}


const body_cost = 800;
const number_harvesters = 3;
const number_builders = 5;
const number_upgraders = 1;
const number_upgraders_link = 0;
const number_colonists = 0;

module.exports = {
    handle_spawning: function (room) {
        const theSpawn = Game.spawns['Spawn1'];
        const energy_available = theSpawn.room.energyAvailable;
        const builders = _.filter(Game.creeps, (creep) => creep.memory.role === 'builder');
        const upgraders = _.filter(Game.creeps, (creep) => creep.memory.role === 'upgrader');
        const link_upgraders = _.filter(Game.creeps, (creep) => creep.memory.role === 'upgrader_link');
        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role === 'harvester');
        const colonists = _.filter(Game.creeps, (creep) => creep.memory.role === 'colonist');

        if (harvesters.length < number_harvesters && !theSpawn.spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Harvester' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'harvester' } });
        } else if (builders.length < number_builders && !theSpawn.spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Builder' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'builder', targetRoom: 'W33S42' } });
        } else if (upgraders.length < number_upgraders && !theSpawn.spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Upgrader' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'upgrader' } });
        } else if (link_upgraders.length < number_upgraders_link && !theSpawn.spawning && energy_available >= 200) {
            const body_plan_upg_link = [WORK, MOVE, CARRY];
            const body_plan_worker_shuffled = shuffleArray(body_plan_upg_link);
            const newName = 'Upgrader_link' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'upgrader_link' } });
        } else if (colonists.length < number_colonists && !theSpawn.spawning && energy_available >= role_colonist.bodyPrice) {
            const body_plan = shuffleArray(role_colonist.bodyPlan);
            const newName = 'COLONIST' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan, newName, { memory: { role: 'colonist', target: 'W33S42' } });
        }

        if (theSpawn.spawning) {
            const spawningCreep = Game.creeps[theSpawn.spawning.name];
            theSpawn.room.visual.text(
                '🛠️' + spawningCreep.memory.role,
                theSpawn.pos.x,
                theSpawn.pos.y,
                { align: 'left', opacity: 0.8 });
        }
    }
};
