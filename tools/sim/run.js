/* Runner: node run.js <scriptDir> <rooms,comma> <ticks> [--core=ROOM] [--give=ROOM:res=N,...] [--rcl=ROOM:N] [--hub=ROOM] [--boost] [--quiet] [--map] [--trace=N] [--invade=ROOM:TICK[:big|:dis]] [--unowned=ROOM] [--lost=ROOM] [--gcl=N] [--gclraise=TICK] [--release=ROOM:TICK] [--hostile=ROOM] [--war=TARGET:TICK] [--nomuster] [--go] [--cheap[=FLOOR]] [--unclaim[=N]] [--spawndiag] [--data=DIR]
 * Room data comes from tools/sim/data (see fetch.js). */
const fs = require('fs');
const path = require('path');
const E = require('./engine');
const { W } = E;

const args = process.argv.slice(2);
const scriptDir = path.resolve(args[0]);
const rooms = args[1].split(',');
const ticks = +args[2] || 500;
const quiet = args.includes('--quiet');
const showMap = args.includes('--map');
const traceArg = args.find(a => a.startsWith('--trace='));
const traceEvery = traceArg ? +traceArg.split('=')[1] : 0;
const invadeArg = args.find(a => a.startsWith('--invade='));   // --invade=ROOM:TICK[:big|:dis]
const unownedArg = args.find(a => a.startsWith('--unowned=')); // --unowned=ROOM
const lostArg = args.find(a => a.startsWith('--lost='));       // --lost=ROOM (controller lost, buildings remain)
const spawnDiag = args.includes('--spawndiag');
const hostileArg = args.find(a => a.startsWith('--hostile=')); // --hostile=ROOM (another player's room with a guard)
const warArg = args.find(a => a.startsWith('--war='));         // --war=TARGET:TICK (muster from tick 1, target set at TICK)
const cheapArg = args.find(a => a === '--cheap' || a.startsWith('--cheap=')); // --cheap[=FLOOR] (low-energy muster from tick 1)
const gclArg = args.find(a => a.startsWith('--gcl='));         // --gcl=N (Game.gcl.level)
const gclRaiseArg = args.find(a => a.startsWith('--gclraise=')); // --gclraise=TICK (GCL level +1 at that tick)
const releaseArg = args.find(a => a.startsWith('--release=')); // --release=ROOM:TICK (sets Memory.empire.release at that tick)
const dataArg = args.find(a => a.startsWith('--data='));       // --data=DIR (another snapshot set: rooms/, terrain/, time.json)
const dataDir = dataArg ? path.resolve(dataArg.split('=')[1]) : path.resolve(__dirname, 'data');
const meta = fs.existsSync(path.join(dataDir, 'time.json')) ? JSON.parse(fs.readFileSync(path.join(dataDir, 'time.json'))) : { time: 78296030 };
const startTime = meta.time;

E.installGlobals();
W.time = startTime;
for (const r of rooms) E.loadRoom(r, dataDir);
if (unownedArg) E.makeUnowned(unownedArg.split('=')[1]);
if (lostArg) E.makeLost(lostArg.split('=')[1]);
if (hostileArg) E.makeHostile(hostileArg.split('=')[1]);
if (gclArg) W.gcl = +gclArg.split('=')[1];
// --core=ROOM: a lesser invader core that keeps the controller reserved.
for (const a of args.filter(a => a.startsWith('--core='))) E.addCore(a.split('=')[1]);
// --rcl=ROOM:N: set the controller level (to try what the planner does at RCL7/8).
for (const a of args.filter(a => a.startsWith('--rcl='))) { const [room, n] = a.split('=')[1].split(':'); const c = W.rooms[room].controller; c.level = +n; c.progress = 0; c.ticksToDowngrade = E.C.CONTROLLER_DOWNGRADE[+n]; }
// --give=ROOM:energy=300000,G=5000: put resources into our storage there (the terminal when there is no storage).
for (const a of args.filter(a => a.startsWith('--give='))) {
    const spec = a.slice(7); const room = W.rooms[spec.slice(0, spec.indexOf(':'))];
    const dest = room.structures.find(s => s.structureType === 'storage' && s.my) || room.structures.find(s => s.structureType === 'terminal' && s.my);
    if (!dest) throw new Error('--give: no storage or terminal of ours in ' + room.name);
    for (const kv of spec.slice(spec.indexOf(':') + 1).split(',')) { const [k, v] = kv.split('='); dest.store[k] = (dest.store[k] || 0) + +v; }
}
const hubArg = args.find(a => a.startsWith('--hub='));         // --hub=ROOM (Memory.empire.hub from tick 1)

// module loader mimicking Screeps' flat require()
const cache = {};
function req(name) {
    name = name.replace(/^\.\//, '');
    if (cache[name]) return cache[name].exports;
    const file = path.join(scriptDir, name + '.js');
    const src = fs.readFileSync(file, 'utf8');
    const mod = { exports: {} };
    cache[name] = mod;
    const fn = new Function('module', 'exports', 'require', 'console', src + '\n//# sourceURL=' + name + '.js');
    fn(mod, mod.exports, req, consoleProxy);
    return mod.exports;
}
const consoleLines = [];
const consoleProxy = { log: (...a) => { const s = a.join(' ').replace(/<[^>]+>/g, ''); consoleLines.push(s); if (!quiet) console.log('   ' + s); } };

global.Memory = {};
let memoryJson = '{}';
const main = req('main');
const cpuSamples = [];
let errors = 0;

function rampartSummary(room) {
    const h = room.structures.filter(s => s.structureType === 'rampart').map(s => s.hits).sort((a, b) => a - b);
    if (!h.length) return 0;
    return `${h.length}(min=${h[0]} mid=${h[h.length >> 1]} max=${h[h.length - 1]})`;
}

function other(store) { const out = {}; if (store) for (const k in store) if (k !== 'energy' && store[k] > 0) out[k] = store[k]; return out; }
function industry(room) {
    const parts = [];
    const stor = room.structures.find(s => s.structureType === 'storage' && s.my);
    const term = room.structures.find(s => s.structureType === 'terminal' && s.my);
    if (stor && Object.keys(other(stor.store)).length) parts.push('stock=' + JSON.stringify(other(stor.store)));
    if (term) parts.push('terminal=' + JSON.stringify(Object.assign({ energy: term.store.energy || 0 }, other(term.store))));
    const labs = room.structures.filter(s => s.structureType === 'lab' && s.my);
    if (labs.length) parts.push('labs=[' + labs.map(l => (l.mineralType ? l.mineralType + ':' + l.store[l.mineralType] : '-') + '/' + (l.store.energy || 0)).join(' ') + ']');
    const fac = room.structures.find(s => s.structureType === 'factory' && s.my);
    if (fac) parts.push('factory=' + JSON.stringify(Object.assign({}, fac.store)));
    const left = room.structures.filter(s => s.owner && !s.my && s.store && Object.keys(other(s.store)).length + (s.store.energy > 0 ? 1 : 0) > 0);
    if (left.length) parts.push('leftovers=[' + left.map(s => s.structureType + ':' + Object.values(Object.assign({}, s.store)).reduce((a, b) => a + b, 0)).join(' ') + ']');
    const mc = room.minerals[0]; const ex = room.structures.find(s => s.structureType === 'extractor');
    if (mc && ex) parts.push('mineral=' + mc.mineralType + ':' + mc.mineralAmount);
    return parts.length ? ' ' + parts.join(' ') : '';
}

function snapshot(tag) {
    for (const rn of rooms) {
        const room = W.rooms[rn];
        const ctrl = room.controller;
        const byRole = {};
        for (const c of room.creeps) { if (c.spawning) continue; const r = ((Memory.creeps || {})[c.name] || {}).role || '?'; byRole[r] = (byRole[r] || 0) + 1; }
        // Transit rooms (highways, unclaimed rooms): who is standing in them, and what a remote mine looks like.
        if (!ctrl || (!ctrl.my && !ctrl.owner)) {
            const core = room.structures.some(s => s.structureType === 'invaderCore');
            if (Object.keys(byRole).length || (ctrl && ctrl.reservation) || core) console.log(`[${tag}] ${rn} transit inRoom=${JSON.stringify(byRole)}` + (ctrl ? ` reserved=${ctrl.reservation ? ctrl.reservation.username + ':' + ctrl.reservation.ticksToEnd : '-'}` : '') + (core ? ' CORE' : '') + ` sources=${room.sources.map(s => s.energy + '/' + s.energyCapacity).join(',')} containers=${room.structures.filter(s => s.structureType === 'container').map(c => c.store.energy || 0).join(',')} sites=${room.sites.length} dropped=${room.resources.reduce((a, r) => a + r.amount, 0)} mined=${(W.stats.remote || {})[rn] || 0}`);
            continue;
        }
        const all = Object.values(W.creeps).filter(c => ((Memory.creeps || {})[c.name] || {}).home === rn);
        const spawns = room.structures.filter(s => s.structureType === 'spawn');
        const stor = room.storage;
        if (!ctrl.my) {
            const towers = room.structures.filter(s => s.structureType === 'tower' && !s.my);
            console.log(`[${tag}] ${rn} HOSTILE structures=${room.structures.filter(s => s.owner && !s.my).length} leftovers=${JSON.stringify(room.structures.filter(s => !s.my && !s.owner && s.hits != null).reduce((a, s) => (a[s.structureType] = (a[s.structureType] || 0) + 1, a), {}))} creeps=${room.creeps.filter(c => !c.my).length} ours=${room.creeps.filter(c => c.my).length} inRoom=${JSON.stringify(byRole)} ramparts=${rampartSummary(room)} towers=[${towers.map(t => t.store.energy || 0).join(',')}]`);
            continue;
        }
        console.log(`[${tag}] ${rn} RCL${ctrl.level} prog=${ctrl.progress}/${ctrl.progressTotal || '-'} down=${ctrl.ticksToDowngrade} energy=${room.energyAvailable}/${room.energyCapacityAvailable} store=${stor ? stor.store.energy || 0 : '-'} creeps(home)=${all.length} inRoom=${JSON.stringify(byRole)} sites=${room.sites.length} spawning=[${spawns.map(s => s.name + ':' + (s.spawning ? s.spawning.name + '/' + s.spawning.remainingTime : '-')).join(' ')}] containers=${room.structures.filter(s => s.structureType === 'container').map(c => c.store.energy || 0).join(',')} dropped=${room.resources.reduce((a, r) => a + r.amount, 0)} ramparts=${rampartSummary(room)} sign=${ctrl.sign ? ctrl.sign.text : '-'}${industry(room)}`);
    }
}

snapshot('start');
for (let i = 0; i < ticks; i++) {
    W.time++;
    global.Game = E.makeGame();
    global.Memory = JSON.parse(memoryJson);
    W.tickStart = process.hrtime.bigint();
    if (invadeArg) { const [, spec] = invadeArg.split('='); const [room, tick, big] = spec.split(':'); if (i + 1 === +tick) { const dis = big === 'dis'; E.spawnInvader(room, dis ? Array(25).fill('work').concat(Array(25).fill('move')) : big ? ['tough','tough','tough','tough','attack','attack','attack','attack','attack','attack','heal','heal','move','move','move','move','move','move','move','move'] : null); if (big && !dis) E.spawnInvader(room, null); if (dis) for (let n = 0; n < 2; n++) E.spawnInvader(room, Array(25).fill('work').concat(Array(25).fill('move'))); } }
    if (gclRaiseArg && i + 1 === +gclRaiseArg.split('=')[1]) W.gcl++;
    if (warArg) { const [room, tick] = warArg.split('=')[1].split(':'); if (i === 0) Memory.war = { muster: !args.includes('--nomuster') }; if (i + 1 === +tick) { Memory.war = Memory.war || {}; Memory.war.target = room; if (args.includes('--go')) Memory.war.go = W.time; } }
    if (hubArg && i === 0) { Memory.empire = Memory.empire || {}; Memory.empire.hub = hubArg.split('=')[1]; }
    if (args.includes('--boost') && i === 0) { Memory.war = Memory.war || {}; Memory.war.boost = true; }
    if (cheapArg && i === 0) { Memory.war = Memory.war || {}; if (!args.includes('--nomuster')) Memory.war.muster = true; Memory.war.cheap = cheapArg.includes('=') ? +cheapArg.split('=')[1] : true; }
    const unclaimArg = args.find(a => a === '--unclaim' || a.startsWith('--unclaim='));
    if (unclaimArg && i === 0) { Memory.war = Memory.war || {}; Memory.war.unclaim = unclaimArg.includes('=') ? +unclaimArg.split('=')[1] : true; }
    if (releaseArg) { const [room, tick] = releaseArg.split('=')[1].split(':'); if (i + 1 === +tick) { Memory.empire = Memory.empire || {}; Memory.empire.release = room; } }
    if (spawnDiag && (i + 1) % 25 === 0) {
        for (const sn in W.spawns) { const sp = W.spawns[sn]; if (sp.spawning && sp.spawning.remainingTime === 0) {
            const room = sp.room; const near = room.creeps.filter(c => !c.spawning && sp.pos.isNearTo(c)).map(c => { const m = (Memory.creeps || {})[c.name] || {}; return `${c.name}@${c.pos.x},${c.pos.y}[${m.role}/${m.task || ''}/${m.tk || ''}/fat${c.fatigue}]`; });
            const exits = (Memory.rooms[room.name] && Memory.rooms[room.name].plan && Memory.rooms[room.name].plan.exits || {})[sp.id];
            console.log(`   DIAG ${W.time} ${sn} blocked; exits=${JSON.stringify(exits)} near=${near.join(' ')}`); } }
    }
    try { main.loop(); } catch (e) { errors++; console.log('!! loop exception at ' + W.time + ': ' + (e.stack || e)); if (errors > 20) break; }
    const used = Number(process.hrtime.bigint() - W.tickStart) / 1e6;
    cpuSamples.push(used);
    W.bucket = Math.min(10000, W.bucket + Math.max(-W.bucket, W.cpuLimit - used));
    try { memoryJson = JSON.stringify(Memory); } catch (e) { console.log('!! Memory not serialisable: ' + e); break; }
    if (traceEvery && (i + 1) % traceEvery === 0) {
        for (const n in W.creeps) {
            const c = W.creeps[n]; const m = (Memory.creeps || {})[n] || {};
            console.log(`   T${W.time} ${n.padEnd(30)} ${m.role || '?'} @${c.pos.roomName}:${c.pos.x},${c.pos.y} e=${c.store.energy || 0}/${c.store.getCapacity()} fat=${c.fatigue} ttl=${c.ticksToLive} work=${m.working} task=${m.task || ''} tk=${m.tk || ''} t=${m.t ? (W.objects[m.t] ? (W.objects[m.t].structureType || W.objects[m.t].constructor.name) + '@' + W.objects[m.t].pos.x + ',' + W.objects[m.t].pos.y : 'gone') : ''} spawning=${c.spawning} mv=${c._moveIntent ? c._moveIntent.x + ',' + c._moveIntent.y : '-'}`);
        }
    }
    E.endTick();
    if (!quiet && (i + 1) % Math.max(100, Math.floor(ticks / 10)) === 0) snapshot('t+' + (i + 1));
}
snapshot('end');
const avg = cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length;
const max = Math.max(...cpuSamples);
console.log(`\nsim: ticks=${ticks} errors=${errors} avgMs=${avg.toFixed(2)} maxMs=${max.toFixed(1)} memoryBytes=${memoryJson.length} stats=${JSON.stringify(W.stats)}`);
console.log('events: ' + W.logs.join(' | '));
if (W.notifications.length) console.log('notifications: ' + W.notifications.join(' | '));
const errLines = consoleLines.filter(l => /error|exception|failed|TypeError|ReferenceError/i.test(l));
if (errLines.length) { console.log('\nconsole errors (' + errLines.length + '):'); const seen = {}; for (const l of errLines) { const k = l.replace(/^\[\d+\] /, '').slice(0, 160); if (seen[k]) continue; seen[k] = 1; console.log('  ' + l.slice(0, 400)); } }
if (showMap) {
    for (const rn of rooms) {
        const room = W.rooms[rn];
        const grid = [];
        for (let y = 0; y < 50; y++) { grid.push([]); for (let x = 0; x < 50; x++) grid[y].push(room.terrain.get(x, y) === 1 ? '#' : room.terrain.get(x, y) === 2 ? '~' : '.'); }
        const sym = { spawn: 'S', extension: 'e', tower: 'T', storage: 'K', terminal: 'M', container: 'c', road: '-', link: 'L', rampart: 'r', constructedWall: 'W', lab: 'b', extractor: 'x', factory: 'F', invaderCore: 'I' };
        for (const s of room.structures) if (s.structureType !== 'rampart') grid[s.pos.y][s.pos.x] = sym[s.structureType] || '?';
        for (const s of room.sites) grid[s.pos.y][s.pos.x] = (sym[s.structureType] || '?').toLowerCase() === (sym[s.structureType] || '?') ? '+' : '*';
        for (const s of room.sources) grid[s.pos.y][s.pos.x] = '$';
        for (const m of room.minerals) grid[m.pos.y][m.pos.x] = 'm';
        if (room.controller) grid[room.controller.pos.y][room.controller.pos.x] = 'C';
        for (const c of room.creeps) if (!c.spawning) grid[c.pos.y][c.pos.x] = 'o';
        console.log('\n' + rn + ' map (S spawn, e ext, T tower, K storage, M terminal, c container, L link, - road, + site, * site(big), $ source, C controller, o creep):');
        console.log(grid.map((row, y) => String(y).padStart(2) + ' ' + row.join('')).join('\n'));
    }
}
