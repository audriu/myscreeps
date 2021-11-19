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

const body_plan_worker = [
    WORK, WORK, WORK,
    MOVE, MOVE, MOVE, MOVE,
    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY
];



const body_cost = 800;
const number_harvesters = 3;
const number_builders = 4;
const number_upgraders = 0;
const number_upgraders_link = 1;

module.exports = {
    handle_spawning: function () {
        const theSpawn = Game.spawns['Spawn2'];
        const energy_available = theSpawn.room.energyAvailable;
        //{"move": 50, "work": 100, "attack": 80, "carry": 50, "heal": 250, "ranged_attack": 150, "tough": 10, "claim": 600}
        const builders = _.filter(Game.creeps, (creep) => creep.memory.role === 'builder');
        const upgraders = _.filter(Game.creeps, (creep) => creep.memory.role === 'upgrader');
        const link_upgraders = _.filter(Game.creeps, (creep) => creep.memory.role === 'upgrader_link');
        const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role === 'harvester');

        if (harvesters.length < number_harvesters && !theSpawn.spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Harvester' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'harvester' } });
            console.log('Spawning new harvester: ' + resp);
        } else if (builders.length < number_builders && !theSpawn.spawning && energy_available >= 8500) {
            const body_plan_builder = [
                WORK, WORK, WORK, WORK,
                MOVE, MOVE, MOVE, MOVE,
                CARRY, CARRY, CARRY, CARRY, CARRY
            ];
            const body_plan_worker_shuffled = shuffleArray(body_plan_builder);
            const newName = 'Builder' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'builder' } });
            console.log('Spawning new builder ' + resp);
        } else if (upgraders.length < number_upgraders && !theSpawn.spawning && energy_available >= body_cost) {
            const body_plan_worker_shuffled = shuffleArray(body_plan_worker);
            const newName = 'Upgrader' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'upgrader' } });
            console.log('Spawning new upgrader' + resp);
        } else if (link_upgraders.length < number_upgraders_link && !theSpawn.spawning && energy_available >= 200) {
            const body_plan_upg_link = [
                WORK,
                MOVE,
                CARRY
            ];
            const body_plan_worker_shuffled = shuffleArray(body_plan_upg_link);
            const newName = 'Upgrader_link' + Game.time;
            const resp = theSpawn.spawnCreep(body_plan_worker_shuffled, newName, { memory: { role: 'upgrader_link' } });
            console.log('Spawning new link upgrader ' + resp);
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
