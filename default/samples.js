Game.spawns['Spawn1'].spawnCreep([WORK, CARRY, MOVE], 'Builder1', { memory: { role: 'builder' } });
Game.spawns['Spawn1'].spawnCreep([WORK, CARRY, MOVE], 'Harverster1', { memory: { role: 'harvester' } });
Game.spawns['Spawn1'].spawnCreep([WORK, CARRY, MOVE], 'Upgrader1', { memory: { role: 'upgrader' } });

Game.spawns['Spawn1'].room.createConstructionSite(23, 22, STRUCTURE_TOWER);
Game.spawns['Spawn1'].room.controller.activateSafeMode();

for (const name in Game.rooms) {
    console.log('Room "' + name + '" has ' + Game.rooms[name].energyAvailable + ' energy');
}

//OBSTACLE_OBJECT_TYPES: ["spawn", "creep", "powerCreep", "source", "mineral", "deposit", "controller", "constructedWall", "extension", "link", "storage", "tower", "observer", "powerSpawn", "powerBank", "lab", "terminal", "nuker", "factory", "invaderCore"]

if (ss1.signController(creep.room.controller, "I'm going to claim this room in a few days. I warned ya!") === ERR_NOT_IN_RANGE) {
    ss1.moveTo(creep.room.controller);
}
