const tasks = require('tasks')

module.exports = {
    run: function (creep) {
        if (creep.memory.harvesting) {
            tasks.harvest(creep, 0)
        } else {
            if (!tasks.unload(creep)){
                tasks.build(creep)
            }
        }
    }
}
