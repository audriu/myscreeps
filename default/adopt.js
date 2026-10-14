/**
 * One-time migration from older branches plus per-creep memory normalisation.
 */
const config = require('config');
const util = require('util');

const ROLE_MAP = {
    ant: 'worker',
    builder: 'worker',
    pioneer: 'worker',
    harvester: 'worker',
    repairer: 'worker',
    remoteMiner: 'miner',
    remoteHauler: 'hauler',
    fighter: 'defender',
    colonist: 'claimer',
    reserver: 'scout',
};

function migrateMemory() {
    if (Memory.version === config.version) return;
    util.warn('Migrating memory to script version ' + config.version);
    delete Memory.empire;
    delete Memory.flags;
    delete Memory.diena;
    Memory.rooms = {};
    Memory.creeps = Memory.creeps || {};
    for (const name in Memory.creeps) {
        const m = Memory.creeps[name];
        delete m._move;
        delete m.working;
        delete m.t;
        delete m.tk;
        delete m.task;
        delete m.v;
    }
    Memory.version = config.version;
}

function roleFromName(name) {
    const m = /^([a-zA-Z]+)[-_]/.exec(name);
    return m ? m[1] : null;
}

function normalizeCreep(creep) {
    const m = creep.memory;
    if (m.v === config.version && m.role && m.home) return;
    let role = m.role || roleFromName(creep.name) || 'worker';
    if (ROLE_MAP[role]) role = ROLE_MAP[role];
    const known = ['miner', 'hauler', 'upgrader', 'worker', 'courier', 'defender', 'claimer', 'scout'];
    if (known.indexOf(role) === -1) role = 'worker';

    let home = null;
    if (m.home && util.isOwned(m.home)) home = m.home;
    else if (m.targetRoom && util.isOwned(m.targetRoom)) home = m.targetRoom;
    else if (creep.room.controller && creep.room.controller.my) home = creep.room.name;
    else {
        const near = util.nearestOwnedRoom(creep.room.name);
        home = near ? near.name : creep.room.name;
    }

    if (role === 'claimer' && !m.targetRoom) role = 'scout';
    if (role === 'miner' && m.sourceId) {
        const src = Game.getObjectById(m.sourceId);
        if (!src || src.pos.roomName !== home) delete m.sourceId;
    }
    if (role === 'worker' || role === 'hauler') {
        if (!util.countParts(creep, CARRY)) role = 'scout';
    }
    m.role = role;
    m.home = home;
    m.v = config.version;
    delete m.working;
    delete m.t;
    delete m.tk;
    delete m.task;
}

function run() {
    migrateMemory();
    for (const name in Game.creeps) normalizeCreep(Game.creeps[name]);
}

module.exports = { run };
