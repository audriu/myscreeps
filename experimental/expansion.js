/**
 * Expansion brain: scout intel → score rooms → claim → remotes.
 * Goal: occupy as much map as GCL / economy allows.
 */

const config = require('config');
const lib = require('lib');

function ensureEmpire() {
    if (!Memory.empire) {
        Memory.empire = {
            expansionTarget: null,
            remotes: {},
            lastExpansionPlan: 0,
            scoutQueue: [],
        };
    }
    if (!Memory.empire.remotes) Memory.empire.remotes = {};
    if (!Memory.empire.scoutQueue) Memory.empire.scoutQueue = [];
}

/**
 * Score a room for claiming. Higher = better.
 */
function scoreClaimCandidate(roomName, fromRooms) {
    const mem = Memory.rooms[roomName];
    if (!mem || mem.my) return -Infinity;
    if (mem.keeper) return -Infinity;
    if (mem.owner) return -Infinity;
    if (mem.claimable === false) return -Infinity;

    // Need controller — if never scouted, unknown
    if (mem.scouted == null) return -1000;

    const sources = mem.sourceCount != null ? mem.sourceCount :
        (mem.sources ? mem.sources.length : 0);

    if (sources < 1) return -Infinity;

    let minDist = Infinity;
    for (const r of fromRooms) {
        const d = lib.roomDistance(r.name, roomName);
        if (d < minDist) minDist = d;
    }
    if (minDist > config.expansion.maxRange) return -Infinity;

    let score = 0;
    score += sources * 100;
    if (sources >= config.expansion.preferSources) score += 50;
    score -= minDist * 25;

    // Prefer recently scouted (known safe)
    const age = Game.time - (mem.scouted || 0);
    if (age < 3000) score += 20;
    if (age > 10000) score -= 30;

    // Avoid reserved by others
    if (mem.reserved && mem.owner == null) {
        // reserved by someone — still claimable but contested
        score -= 40;
    }

    // Hostiles when last seen
    if (mem.hostiles) score -= mem.hostiles * 15;

    // Slight preference for rooms adjacent to two owned rooms (border fill)
    let adjOwned = 0;
    for (const n of lib.adjacentRooms(roomName)) {
        if (Memory.rooms[n] && Memory.rooms[n].my) adjOwned++;
    }
    score += adjOwned * 15;

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
    if (dist !== 1) return -Infinity; // adjacent only for remotes

    const sources = mem.sourceCount != null ? mem.sourceCount :
        (mem.sources ? mem.sources.length : 0);
    if (sources < 1) return -Infinity;

    let score = sources * 50 - dist * 10;
    if (mem.reserved) score -= 20;
    if (mem.hostiles) score -= 30;
    return score;
}

function planExpansion() {
    ensureEmpire();
    if (!config.expansion.enabled) return;

    if (Memory.empire.lastExpansionPlan &&
        Game.time - Memory.empire.lastExpansionPlan < config.expansion.replanInterval &&
        Memory.empire.expansionTarget) {
        // Validate current target still makes sense
        const t = Memory.empire.expansionTarget;
        const mem = Memory.rooms[t];
        if (mem && mem.my) {
            Memory.empire.expansionTarget = null;
        } else if (mem && mem.owner) {
            Memory.empire.expansionTarget = null;
        } else {
            return;
        }
    }

    Memory.empire.lastExpansionPlan = Game.time;

    const owned = lib.ownedRooms();
    if (!owned.length) return;

    const gcl = Game.gcl.level;
    if (owned.length >= gcl) {
        Memory.empire.expansionTarget = null;
        return;
    }

    // Need at least one healthy funder
    const funders = owned.filter(r =>
        r.controller.level >= config.expansion.minHomeRcl &&
        r.find(FIND_MY_SPAWNS).length > 0);
    if (!funders.length) {
        Memory.empire.expansionTarget = null;
        return;
    }

    // Gather candidates: adjacent rings around owned rooms
    const candidates = new Set();
    for (const room of owned) {
        for (const n of lib.adjacentRooms(room.name)) candidates.add(n);
        // Second ring
        for (const n of lib.adjacentRooms(room.name)) {
            for (const n2 of lib.adjacentRooms(n)) {
                if (!Memory.rooms[n2] || !Memory.rooms[n2].my) candidates.add(n2);
            }
        }
    }

    // Queue unknown rooms for scouting
    for (const name of candidates) {
        const mem = Memory.rooms[name];
        if (!mem || !mem.scouted || Game.time - mem.scouted > config.expansion.scoutInterval * 10) {
            if (Memory.empire.scoutQueue.indexOf(name) === -1) {
                Memory.empire.scoutQueue.push(name);
            }
        }
    }
    // Cap queue length
    if (Memory.empire.scoutQueue.length > 30) {
        Memory.empire.scoutQueue = Memory.empire.scoutQueue.slice(0, 30);
    }

    let best = null;
    let bestScore = 0;
    for (const name of candidates) {
        const score = scoreClaimCandidate(name, funders);
        if (score > bestScore) {
            bestScore = score;
            best = name;
        }
    }

    if (best && bestScore > 0) {
        if (Memory.empire.expansionTarget !== best) {
            lib.log(`Expansion target → ${best} (score ${bestScore})`);
        }
        Memory.empire.expansionTarget = best;
        if (Memory.rooms[best]) Memory.rooms[best].expansionCandidate = true;
    } else {
        Memory.empire.expansionTarget = null;
    }
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

    for (const room of owned) {
        if (room.controller.level < 3) continue;
        if (!room.find(FIND_MY_SPAWNS).length) continue;
        perHome[room.name] = 0;

        for (const n of lib.adjacentRooms(room.name)) {
            if (Memory.empire.expansionTarget === n) continue;
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
    const maxTotal = config.expansion.maxRemotesTotal || 8;
    const maxPer = config.expansion.maxRemotesPerRoom || 2;

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

    // Clear stale remote markers
    for (const roomName in Memory.rooms) {
        if (Memory.rooms[roomName].remote && !next[roomName]) {
            delete Memory.rooms[roomName].remote;
        }
    }

    Memory.empire.remotes = next;
}

/**
 * Visual / status on owned rooms.
 */
function visualize() {
    for (const room of lib.ownedRooms()) {
        const mem = Memory.rooms[room.name] || {};
        const target = Memory.empire && Memory.empire.expansionTarget;
        room.visual.text(
            `RCL${room.controller.level} ${mem.phase || '?'} | GCL ${Game.gcl.level} | rooms ${lib.ownedRooms().length}` +
            (target ? ` | claim ${target}` : ''),
            1, 1,
            { align: 'left', font: 0.6, opacity: 0.6 }
        );
    }
}

function run() {
    if (!lib.bucketOk('critical')) return;

    ensureEmpire();

    // Plan on interval or when no target
    if (!Memory.empire.lastExpansionPlan ||
        Game.time - Memory.empire.lastExpansionPlan >= config.expansion.replanInterval ||
        !Memory.empire.expansionTarget) {
        planExpansion();
        planRemotes();
    } else if (Game.time % 100 === 0) {
        planRemotes();
    }

    // Clear target if we already own it
    const t = Memory.empire.expansionTarget;
    if (t && Memory.rooms[t] && Memory.rooms[t].my) {
        lib.log(`Expansion complete: ${t}`);
        Memory.empire.expansionTarget = null;
        Memory.empire.lastExpansionPlan = 0;
    }

    if (Game.time % 17 === 0) visualize();
}

module.exports = {
    run,
    planExpansion,
    planRemotes,
    scoreClaimCandidate,
};
