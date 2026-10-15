```
    _             _      _           _                                                    _       _       
   / \  _   _  __| |_ __(_)_   _ ___( )  ___  ___ _ __ ___  ___ _ __  ___   ___  ___ _ __(_)_ __ | |_ ___ 
  / _ \| | | |/ _` | '__| | | | / __|/  / __|/ __| '__/ _ \/ _ \ '_ \/ __| / __|/ __| '__| | '_ \| __/ __|
 / ___ \ |_| | (_| | |  | | |_| \__ \   \__ \ (__| | |  __/  __/ |_) \__ \ \__ \ (__| |  | | |_) | |_\__ \
/_/   \_\__,_|\__,_|_|  |_|\__,_|___/   |___/\___|_|  \___|\___| .__/|___/ |___/\___|_|  |_| .__/ \__|___/
                                                               |_|                         |_|            
```

Personal [Screeps](https://screeps.com/) colony scripts.

## Layout

```
default/      # the colony AI (upload as branch "default"), see default/README.md
tools/sim/    # offline simulator that runs the script against real room snapshots
bookmarks     # links
```

## Deploy

Pushing to `main` deploys: the Screeps GitHub integration
(https://screeps.com/a/#!/account/github) syncs the `default` folder of this
repository into the `default` code branch. Only `*.js` files are uploaded.

## Test before uploading

```
node tools/sim/fetch.js <username> shard0
node tools/sim/run.js default E12N39 2000
```
