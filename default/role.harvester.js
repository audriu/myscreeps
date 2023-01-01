const tasks = require('tasks')

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            tasks.harvest(creep, 0)
        } else {
            tasks.unload(creep)
        }
    }
}
