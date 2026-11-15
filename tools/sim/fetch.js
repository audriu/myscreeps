/* Download room snapshots and terrain for an account's rooms from the public
 * Screeps API into tools/sim/data/. Usage: node fetch.js <username> [shard] [--neighbours]
 * --neighbours also saves every room next to one of ours (remote mining). */
const https = require('https');
const fs = require('fs');
const path = require('path');

const username = process.argv[2];
const neighbours = process.argv.includes('--neighbours');
const shard = process.argv.slice(3).find(a => !a.startsWith('--')) || 'shard1';
if (!username) {
    console.error('usage: node fetch.js <username> [shard]');
    process.exit(1);
}
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(path.join(dataDir, 'rooms'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'terrain'), { recursive: true });

function get(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'myscreeps-sim' } }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad response from ' + url)); }
            });
        }).on('error', reject);
    });
}

(async () => {
    const user = await get('https://screeps.com/api/user/find?username=' + encodeURIComponent(username));
    if (!user.user) throw new Error('user not found');
    const rooms = await get('https://screeps.com/api/user/rooms?id=' + user.user._id);
    const list = (rooms.shards && rooms.shards[shard]) || [];
    console.log(username + ' owns ' + list.length + ' room(s) on ' + shard + ': ' + list.join(' '));
    for (const r of list) {
        const objects = await get('https://screeps.com/api/game/room-objects?room=' + r + '&shard=' + shard);
        fs.writeFileSync(path.join(dataDir, 'rooms', r + '.json'), JSON.stringify(objects));
        const terrain = await get('https://screeps.com/api/game/room-terrain?room=' + r + '&shard=' + shard + '&encoded=1');
        fs.writeFileSync(path.join(dataDir, 'terrain', r + '.json'), JSON.stringify(terrain));
        console.log('saved ' + r);
    }
    if (neighbours) {
        const near = {};
        for (const r of list) {
            const m = /^([WE])(\d+)([NS])(\d+)$/.exec(r);
            const x = +m[2], y = +m[4];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (x + dx < 0 || y + dy < 0) continue;
                const n = m[1] + (x + dx) + m[3] + (y + dy);
                if (list.indexOf(n) === -1) near[n] = true;
            }
        }
        for (const r of Object.keys(near)) {
            const objects = await get('https://screeps.com/api/game/room-objects?room=' + r + '&shard=' + shard);
            if (!objects.objects) continue;
            fs.writeFileSync(path.join(dataDir, 'rooms', r + '.json'), JSON.stringify(objects));
            const terrain = await get('https://screeps.com/api/game/room-terrain?room=' + r + '&shard=' + shard + '&encoded=1');
            fs.writeFileSync(path.join(dataDir, 'terrain', r + '.json'), JSON.stringify(terrain));
            console.log('saved neighbour ' + r);
        }
    }
    const time = await get('https://screeps.com/api/game/time?shard=' + shard);
    fs.writeFileSync(path.join(dataDir, 'time.json'), JSON.stringify({ time: time.time, user: user.user._id, username }));
    console.log('done; game time ' + time.time);
})().catch(e => {
    console.error(e.message || e);
    process.exit(1);
});
