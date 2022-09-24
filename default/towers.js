const spawnPos = Game.getObjectById('624341d6991a82c879180daf').pos

function isThereEnemies() {
    return spawnPos.findClosestByRange(FIND_HOSTILE_CREEPS);
}

function isThereWounded() {
    return spawnPos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => {
            return (creep.hits < creep.hitsMax);
        }
    });
}

function isThereDamages() {
    return spawnPos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax
    });
}

function attack(tower) {
    const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    tower.attack(closestHostile);

}

function heal(tower) {
    const wounded = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => {
            return (creep.hits < creep.hitsMax);
        }
    });
    tower.heal(wounded);
}

function repair(tower) {
    const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax && structure.structureType != STRUCTURE_WALL
    });
    tower.repair(closestDamagedStructure);
}

module.exports = function () {

    var towers = Game.rooms.W34S42.find(FIND_STRUCTURES, { filter: (str) => str.structureType == STRUCTURE_TOWER });
    const attackers = towers;
    const healers = [towers[0]];
    const repairers = [towers[1]];

    if (isThereEnemies()) {
        attackers.forEach(attack);
    } else if (isThereWounded()) {
        healers.forEach(heal);
    } else if (isThereDamages()) {
        repairers.forEach(repair);
    }
}
