Game.spawns['Spawn1'].spawnCreep([WORK, CARRY, MOVE], 'Builder1', { memory: { role: 'builder' } });
Game.spawns['Spawn1'].room.createConstructionSite(23, 22, STRUCTURE_TOWER);
Game.spawns['Spawn1'].room.controller.activateSafeMode();

for (const name in Game.rooms) {
    console.log('Room "' + name + '" has ' + Game.rooms[name].energyAvailable + ' energy');
}

//OBSTACLE_OBJECT_TYPES: ["spawn", "creep", "powerCreep", "source", "mineral", "deposit", "controller", "constructedWall", "extension", "link", "storage", "tower", "observer", "powerSpawn", "powerBank", "lab", "terminal", "nuker", "factory", "invaderCore"]
