/* Download room snapshots and terrain for an account's rooms from the public
 * Screeps API into tools/sim/data/. Usage: node fetch.js <username> [shard] */
const https = require('https');
const fs = require('fs');
const path = require('path');

const username = process.argv[2];
const shard = process.argv[3] || 'shard0';
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
    const time = await get('https://screeps.com/api/game/time?shard=' + shard);
    fs.writeFileSync(path.join(dataDir, 'time.json'), JSON.stringify({ time: time.time, user: user.user._id, username }));
    console.log('done; game time ' + time.time);
})().catch(e => {
    console.error(e.message || e);
    process.exit(1);
});
