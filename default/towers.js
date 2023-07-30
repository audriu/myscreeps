module.exports = function () {
    Memory.rooms.forEach(room => {
        const towers = Game.rooms[room].find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
        towers.forEach(tower => {
            const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, { filter: (structure) => structure.hits < structure.hitsMax && structure.structureType != STRUCTURE_WALL });
            const wounded = tower.pos.findClosestByRange(FIND_MY_CREEPS, { filter: (creep) => { return (creep.hits < creep.hitsMax); } });
            if (closestHostile) {
                tower.attack(closestHostile);
            } else if (wounded) {
                tower.heal(wounded);
            } else if (closestDamagedStructure) {
                tower.repair(closestDamagedStructure);
            }
        });
    });
}
