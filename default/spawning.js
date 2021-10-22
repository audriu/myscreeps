function shuffleArray(array) {
    let curId = array.length;
    while (0 !== curId) {
        let randId = Math.floor(Math.random() * curId);
        curId -= 1;
        let tmp = array[curId];
        array[curId] = array[randId];
        array[randId] = tmp;
    }
    return array;
}

//{"move": 50, "work": 100, "attack": 80, "carry": 50, "heal": 250, "ranged_attack": 150, "tough": 10, "claim": 600}
const body_plan_worker = [
    WORK, WORK, WORK,
    MOVE, MOVE, MOVE, MOVE,
    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY
];

const body_cost = 850;
const number_harvesters = 3;
const number_builders = 2;
const number_upgraders = 1;
const number_upgraders_link = 5;

module.exports = {
    handle_spawning: function () {
        const energy_available = Game.spawns['Spawn1'].room.energyAvailable;

        const builders = _.filter(Game.creeps, (creep) => creep.memory.role === 'builder');
        const upgraders = _.filter(Game.creeps, (creep) => creep.memory.role === 'upgrader');
        const link_upgraders = _.filter(Game.creeps, (creep) => creep.memory.role === 'upgrader_link');
        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role === 'harvester');

        if (harvesters.length < number_harvesters && !Game.spawns['Spawn1'].spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Harvester' + Game.time;
            const resp = Game.spawns['Spawn1'].spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'harvester' } });
            console.log('Spawning new harvester: ' + resp);
        } else if (upgraders.length < number_upgraders && !Game.spawns['Spawn1'].spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Upgrader' + Game.time;
            const resp = Game.spawns['Spawn1'].spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'upgrader' } });
            console.log('Spawning new upgrader' + resp);
        } else if (link_upgraders.length < number_upgraders_link && !Game.spawns['Spawn1'].spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Upgrader_link' + Game.time;
            const resp = Game.spawns['Spawn1'].spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'upgrader_link' } });
            console.log('Spawning new link upgrader ' + resp);
        } else if (builders.length < number_builders && !Game.spawns['Spawn1'].spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Builder' + Game.time;
            const resp = Game.spawns['Spawn1'].spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'builder' } });
            console.log('Spawning new builder ' + resp);
        }

        if (Game.spawns['Spawn1'].spawning) {
            const spawningCreep = Game.creeps[Game.spawns['Spawn1'].spawning.name];
            Game.spawns['Spawn1'].room.visual.text(
                '🛠️' + spawningCreep.memory.role,
                Game.spawns['Spawn1'].pos.x,
                Game.spawns['Spawn1'].pos.y,
                { align: 'left', opacity: 0.8 });
        }
    }
};
