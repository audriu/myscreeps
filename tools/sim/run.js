/* Runner: node run.js <scriptDir> <rooms,comma> <ticks> [--quiet] [--map] [--trace=N] [--invade=ROOM:TICK[:big]] [--unowned=ROOM] [--spawndiag]
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
const invadeArg = args.find(a => a.startsWith('--invade='));   // --invade=ROOM:TICK[:big]
const unownedArg = args.find(a => a.startsWith('--unowned=')); // --unowned=ROOM
const spawnDiag = args.includes('--spawndiag');
const meta = fs.existsSync(path.join(path.resolve(__dirname, 'data'), 'time.json')) ? JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, 'data'), 'time.json'))) : { time: 78296030 };
const startTime = meta.time;
const dataDir = path.resolve(__dirname, 'data');

E.installGlobals();
W.time = startTime;
for (const r of rooms) E.loadRoom(r, dataDir);
if (unownedArg) E.makeUnowned(unownedArg.split('=')[1]);

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

function snapshot(tag) {
    for (const rn of rooms) {
        const room = W.rooms[rn];
        const ctrl = room.controller;
        const byRole = {};
        for (const c of room.creeps) { if (c.spawning) continue; const r = ((Memory.creeps || {})[c.name] || {}).role || '?'; byRole[r] = (byRole[r] || 0) + 1; }
        const all = Object.values(W.creeps).filter(c => ((Memory.creeps || {})[c.name] || {}).home === rn);
        const spawns = room.structures.filter(s => s.structureType === 'spawn');
        const stor = room.storage;
        console.log(`[${tag}] ${rn} RCL${ctrl.level} prog=${ctrl.progress}/${ctrl.progressTotal || '-'} down=${ctrl.ticksToDowngrade} energy=${room.energyAvailable}/${room.energyCapacityAvailable} store=${stor ? stor.store.energy || 0 : '-'} creeps(home)=${all.length} inRoom=${JSON.stringify(byRole)} sites=${room.sites.length} spawning=[${spawns.map(s => s.name + ':' + (s.spawning ? s.spawning.name + '/' + s.spawning.remainingTime : '-')).join(' ')}] containers=${room.structures.filter(s => s.structureType === 'container').map(c => c.store.energy || 0).join(',')} dropped=${room.resources.reduce((a, r) => a + r.amount, 0)}`);
    }
}

snapshot('start');
for (let i = 0; i < ticks; i++) {
    W.time++;
    global.Game = E.makeGame();
    global.Memory = JSON.parse(memoryJson);
    W.tickStart = process.hrtime.bigint();
    if (invadeArg) { const [, spec] = invadeArg.split('='); const [room, tick, big] = spec.split(':'); if (i + 1 === +tick) { E.spawnInvader(room, big ? ['tough','tough','tough','tough','attack','attack','attack','attack','attack','attack','heal','heal','move','move','move','move','move','move','move','move'] : null); if (big) E.spawnInvader(room, null); } }
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
            console.log(`   T${W.time} ${n.padEnd(30)} ${m.role || '?'} @${c.pos.x},${c.pos.y} e=${c.store.energy || 0}/${c.store.getCapacity()} fat=${c.fatigue} ttl=${c.ticksToLive} work=${m.working} task=${m.task || ''} tk=${m.tk || ''} t=${m.t ? (W.objects[m.t] ? (W.objects[m.t].structureType || W.objects[m.t].constructor.name) + '@' + W.objects[m.t].pos.x + ',' + W.objects[m.t].pos.y : 'gone') : ''} spawning=${c.spawning} mv=${c._moveIntent ? c._moveIntent.x + ',' + c._moveIntent.y : '-'}`);
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
        const sym = { spawn: 'S', extension: 'e', tower: 'T', storage: 'K', terminal: 'M', container: 'c', road: '-', link: 'L', rampart: 'r', constructedWall: 'W', lab: 'b', extractor: 'x' };
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
