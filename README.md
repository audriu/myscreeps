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
default/
  main.js       # game loop
  spawning.js   # creep spawning & cleanup
  tasks.js      # roles: ant, colonist, fighter
  towers.js     # tower defense
```

## Roles

| Role | Job |
|------|-----|
| `ant` | harvest energy and work |
| `colonist` | claim rooms |
| `fighter` | attack target rooms |

## Sync

Drop the `default/` folder into your Screeps client (or sync tool) as a branch named `default`.
