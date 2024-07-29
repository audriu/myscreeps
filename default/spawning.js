const fighterBodyCost = 800;
const fighterBodyPlan = [
    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, //300
    ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, //400
    TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
    TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,//100
];

const antBodyPlan = [
    WORK, WORK, WORK, WORK,
    MOVE, MOVE, MOVE, MOVE,
    CARRY, CARRY, CARRY, CARRY];
const antBodyCost = 800;

const default_room_config = {
    body_cost: 200,
    body_plan: [MOVE, WORK, CARRY],
    contingent: {
        'ant': 8
    }
}

//{ "move": 50, "work": 100, "attack": 80, "carry": 50, "heal": 250, "ranged_attack": 150, "tough": 10, "claim": 600 }
const room_configs = {
    'W13N56': {
        default_spawn: 'Spawn1',
        body_cost: antBodyCost,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 9
        }
    }
    ,'W13N56': {
        default_spawn: 'Spawn1',
        body_cost: 200,
        body_plan: [MOVE, WORK, CARRY],
        contingent: {
            'ant': 3
        }
    }
    ,'W13N56': {
        default_spawn: 'Spawn1',
        body_cost: 200,
        body_plan: [MOVE, WORK, CARRY],
        contingent: {
            'ant': 3
        }
    }
}

module.exports = {
    delete_dead_creeps: function () {
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
            }
        }
    },
    handleSpawningForRooms: function () {
        for (const [roomName, room] of Object.entries(Game.rooms)) {
            const config = room_configs[roomName];

            if (!config) {
                continue;
            }

            let theSpawn = Game.spawns[config.default_spawn];// || Object.values(Game.spawns).filter(spawn => spawn.room.name === roomName);
            if (!theSpawn) {



                console.log(Object.values("1111"));
                console.log(roomName);
                console.log(room_configs[roomName]);
                console.log(Object.values(default_room_config));

                console.log(Object.values("6666"));

                console.log(Object.values(Game.spawns));
                console.log(Object.values(roomName));
                console.log(Object.values(Game.spawns).filter(spawn => spawn.room.name === roomName));
                console.log(typeof Object.values(Game.spawns).filter(spawn => spawn.room.name === roomName));
                console.log(Object.values(Game.spawns).filter(spawn => spawn.room.name === roomName).room);


            }
            const energy_available = theSpawn.room.energyAvailable;

            Object.entries(config.contingent).forEach(([role, count]) => {
                const creeps = _.filter(Game.creeps, (creep) => creep.memory.role === role && creep.memory.targetRoom === roomName);
                if (creeps.length < count && !theSpawn.spawning && energy_available >= config.body_cost) {
                    const newName = role + "-" + roomName + "-" + Game.time;
                    const memory = { role: role, targetRoom: roomName };
                    console.log('Spawning new ' + newName + ' in ' + roomName);
                    theSpawn.spawnCreep(_.shuffle(config.body_plan), newName, { memory: memory });
                } else if (energy_available >= fighterBodyCost) {
                    const spawnsInRoom = Object.values(Game.spawns).filter(spawn => spawn.room.name === roomName);
                    for (const spawn of spawnsInRoom) {
                        const spawnRes = spawn.spawnCreep(_.shuffle(fighterBodyPlan), 'badass' + Game.time + spawn, { memory: { role: "fighter", targetRoom: 'W13N56' } });
                        console.log('Spawning new fighter ' + spawnRes);
                    }
                }
            });

            if (theSpawn.spawning) {
                theSpawn.room.visual.text('🥚' + Game.creeps[theSpawn.spawning.name].memory.role, theSpawn.pos.x, theSpawn.pos.y);
            }
        };
    }
};
