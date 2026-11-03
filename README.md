# TFT Comp Lab

Build a Teamfight Tactics comp, then see exactly how each item changes a unit's stats and which item is best for the role you want it to play. Plain HTML/CSS/JS, no build step, runs on GitHub Pages.

## Put it online

1. Create a GitHub repository and upload everything in this folder (keep the `.github` folder).
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). The site appears at `https://<you>.github.io/<repo>/`.

The workflow downloads the current set's data from [CommunityDragon](https://communitydragon.org) on every push and once a day, so the site follows new sets and patches by itself (it picks the highest set number in the data). If that download ever fails, the site falls back to downloading the data in the visitor's browser (about 24 MB, cached for a day).

## Using it

- Click champions to add them. Traits and breakpoints update live.
- Click a unit in your comp to open it in the **Item lab**, or pick any unit from the lab's drop-down.
- Pick a **star level** and a **role** (AD carry, AP caster, Hybrid, Tank, Bruiser). The role is suggested from the unit's stats and ability; the dot marks the suggestion.
- Select a slot in Build A, then click an item in the ranking. Every row shows how that item changes the build score, auto-attack damage, ability output and effective health.
- **Compare with a second build** puts Build A and B side by side. **Find the best builds** tries every 3-item combination.
- **Copy share link** puts your whole comp in the URL.

## Fixing the item list

The data file also contains retired items. If one shows up, add its name to `excludeItems` in `config/items.json`. Missing one? Add it to `includeItems`.

## Limits worth knowing

Only flat item stats are modelled. Conditional effects (stacking, shields, procs), trait bonuses, augments and special trait rules such as Avatar or Apex Predator are not. Ability damage is relative (how much stronger a cast gets), not an absolute number. See "How the numbers work" at the bottom of the page.

## Development

```
node test/run.mjs                                         # logic tests (use a synthetic fixture)
node scripts/build-data.mjs                               # fetch data into data/set.json
node scripts/build-data.mjs --set 17                      # a specific set
python3 -m http.server                                    # then open http://localhost:8000
```

Fan project. Not endorsed by Riot Games. Teamfight Tactics is a trademark of Riot Games, Inc.
