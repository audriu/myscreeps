/**
 * Minimum vertex cut between a room's exits and a protected area: the
 * fewest tiles whose ramparts seal every path from an exit into the base.
 * Max-flow (Dinic) on a split-vertex grid graph; pure computation on a
 * terrain getter, so it also runs offline.
 */

const N = 2500;
const INF = 1 << 28;

/**
 * @param {function(number, number): number} terrainAt  terrain mask (1 = wall) for x, y
 * @param {Uint8Array} protect  2500 flags (index y * 50 + x): tiles that must stay inside
 * @returns {number[]|null}  cut tile indices (y * 50 + x), or null if no cut exists
 */
function cut(terrainAt, protectIn) {
    const protect = Uint8Array.from(protectIn);
    const wall = new Uint8Array(N);
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) if (terrainAt(x, y) & 1) wall[y * 50 + x] = 1;
    // Exits and every tile next to one: nothing but roads and containers may be built there.
    const sink = new Uint8Array(N);
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            if ((x !== 0 && x !== 49 && y !== 0 && y !== 49) || wall[y * 50 + x]) continue;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && !wall[ny * 50 + nx]) sink[ny * 50 + nx] = 1;
                }
            }
        }
    }

    // A protected tile touching that zone could never be sealed off: leave it outside.
    for (let k = 0; k < N; k++) {
        if (!protect[k]) continue;
        const x = k % 50;
        const y = (k / 50) | 0;
        for (let dx = -1; dx <= 1 && protect[k]; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && sink[ny * 50 + nx]) { protect[k] = 0; break; }
            }
        }
    }

    // Graph: tile k -> in-node k, out-node k + N; S = 2N, T = 2N + 1.
    const S = 2 * N;
    const T = S + 1;
    const V = T + 1;
    const head = new Int32Array(V).fill(-1);
    const to = [];
    const cap = [];
    const next = [];
    const edge = (u, v, c) => {
        to.push(v); cap.push(c); next.push(head[u]); head[u] = to.length - 1;
        to.push(u); cap.push(0); next.push(head[v]); head[v] = to.length - 1;
    };
    for (let k = 0; k < N; k++) {
        if (wall[k]) continue;
        edge(k, k + N, protect[k] || sink[k] ? INF : 1);
        if (protect[k]) edge(S, k, INF);
        if (sink[k]) edge(k + N, T, INF);
        const x = k % 50;
        const y = (k / 50) | 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx > 49 || ny < 0 || ny > 49 || wall[ny * 50 + nx]) continue;
                edge(k + N, ny * 50 + nx, INF);
            }
        }
    }
    const capA = Int32Array.from(cap);
    const toA = Int32Array.from(to);
    const nextA = Int32Array.from(next);

    const level = new Int32Array(V);
    const iter = new Int32Array(V);
    const queue = new Int32Array(V);
    const bfs = () => {
        level.fill(-1);
        let qh = 0;
        let qt = 0;
        level[S] = 0;
        queue[qt++] = S;
        while (qh < qt) {
            const u = queue[qh++];
            for (let e = head[u]; e !== -1; e = nextA[e]) {
                if (capA[e] > 0 && level[toA[e]] < 0) {
                    level[toA[e]] = level[u] + 1;
                    queue[qt++] = toA[e];
                }
            }
        }
        return level[T] >= 0;
    };
    // Iterative DFS for a blocking flow; every augmenting path carries 1 unit
    // (cut capacities are 1), so plain path pushing is enough.
    const stack = new Int32Array(V);
    const via = new Int32Array(V);
    let flow = 0;
    while (bfs()) {
        for (let i = 0; i < V; i++) iter[i] = head[i];
        for (;;) {
            let sp = 0;
            stack[sp++] = S;
            let found = false;
            while (sp) {
                const u = stack[sp - 1];
                if (u === T) { found = true; break; }
                let e = iter[u];
                while (e !== -1 && !(capA[e] > 0 && level[toA[e]] === level[u] + 1)) e = nextA[e];
                iter[u] = e;
                if (e === -1) {
                    level[u] = -1;
                    sp--;
                    continue;
                }
                via[sp] = e;
                stack[sp++] = toA[e];
            }
            if (!found) break;
            let push = INF;
            for (let i = 1; i < sp; i++) push = Math.min(push, capA[via[i]]);
            for (let i = 1; i < sp; i++) {
                capA[via[i]] -= push;
                capA[via[i] ^ 1] += push;
            }
            flow += push;
            if (flow >= INF) return null;
        }
    }

    // Tiles whose in-node is reachable from S in the residual graph but out-node is not.
    const seen = new Uint8Array(V);
    let qh = 0;
    let qt = 0;
    seen[S] = 1;
    queue[qt++] = S;
    while (qh < qt) {
        const u = queue[qh++];
        for (let e = head[u]; e !== -1; e = nextA[e]) {
            if (capA[e] > 0 && !seen[toA[e]]) {
                seen[toA[e]] = 1;
                queue[qt++] = toA[e];
            }
        }
    }
    const out = [];
    for (let k = 0; k < N; k++) if (!wall[k] && seen[k] && !seen[k + N]) out.push(k);
    return out;
}

module.exports = { cut };
