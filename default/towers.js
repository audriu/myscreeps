const spawnPos = Game.spawns['Spawn1'].pos;

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
        filter: (structure) => structure.hits < structure.hitsMax
    });
    tower.repair(closestDamagedStructure);
}

module.exports = function () {
    const tower0 = Game.getObjectById('614d7768103ba61e1f7610e1');
    const tower1 = Game.getObjectById('6150a477e59fcfe262ea2247');
    const tower2 = Game.getObjectById('616895f8d1a7a33723d8603c');
    const attackers = [tower0, tower1, tower2];
    const healers = [tower0];
    const repairers = [tower0];

    if (isThereEnemies(tower1)) {
        attackers.forEach(attack);
    } else if (isThereWounded(tower1)) {
        healers.forEach(heal);
    } else if (isThereDamages(tower1)) {
        repairers.forEach(repair);
    }
}
