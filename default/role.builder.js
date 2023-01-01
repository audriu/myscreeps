const tasks = require('tasks')

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            tasks.harvest(creep, 1)
        } else {
            tasks.build(creep)
        }
    }
}
