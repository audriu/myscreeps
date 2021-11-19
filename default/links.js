module.exports = function () {
    const link0 = Game.getObjectById('6159d9c9047f4407ad073350');
    const link1 = Game.getObjectById('6159cdb6fac8206e34d44f4e');
    const link2 = Game.getObjectById('6184f8898e77702d9ef72dc2');

    if (link1) {
        link1.transferEnergy(link0);
    }
    if (link2) {
        link2.transferEnergy(link0);
    }
}
