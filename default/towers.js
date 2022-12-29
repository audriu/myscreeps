const functions = require('functions');
const spawnPos = Game.getObjectById('624341d6991a82c879180daf').pos

function attack(tower) {
    const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (closestHostile)
        tower.attack(closestHostile);
}

function heal(tower) {
    const wounded = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => {
            return (creep.hits < creep.hitsMax);
        }
    });
    if (wounded)
        tower.heal(wounded);
}

function repair(tower) {
    const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax && structure.structureType != STRUCTURE_WALL
    });
    if (closestDamagedStructure)
        tower.repair(closestDamagedStructure);
}

module.exports = function () {

    var towers1 = Game.rooms.W34S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers2 = Game.rooms.W33S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers3 = Game.rooms.W33S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    let towers = towers1.concat(towers2).concat(towers3)
    towers = functions.shuffleArray(towers);
    towerRoom2 = Game.getObjectById('63303657398899502617d12f');;
    towerRoom3 = Game.getObjectById('63715447fb9c9692480c69d4');;
    towerRoom4 = Game.getObjectById('63a6d41e5026fc2a4163ba4d')
    const attackers = towers;
    const healers = [towers[0]];
    const repairers = [towers[1], towerRoom2, towerRoom3, towerRoom4];

    healers.forEach(heal);
    repairers.forEach(repair);
    attackers.forEach(attack);
}
