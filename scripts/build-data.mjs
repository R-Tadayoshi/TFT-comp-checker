// Downloads the CommunityDragon TFT dump and writes data/set.json for the current set.
//   node scripts/build-data.mjs                 current set
//   node scripts/build-data.mjs --set 17        a specific set
//   node scripts/build-data.mjs --in raw.json   use a local copy of the raw file
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, RAW_URL } from '../js/slim.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const cfg = await readFile(resolve(root, 'config/items.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const input = flag('--in');
const raw = input
  ? JSON.parse(await readFile(input, 'utf8'))
  : await fetch(flag('--url') || RAW_URL).then((r) => {
      if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
      return r.json();
    });

const data = buildDataset(raw, { ...cfg, set: flag('--set') });
const out = flag('--out') || resolve(root, 'data/set.json');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(data));
const { set, setName, counts } = data.meta;
console.log(`Set ${set}${setName ? ' ' + setName : ''}: ${counts.champions} champions, ${counts.traits} traits, ${counts.items} items → ${out}`);
