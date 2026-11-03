```
    _             _      _           _                                                    _       _       
   / \  _   _  __| |_ __(_)_   _ ___( )  ___  ___ _ __ ___  ___ _ __  ___   ___  ___ _ __(_)_ __ | |_ ___ 
  / _ \| | | |/ _` | '__| | | | / __|/  / __|/ __| '__/ _ \/ _ \ '_ \/ __| / __|/ __| '__| | '_ \| __/ __|
 / ___ \ |_| | (_| | |  | | |_| \__ \   \__ \ (__| | |  __/  __/ |_) \__ \ \__ \ (__| |  | | |_) | |_\__ \
/_/   \_\__,_|\__,_|_|  |_|\__,_|___/   |___/\___|_|  \___|\___| .__/|___/ |___/\___|_|  |_| .__/ \__|___/
                                                               |_|                         |_|            
```

Personal [Screeps](https://screeps.com/) colony scripts. Played on shard1
(home room W49N25); shard0 was abandoned on 2026-11-02.

## Layout

```
default/      # the colony AI (upload as branch "default"), see default/README.md
tools/sim/    # offline simulator that runs the script against real room snapshots
bookmarks     # links
```

## War

Attacking another room is driven from the in-game console through
`Memory.war`: squads, final sweep, low-energy muster, CLAIM teams on the
enemy controller. Commands, the stop table and settings are in
[default/README.md#war](default/README.md#war).

## Colonizing

New rooms are claimed automatically once the gates pass (free GCL slot, every
room RCL3+, an RCL5 funder), or from the console:

```js
Memory.empire.claim = { target: 'W48N25', from: 'W49N25', t: Game.time }
```

Gates, forcing, stopping and progress checks are in
[default/README.md#colonizing](default/README.md#colonizing).

## Deploy

Pushing to `main` deploys: the Screeps GitHub integration
(https://screeps.com/a/#!/account/github) syncs the `default` folder of this
repository into the `default` code branch. Only `*.js` files are uploaded.

## Test before uploading

```
node tools/sim/fetch.js <username> shard1
node tools/sim/run.js default W49N25 2000
```
