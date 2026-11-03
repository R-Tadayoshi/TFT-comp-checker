// Run: node test/run.mjs   (builds a dataset from the fixture and checks the logic)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, itemStats, cleanText, assetUrl } from '../js/slim.js';
import { computeStats, scoreOf, guessMode, bestBuilds } from '../js/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(await readFile(resolve(here, 'fixture-raw.json'), 'utf8'));
const ds = buildDataset(raw);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

console.log('data');
ok('detects set 18 even though it is filed under key "10"', () => assert.equal(ds.meta.set, 18));
ok('knows the set name', () => assert.equal(ds.meta.setName, 'Enchanted Wilds'));
ok('keeps only playable champions (no anvils/tomes)', () => {
  assert.equal(ds.champions.length, 10);
  assert.ok(!ds.champions.some((c) => /Anvil|Tome/.test(c.name)));
});
ok('can force an older set', () => assert.equal(buildDataset(raw, { set: 17 }).meta.set, 17));
ok('champion stats are carried over', () => {
  const yi = ds.champions.find((c) => c.name === 'Master Yi');
  assert.deepEqual([yi.stats.hp, yi.stats.ad, yi.stats.as, yi.stats.mana, yi.cost], [850, 63, 0.8, 3, 3]);
});
ok('ability scaling shares come from the description', () => {
  const karma = ds.champions.find((c) => c.name === 'Karma').ability;
  assert.equal(karma.apShare, 1);
  const wick = ds.champions.find((c) => c.name === 'Warwick').ability;
  assert.equal(wick.adShare, 1);
  const cam = ds.champions.find((c) => c.name === 'Camille').ability;
  assert.equal(cam.adShare, 0.5);
});
ok('only traits used by champions are kept, with tiers', () => {
  const b = ds.traits.find((t) => t.name === 'Blossom');
  assert.deepEqual(b.tiers.map((t) => t.min), [3, 5, 7]);
});
ok('trait text gets each tier’s own numbers', () => {
  const b = ds.traits.find((t) => t.name === 'Blossom');
  assert.match(b.desc, /3\) 12% AD\/AP/);
  assert.match(b.desc, /7\) 50%/);
});

console.log('items');
ok('finds the 8 standard components, not Spatula/Pan', () => {
  assert.equal(ds.components.length, 8);
  assert.ok(!ds.components.some((c) => /Spatula|Pan/.test(c.name)));
});
ok('keeps completed items, drops emblems/artifacts/radiants/augments', () => {
  const names = ds.items.map((i) => i.name);
  assert.ok(names.includes('Synthetic Edge'));
  for (const bad of ['Synthetic Emblem', 'Synthetic Artifact', 'Radiant Synthetic', 'Some Augment']) assert.ok(!names.includes(bad), bad);
});
ok('config can hide a retired item', () => {
  const d = buildDataset(raw, { excludeItems: ['Retired Thing'] });
  assert.ok(!d.items.some((i) => i.name === 'Retired Thing'));
  assert.ok(ds.items.some((i) => i.name === 'Retired Thing'));
});
ok('effects map onto stats', () => {
  const edge = ds.items.find((i) => i.name === 'Synthetic Edge');
  assert.deepEqual(edge.stats, { ad: 0.35, crit: 0.35 });
  const rod = ds.items.find((i) => i.name === 'Synthetic Rod');
  assert.deepEqual(rod.stats, { ap: 50 });
});
ok('percent-style values are normalised', () => assert.deepEqual(itemStats({ AD: 35, CritChance: 20 }), { ad: 0.35, crit: 0.2 }));
ok('unknown/hashed effect keys are ignored', () => assert.deepEqual(itemStats({ '{abc123}': 4, Foo: 2 }), {}));
ok('descriptions are resolved and cleaned', () => {
  assert.equal(cleanText('Gain @AD*100@% <b>AD</b><br>now', { AD: 0.35 }), 'Gain 35% AD now');
});
ok('asset urls', () => {
  assert.equal(assetUrl('ASSETS/Maps/X/Y.tex'), 'https://raw.communitydragon.org/latest/game/assets/maps/x/y.png');
  assert.equal(assetUrl('{1ae0a111a91a05ab}'), null);
  assert.equal(assetUrl('None'), null);
});

console.log('engine');
const get = (name) => ds.champions.find((c) => c.name === name);
const item = (name) => ds.items.find((i) => i.name === name);

ok('stars scale HP by 1.8 and AD by 1.5 per star', () => {
  const w = get('Warwick');
  const s1 = computeStats(w, 1, []), s3 = computeStats(w, 3, []);
  assert.ok(Math.abs(s3.hp / s1.hp - 3.24) < 1e-9);
  assert.ok(Math.abs(s3.ad / s1.ad - 2.25) < 1e-9);
});
ok('AD item is a percentage of the unit’s own base AD', () => {
  const w = get('Warwick');
  const s = computeStats(w, 1, [item('Synthetic Edge')]);
  assert.ok(Math.abs(s.ad - 45 * 1.35) < 1e-9);
  assert.ok(Math.abs(s.crit - 0.6) < 1e-9);
});
ok('crit is capped at 100%', () => {
  const w = get('Warwick');
  const s = computeStats(w, 1, [item('Synthetic Edge'), item('Synthetic Edge'), item('Synthetic Edge')]);
  assert.equal(s.crit, 1);
});
ok('Rod gives AP 150 (100 base + 50) and raises ability output for an AP unit', () => {
  const k = get('Karma');
  const naked = computeStats(k, 2, []);
  const s = computeStats(k, 2, [item('Synthetic Rod')]);
  assert.equal(s.ap, 150);
  assert.ok(Math.abs(s.spellIdx / naked.spellIdx - 1.5) < 1e-9);
});
ok('mana items make the first cast sooner', () => {
  const k = get('Karma');
  const a = computeStats(k, 2, []), b = computeStats(k, 2, [item('Synthetic Tear')]);
  assert.ok(b.firstCast < a.firstCast);
  assert.ok(b.casts > a.casts);
});
ok('"every 3rd attack" units cast faster with attack speed', () => {
  const yi = get('Master Yi');
  const a = computeStats(yi, 2, []), b = computeStats(yi, 2, [item('Synthetic Bow')]);
  assert.ok(Math.abs(b.casts - a.casts) > 0.1 && b.casts > a.casts);
});
ok('armor raises physical EHP only', () => {
  const sh = get('Shen');
  const a = computeStats(sh, 2, []), b = computeStats(sh, 2, [item('Synthetic Wall')]);
  assert.ok(b.ehpP > a.ehpP);
  assert.ok(b.ehpM / a.ehpM < b.ehpP / a.ehpP);
});
ok('durability lowers damage taken', () => {
  const sh = get('Shen');
  const a = computeStats(sh, 2, []), b = computeStats(sh, 2, [item('Synthetic Guard')]);
  assert.ok(b.ehpM / a.ehpM > 1.2);
});
ok('role guesses', () => {
  assert.equal(guessMode(get('Karma')), 'ap');
  assert.equal(guessMode(get('Warwick')), 'ad');
  assert.equal(guessMode(get('Shen')), 'tank');
});

ok('scoring: AD carry prefers AD items, tank prefers defence, AP caster prefers AP', () => {
  const w = get('Warwick'), naked = computeStats(w, 2, []);
  const sc = (c, mode, name) => scoreOf(computeStats(c, 2, [item(name)]), computeStats(c, 2, []), mode);
  assert.ok(sc(w, 'ad', 'Synthetic Edge') > sc(w, 'ad', 'Synthetic Wall'));
  assert.ok(sc(w, 'tank', 'Synthetic Wall') > sc(w, 'tank', 'Synthetic Edge'));
  const k = get('Karma');
  assert.ok(sc(k, 'ap', 'Synthetic Rod') > sc(k, 'ap', 'Synthetic Edge'));
  assert.ok(Math.abs(sc(w, 'ad', 'Synthetic Plain') - 1) < 1e-12); // an item with no flat stats changes nothing
  assert.equal(scoreOf(naked, naked, 'ad'), 1);
});
ok('best 3-item builds: sorted, no duplicates, better than a single item', () => {
  const w = get('Warwick');
  const top = bestBuilds(w, 2, 'ad', ds.items, 3, 5);
  assert.equal(top.length, 5);
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].score >= top[i].score);
  for (const b of top) assert.equal(new Set(b.items.map((x) => x.id)).size, 3);
  const naked = computeStats(w, 2, []);
  const bestSingle = Math.max(...ds.items.map((it) => scoreOf(computeStats(w, 2, [it]), naked, 'ad')));
  assert.ok(top[0].score > bestSingle);
});

console.log(`\n${n} checks passed`);
