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
    ['W34S42', 'W33S42', 'W32S42', 'W32S41', 'W33S41', 'W32S43', 'W33S43'];

    var towers1 = Game.rooms.W34S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers2 = Game.rooms.W33S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers3 = Game.rooms.W33S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers4 = Game.rooms.W32S41.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers5 = Game.rooms.W33S41.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers6 = Game.rooms.W32S43.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    var towers7 = Game.rooms.W33S43.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    let towers = towers1.concat(towers2).concat(towers3).concat(towers4).concat(towers5).concat(towers6).concat(towers7)
    towers = _.shuffle(towers);
    const attackers = towers;
    const healers = [towers[0]];
    const repairers = [towers[1], towers2[0], towers3[0], towers4[0], towers5[0], towers6[0], towers7[0]];

    healers.forEach(heal);
    repairers.forEach(repair);
    attackers.forEach(attack);
}
