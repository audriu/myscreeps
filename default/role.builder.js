const tasks = require('tasks')

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            tasks.harvest(creep, 1)
        } else {
            if (!tasks.build(creep)) {
                tasks.unload(creep)
            }
        }
    }
}
