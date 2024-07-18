const antBodyPlan = [WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, CARRY, CARRY, CARRY];
const room_configs = {
    'W34S42': {
        default_spawn: 'Spawn1',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 6
        }
    },
    'W33S42': {
        default_spawn: 'Spawn4',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 4
        }
    },
    'W32S42': {
        default_spawn: 'Spawn5',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 4
        }
    },
    'W31S42': {
        default_spawn: 'Spawn5',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 2
        }
    },
    'W33S41': {
        default_spawn: 'Spawn7',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 3
        }
    },
    'W33S43': {
        default_spawn: 'Spawn9', //9
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 3
        }
    },
    'W32S43': {
        default_spawn: 'Spawn8',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 3
        }
    },
    'W32S41': {
        default_spawn: 'Spawn6',
        body_cost: 800,
        body_plan: antBodyPlan,
        contingent: {
            'ant': 3
        }
    },
    'W32S41': {
        default_spawn: 'Spawn10',
        body_cost: 800,
        body_plan: antBodyPlan,
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
            const theSpawn = Game.spawns[config.default_spawn];
            const energy_available = theSpawn.room.energyAvailable;

            Object.entries(config.contingent).forEach(([role, count]) => {
                const creeps = _.filter(Game.creeps, (creep) => creep.memory.role === role && creep.memory.targetRoom === room);
                if (creeps.length < count && !theSpawn.spawning && energy_available >= config.body_cost) {
                    const newName = role + "-" + roomName + "-" + Game.time;
                    const memory = { role: role, targetRoom: roomName };
                    console.log('Spawning new ' + newName + ' in ' + roomName);
                    theSpawn.spawnCreep(_.shuffle(config.body_plan), newName, { memory: memory });
                }
            });

            if (theSpawn.spawning) {
                theSpawn.room.visual.text('🥚' + Game.creeps[theSpawn.spawning.name].memory.role, theSpawn.pos.x, theSpawn.pos.y);
            }
        };
    }
};
