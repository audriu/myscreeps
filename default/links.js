module.exports = function () {
    const link0 = Game.getObjectById('6252a81257a3be2c2cb4e65b');
    const link1 = Game.getObjectById('62529f7ba8265e7dbcf55a13');
    const link2 = Game.getObjectById('6252b52bb5872f357e731d29');

    if (link1) {
        link1.transferEnergy(link0);
    }
    if (link2) {
        link2.transferEnergy(link0);
    }
}
