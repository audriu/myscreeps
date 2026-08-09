/**
 * Expansion brain: scout intel → score rooms → claim → remotes.
 * Aggressive outward push from every owned border room.
 */

const config = require('config');
const lib = require('lib');

function ensureEmpire() {
    if (!Memory.empire) {
        Memory.empire = {
            expansionTarget: null,
            expansionTargets: [],
            remotes: {},
            lastExpansionPlan: 0,
            scoutQueue: [],
        };
    }
    if (!Memory.empire.remotes) Memory.empire.remotes = {};
    if (!Memory.empire.scoutQueue) Memory.empire.scoutQueue = [];
    if (!Memory.empire.expansionTargets) Memory.empire.expansionTargets = [];
}

/**
 * Score a room for claiming. Higher = better.
 * Adjacent (range 1) neighbors dominate — expand outwards from current holds.
 */
function scoreClaimCandidate(roomName, fromRooms) {
    const mem = Memory.rooms[roomName];
    if (mem && mem.my) return -Infinity;
    if (mem && mem.keeper) return -Infinity;
    if (mem && mem.owner) return -Infinity;
    if (mem && mem.claimable === false) return -Infinity;

    let minDist = Infinity;
    for (const r of fromRooms) {
        const d = lib.roomDistance(r.name, roomName);
        if (d < minDist) minDist = d;
    }
    if (minDist > config.expansion.maxRange) return -Infinity;

    // Unscouted adjacent rooms: still chase them (send scouts + claimers)
    const scouted = mem && mem.scouted != null;
    if (!scouted) {
        if (minDist === 1) return 180; // claim/scout immediately
        if (minDist === 2) return 40;
        return -Infinity;
    }

    const sources = mem.sourceCount != null ? mem.sourceCount :
        (mem.sources ? mem.sources.length : 0);

    // Adjacent rooms with a controller and no sources still get a weak score
    // (rare); prefer anything with energy
    if (sources < 1 && minDist > 1) return -Infinity;

    let score = 0;
    score += sources * 80;
    if (sources >= (config.expansion.preferSources || 2)) score += 40;
    if (sources === 1 && minDist === 1) score += 60; // take 1-source borders too

    // Outward bias: adjacent >>> everything else
    if (minDist === 1) score += 220;
    else if (minDist === 2) score += 40;
    else score -= minDist * 40;

    const age = Game.time - (mem.scouted || 0);
    if (age < 3000) score += 15;
    if (age > 15000) score -= 20;

    // Contested reservation — still take it
    if (mem.reserved) score -= 10;

    if (mem.hostiles) score -= mem.hostiles * 10;

    // Fill gaps between owned rooms
    let adjOwned = 0;
    for (const n of lib.adjacentRooms(roomName)) {
        if (Memory.rooms[n] && Memory.rooms[n].my) adjOwned++;
    }
    score += adjOwned * 25;

    return score;
}

/**
 * Score remote mining candidate attached to a home room.
 */
function scoreRemote(roomName, homeName) {
    const mem = Memory.rooms[roomName];
    if (!mem || mem.my) return -Infinity;
    if (mem.keeper) return -Infinity;
    if (mem.owner) return -Infinity;

    const dist = lib.roomDistance(homeName, roomName);
    if (dist !== 1) return -Infinity;

    const sources = mem.sourceCount != null ? mem.sourceCount :
        (mem.sources ? mem.sources.length : 0);
    if (sources < 1) return -Infinity;

    let score = sources * 50 + 30; // flat bonus for any adjacent energy
    if (mem.reserved) score -= 5;
    if (mem.hostiles) score -= 30;
    return score;
}

function getExpansionTargets() {
    ensureEmpire();
    const targets = Memory.empire.expansionTargets || [];
    if (targets.length) return targets;
    if (Memory.empire.expansionTarget) return [Memory.empire.expansionTarget];
    return [];
}

function setExpansionTargets(list) {
    ensureEmpire();
    Memory.empire.expansionTargets = list;
    Memory.empire.expansionTarget = list[0] || null;
}

function planExpansion() {
    ensureEmpire();
    if (!config.expansion.enabled) return;

    const owned = lib.ownedRooms();
    if (!owned.length) return;

    const gcl = Game.gcl.level;
    const slots = Math.max(0, gcl - owned.length);
    if (slots <= 0) {
        setExpansionTargets([]);
        return;
    }

    // Validate / prune existing targets
    let current = getExpansionTargets().filter(t => {
        const mem = Memory.rooms[t];
        if (mem && mem.my) return false;
        if (mem && mem.owner) return false;
        return true;
    });

    const interval = config.expansion.replanInterval || 50;
    const due = !Memory.empire.lastExpansionPlan ||
        Game.time - Memory.empire.lastExpansionPlan >= interval ||
        current.length < slots;

    if (!due && current.length) {
        setExpansionTargets(current);
        return;
    }

    Memory.empire.lastExpansionPlan = Game.time;

    const funders = owned.filter(r =>
        r.controller.level >= config.expansion.minHomeRcl &&
        r.find(FIND_MY_SPAWNS).length > 0);
    if (!funders.length) {
        // Fall back: any spawn room can fund if minHomeRcl can't be met yet
        const any = owned.filter(r => r.find(FIND_MY_SPAWNS).length > 0);
        if (!any.length) {
            setExpansionTargets([]);
            return;
        }
        funders.push(...any);
    }

    // Candidates: every room within maxRange of owned, prioritizing ring-1
    const candidates = new Set();
    for (const room of owned) {
        for (const n of lib.adjacentRooms(room.name)) {
            candidates.add(n);
            if ((config.expansion.maxRange || 2) >= 2) {
                for (const n2 of lib.adjacentRooms(n)) {
                    if (!Memory.rooms[n2] || !Memory.rooms[n2].my) candidates.add(n2);
                }
            }
        }
    }

    // Scout queue: adjacent first
    const scoutFirst = [];
    const scoutRest = [];
    for (const name of candidates) {
        const mem = Memory.rooms[name];
        const stale = !mem || !mem.scouted ||
            Game.time - mem.scouted > config.expansion.scoutInterval * 5;
        if (!stale) continue;
        let adj = false;
        for (const room of owned) {
            if (lib.roomDistance(room.name, name) === 1) {
                adj = true;
                break;
            }
        }
        if (adj) scoutFirst.push(name);
        else scoutRest.push(name);
    }
    const queue = scoutFirst.concat(scoutRest);
    for (const name of queue) {
        if (Memory.empire.scoutQueue.indexOf(name) === -1) {
            Memory.empire.scoutQueue.push(name);
        }
    }
    if (Memory.empire.scoutQueue.length > 40) {
        Memory.empire.scoutQueue = Memory.empire.scoutQueue.slice(0, 40);
    }

    const scored = [];
    for (const name of candidates) {
        if (owned.some(r => r.name === name)) continue;
        const score = scoreClaimCandidate(name, funders.length ? funders : owned);
        if (score > 0) scored.push({ name, score });
    }
    scored.sort((a, b) => b.score - a.score);

    // Prefer adjacent-only set first if preferAdjacent
    let pickPool = scored;
    if (config.expansion.preferAdjacent) {
        const adjacent = scored.filter(s => {
            for (const room of owned) {
                if (lib.roomDistance(room.name, s.name) === 1) return true;
            }
            return false;
        });
        if (adjacent.length) pickPool = adjacent.concat(
            scored.filter(s => adjacent.indexOf(s) === -1)
        );
    }

    const take = config.expansion.parallelClaims ? slots : Math.min(1, slots);
    const next = [];
    for (const s of pickPool) {
        if (next.length >= take) break;
        next.push(s.name);
        if (Memory.rooms[s.name]) Memory.rooms[s.name].expansionCandidate = true;
    }

    // Keep still-valid previous targets that remain high priority
    for (const t of current) {
        if (next.indexOf(t) === -1 && next.length < take) next.push(t);
    }

    if (next.join(',') !== getExpansionTargets().join(',')) {
        lib.log(`Expansion targets → [${next.join(', ')}] (${scored.length} candidates, ${slots} slots)`);
    }
    setExpansionTargets(next);
}

function planRemotes() {
    ensureEmpire();
    if (!config.expansion.remotes) {
        Memory.empire.remotes = {};
        return;
    }

    const owned = lib.ownedRooms();
    const candidates = [];
    const perHome = {};
    const claimSet = {};
    for (const t of getExpansionTargets()) claimSet[t] = true;

    for (const room of owned) {
        if (room.controller.level < 2) continue;
        if (!room.find(FIND_MY_SPAWNS).length) continue;
        perHome[room.name] = 0;

        for (const n of lib.adjacentRooms(room.name)) {
            if (claimSet[n]) continue;
            if (Memory.rooms[n] && Memory.rooms[n].my) continue;
            const score = scoreRemote(n, room.name);
            if (score <= 0) continue;
            const mem = Memory.rooms[n] || {};
            candidates.push({
                name: n,
                home: room.name,
                sources: mem.sourceCount || (mem.sources && mem.sources.length) || 1,
                score,
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    const next = {};
    const maxTotal = config.expansion.maxRemotesTotal || 24;
    const maxPer = config.expansion.maxRemotesPerRoom || 4;

    for (const c of candidates) {
        if (Object.keys(next).length >= maxTotal) break;
        if (next[c.name]) continue;
        if ((perHome[c.home] || 0) >= maxPer) continue;
        next[c.name] = {
            home: c.home,
            sources: c.sources,
            score: c.score,
        };
        perHome[c.home] = (perHome[c.home] || 0) + 1;
        if (Memory.rooms[c.name]) Memory.rooms[c.name].remote = c.home;
    }

    for (const roomName in Memory.rooms) {
        if (Memory.rooms[roomName].remote && !next[roomName]) {
            delete Memory.rooms[roomName].remote;
        }
    }

    Memory.empire.remotes = next;
}

function visualize() {
    for (const room of lib.ownedRooms()) {
        const mem = Memory.rooms[room.name] || {};
        const targets = getExpansionTargets();
        room.visual.text(
            `RCL${room.controller.level} ${mem.phase || '?'} | GCL ${Game.gcl.level} | rooms ${lib.ownedRooms().length}` +
            (targets.length ? ` | claim ${targets.join(',')}` : ''),
            1, 1,
            { align: 'left', font: 0.6, opacity: 0.6 }
        );
    }
}

function run() {
    if (!lib.bucketOk('critical')) return;

    ensureEmpire();

    planExpansion();

    if (Game.time % 20 === 0) planRemotes();

    // Drop finished targets
    const ownedNames = {};
    for (const r of lib.ownedRooms()) ownedNames[r.name] = true;
    const before = getExpansionTargets();
    const after = before.filter(t => !ownedNames[t]);
    if (after.length !== before.length) {
        const done = before.filter(t => ownedNames[t]);
        if (done.length) lib.log(`Expansion complete: ${done.join(', ')}`);
        setExpansionTargets(after);
        Memory.empire.lastExpansionPlan = 0;
    }

    if (Game.time % 17 === 0) visualize();
}

module.exports = {
    run,
    planExpansion,
    planRemotes,
    scoreClaimCandidate,
    getExpansionTargets,
};
