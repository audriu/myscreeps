/**
 * Links inside a room and terminal energy balancing between rooms.
 */
const config = require('config');
const util = require('util');

function runLinks(st) {
    if (!st.links.length) return;
    const ctrlLink = st.ctrlLink;
    const storageLink = st.storageLink;
    const min = config.links.minSend;

    const sendTo = (from, to) => {
        if (!from || !to || from.cooldown > 0) return false;
        const amount = Math.min((from.store[RESOURCE_ENERGY] || 0), to.store.getFreeCapacity(RESOURCE_ENERGY));
        if (amount < min) return false;
        return from.transferEnergy(to, amount) === OK;
    };

    for (let i = 0; i < st.sourceLinks.length; i++) {
        const link = st.sourceLinks[i];
        if ((link.store[RESOURCE_ENERGY] || 0) < min) continue;
        if (ctrlLink && (ctrlLink.store[RESOURCE_ENERGY] || 0) < LINK_CAPACITY - min && sendTo(link, ctrlLink)) continue;
        if (storageLink && sendTo(link, storageLink)) continue;
    }
    // Storage link feeds the controller when no source link does.
    if (storageLink && ctrlLink && (ctrlLink.store[RESOURCE_ENERGY] || 0) < LINK_CAPACITY / 2 && (storageLink.store[RESOURCE_ENERGY] || 0) >= min) {
        sendTo(storageLink, ctrlLink);
    }
}

/** Move energy from rich terminals to poor rooms. Runs rarely. */
function balanceTerminals(states) {
    const cfg = config.terminal;
    const donors = [];
    const receivers = [];
    for (let i = 0; i < states.length; i++) {
        const st = states[i];
        if (!st.terminal || !st.storage) continue;
        const storageEnergy = (st.storage.store[RESOURCE_ENERGY] || 0);
        const terminalEnergy = (st.terminal.store[RESOURCE_ENERGY] || 0);
        if (storageEnergy > cfg.donorStorage && terminalEnergy >= cfg.amount + 2000 && !st.terminal.cooldown) donors.push(st);
        else if (storageEnergy < cfg.receiverStorage) receivers.push(st);
    }
    if (!donors.length || !receivers.length) return;
    const used = {};
    for (let i = 0; i < donors.length; i++) {
        const d = donors[i];
        let best = null;
        let bestDist = Infinity;
        for (let j = 0; j < receivers.length; j++) {
            const r = receivers[j];
            if (used[r.name]) continue;
            const dist = util.roomDistance(d.name, r.name);
            if (dist < bestDist) {
                bestDist = dist;
                best = r;
            }
        }
        if (!best) return;
        const amount = cfg.amount;
        const fee = Game.market.calcTransactionCost(amount, d.name, best.name);
        if ((d.terminal.store[RESOURCE_ENERGY] || 0) < amount + fee) continue;
        if (d.terminal.send(RESOURCE_ENERGY, amount, best.name, 'balance') === OK) {
            used[best.name] = true;
            util.log(d.name + ' -> ' + best.name + ': sent ' + amount + ' energy (fee ' + fee + ')');
        }
    }
}

module.exports = { runLinks, balanceTerminals };
