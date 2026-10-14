/**
 * Colony AI entry point.
 *
 * Per tick: migrate/normalise memory -> per-room (defense, links, spawning,
 * planning) -> creeps -> empire decisions -> bookkeeping.
 * Every stage is isolated so one room's exception never stalls the others.
 */
const config = require('config');
const util = require('util');
const adopt = require('adopt');
const roomState = require('roomState');
const defense = require('defense');
const logistics = require('logistics');
const spawner = require('spawner');
const planner = require('planner');
const roles = require('roles');
const empire = require('empire');

function guard(label, fn) {
    try {
        fn();
    } catch (e) {
        util.error(label + ': ' + (e && e.stack ? e.stack : e));
    }
}

function cleanup() {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
            util.forgetCreep(name);
        }
    }
    if (Game.time % 1000 === 0) {
        for (const name in Memory.rooms) {
            if (!util.isOwned(name)) delete Memory.rooms[name];
        }
    }
}

function runRoom(room) {
    const st = roomState.get(room);
    guard(room.name + ' defense', () => defense.run(room, st));
    guard(room.name + ' links', () => logistics.runLinks(st));
    guard(room.name + ' spawner', () => spawner.run(room, st));
    guard(room.name + ' planner', () => planner.run(room, st));
    if (config.visuals) {
        const creeps = roomState.creepIndex().byHome[room.name] || {};
        let n = 0;
        for (const role in creeps) n += creeps[role].length;
        const ctrl = room.controller;
        const pct = ctrl.progressTotal ? Math.floor(100 * ctrl.progress / ctrl.progressTotal) : 100;
        room.visual.text(
            'RCL' + ctrl.level + ' ' + pct + '% | ' + (st.bootstrap ? 'bootstrap' : 'economy') +
            ' | creeps ' + n + ' | energy ' + st.energy + '/' + st.cap +
            (st.storage ? ' | store ' + Math.floor((st.storage.store[RESOURCE_ENERGY] || 0) / 1000) + 'k' : '') +
            (st.downgrade ? ' | DOWNGRADE ' + ctrl.ticksToDowngrade : ''),
            1, 1.5, { align: 'left', font: 0.7, opacity: 0.7 });
    }
}

function summary(owned) {
    const index = roomState.creepIndex();
    const h = util.heap;
    const avg = h.cpuAvg != null ? h.cpuAvg.toFixed(1) : '?';
    util.log('rooms=' + owned.length + '/' + Game.gcl.level + ' creeps=' + index.total +
        ' cpu~' + avg + '/' + Game.cpu.limit + ' bucket=' + Game.cpu.bucket +
        (Memory.empire && Memory.empire.claim ? ' claim=' + Memory.empire.claim.target : '') +
        (Memory.empire && Memory.empire.wants ? ' empireWants=' + Memory.empire.wants.length : ''));
    if (Game.time % (config.logEvery * 5) === 0) {
        for (let i = 0; i < owned.length; i++) {
            const st = roomState.get(owned[i]);
            const roles = [];
            for (const role in st.creeps) roles.push(role + ':' + st.creeps[role].length);
            util.log('  ' + st.name + ' RCL' + st.rcl + ' ' + st.energy + '/' + st.cap +
                (st.storage ? ' store=' + (st.storage.store[RESOURCE_ENERGY] || 0) : '') +
                ' sites=' + st.sites.length + ' downgrade=' + st.ctrl.ticksToDowngrade +
                ' [' + roles.join(' ') + ']' + (st.hostiles.length ? ' HOSTILES=' + st.hostiles.length : ''));
        }
    }
}

module.exports.loop = function () {
    guard('adopt', () => adopt.run());
    guard('cleanup', cleanup);
    roles.prepare();

    const owned = util.ownedRooms();
    for (let i = 0; i < owned.length; i++) {
        const room = owned[i];
        guard(room.name, () => runRoom(room));
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        try {
            roles.run(creep);
        } catch (e) {
            util.error(creep.name + ' (' + creep.memory.role + '): ' + (e && e.stack ? e.stack : e));
        }
    }

    guard('empire', () => empire.run());
    if (Game.time % 5 === 0) guard('observe', () => empire.observe());

    const used = Game.cpu.getUsed();
    const h = util.heap;
    h.cpuAvg = h.cpuAvg == null ? used : h.cpuAvg * 0.98 + used * 0.02;
    h.uptime = (h.uptime || 0) + 1;
    if (config.pixels && Game.cpu.generatePixel && Game.cpu.bucket >= 10000 &&
        h.uptime > 2000 && h.cpuAvg < Game.cpu.limit * 0.6) {
        if (Game.cpu.generatePixel() === OK) util.log('Generated a pixel');
    }
    if (Game.time % config.logEvery === 0) guard('summary', () => summary(owned));
};
