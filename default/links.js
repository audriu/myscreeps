module.exports = function () {
    const link0 = Game.getObjectById('6159d9c9047f4407ad073350');
    const link1 = Game.getObjectById('6159cdb6fac8206e34d44f4e');
    const link2 = Game.getObjectById('6159c5531306ec299858b96e');

    link1.transferEnergy(link0);
    link2.transferEnergy(link0);
}
