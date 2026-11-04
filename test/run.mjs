// Run: node test/run.mjs   (builds a dataset from the fixture and checks the logic)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, itemStats, cleanText, assetUrl } from '../js/slim.js';
import { computeStats, scoreOf, guessMode, bestBuilds } from '../js/engine.js';
import { applyTraits, ruleVarNames } from '../js/traits.js';
import { neighbors } from '../js/board.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(await readFile(resolve(here, 'fixture-raw.json'), 'utf8'));
const rules = JSON.parse(await readFile(resolve(here, '../config/traits.json'), 'utf8'));
const ds = buildDataset(raw, { varNames: ruleVarNames(rules) });
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

console.log('hashed variables');
ok('hashed trait variables are decoded by name', () => {
  const d = ds.traits.find((t) => t.name === 'Defender');
  assert.equal(d.tiers[0].vars.NonDefenderDefenseGain, 12);
  assert.equal(d.tiers[1].vars.DefenderDefenseGain, 60);
  assert.ok(!Object.keys(d.tiers[0].vars).some((k) => k[0] === '{'));
});
ok('trait text shows decoded numbers per tier', () => {
  const d = ds.traits.find((t) => t.name === 'Defender');
  assert.match(d.desc, /2\) 25/);
  assert.match(d.desc, /4\) 60/);
});

console.log('traits');
const champ = Object.fromEntries(ds.champions.map((c) => [c.id, c]));
const trait = Object.fromEntries(ds.traits.map((t) => [t.name, t]));
const unit = (name, pos) => ({ id: ds.champions.find((c) => c.name === name).id, star: 2, items: [], pos });
const run = (team) => applyTraits({ team, champ, trait, rules });
const statsOf = (res, u) => res.byUnit.get(u).stats;

ok('hex neighbours follow the offset rows', () => {
  assert.deepEqual(neighbors(0).sort((a, b) => a - b), [1, 7]);           // top-left corner
  assert.deepEqual(neighbors(8).sort((a, b) => a - b), [1, 2, 7, 9, 15, 16]); // odd row, shifted right
  assert.deepEqual(neighbors(15).sort((a, b) => a - b), [7, 8, 14, 16, 21, 22]); // even row, shifted left
  for (let p = 0; p < 28; p++) for (const q of neighbors(p)) assert.ok(neighbors(q).includes(p), `${p}<->${q}`);
});
ok('members get the member value, everyone else the team value (Defender)', () => {
  const karma = unit('Karma', 0), leb = unit('LeBlanc', 1), shen = unit('Shen', 2);
  const res = run([karma, leb, shen]);
  assert.equal(statsOf(res, shen).armor, 25);   // Defender member
  assert.equal(statsOf(res, leb).armor, 25);
  assert.equal(statsOf(res, karma).armor, 12);  // not a Defender: team bonus
});
ok('team AP and member AP replace each other (Spellweaver)', () => {
  const karma = unit('Karma', 0), leb = unit('LeBlanc', 1), shen = unit('Shen', 2);
  const res = run([karma, leb, shen]);
  assert.ok(Math.abs(statsOf(res, karma).ap - 10) < 1e-9);  // member at tier 2
  assert.ok(Math.abs(statsOf(res, shen).ap - 10) < 1e-9);   // team bonus
});
ok('inactive traits give nothing', () => {
  const res = run([unit('Karma', 0), unit('Warwick', 1)]);
  assert.equal(statsOf(res, res.byUnit.keys().next().value).armor, undefined);
  assert.equal(res.active.length, 0);
});
ok('active traits without a rule are reported, not silently dropped', () => {
  const res = run([unit('Warwick', 0), unit('Camille', 1)]); // Ravager 2: has a rule; Coven/Blackthorn 1: inactive
  assert.ok(res.active.some((a) => a.name === 'Ravager'));
  const res2 = run([unit('Shen', 0), unit('LeBlanc', 1)]);   // Defender 2 has a rule
  assert.ok(!res2.uncounted.some((u) => u.name === 'Defender'));
});
ok('unique champions count once even if two variants are fielded', () => {
  const a = unit('Lux (Blossom)', 0), b = unit('Lux (Fae)', 1);
  const res = run([a, b]);
  assert.equal(res.active.find((x) => x.name === 'Avatar').count, 1);
});
ok('trait stats flow into the numbers (Defender armor, Blossom % health)', () => {
  const shen = unit('Shen', 0), leb = unit('LeBlanc', 1);
  const res = run([shen, leb]);
  const withT = computeStats(champ[shen.id], 2, [], statsOf(res, shen));
  const without = computeStats(champ[shen.id], 2, []);
  assert.equal(withT.armor - without.armor, 25);
  assert.ok(withT.ehpP > without.ehpP);
  const hp = computeStats(champ[shen.id], 2, [], { hpPct: 0.1 });
  assert.ok(Math.abs(hp.hp / without.hp - 1.1) < 1e-9);
  const sh = computeStats(champ[shen.id], 2, [], { shield: 0.2 });
  assert.ok(Math.abs(sh.ehpM / without.ehpM - 1.2) < 1e-9);
});

// Adjacency: handcrafted data so no fixture needs to know about Lunar.
const mk = (id, name, traits, ability = { adShare: 0, apShare: 1 }) => ({ id, name, traits, stats: {}, ability });
const lcCh = { m1: mk('m1', 'Moon', ['Lunar']), m2: mk('m2', 'Moon2', ['Lunar']), o: mk('o', 'Other', ['X']) };
const lcTrait = { Lunar: { name: 'Lunar', tiers: [{ min: 2, style: 1, vars: { AttackSpeed: 0.07, AbilityPower: 0.07, LunarMultiplier: 1 } }] } };
const lcRules = { Lunar: rules.Lunar };
ok('Lunar: members get double, units next to a member get the normal bonus, others nothing', () => {
  const a = { id: 'm1', pos: 10 }, b = { id: 'm2', pos: 3 }, near = { id: 'o', pos: 9 }, far = { id: 'o', pos: 27 };
  const res = applyTraits({ team: [a, b, near, far], champ: lcCh, trait: lcTrait, rules: lcRules });
  assert.ok(Math.abs(res.byUnit.get(a).stats.as - 0.14) < 1e-9);
  assert.ok(Math.abs(res.byUnit.get(a).stats.ap - 14) < 1e-9);
  assert.ok(Math.abs(res.byUnit.get(near).stats.as - 0.07) < 1e-9);
  assert.equal(res.byUnit.get(far).stats.as, undefined);
});
ok('"adap" gives AD to attack units and AP to spell units (Adaptor)', () => {
  const ch = { a: mk('a', 'A', ['Adaptor'], { adShare: 1, apShare: 0 }), b: mk('b', 'B', ['Adaptor'], { adShare: 0, apShare: 1 }) };
  const tr = { Adaptor: { name: 'Adaptor', tiers: [{ min: 2, style: 1, vars: { ADAPGain: 0.25 } }] } };
  const ua = { id: 'a', pos: 0 }, ub = { id: 'b', pos: 1 };
  const res = applyTraits({ team: [ua, ub], champ: ch, trait: tr, rules: { Adaptor: rules.Adaptor } });
  assert.equal(res.byUnit.get(ua).stats.ad, 0.25);
  assert.equal(res.byUnit.get(ub).stats.ap, 25);
});
ok('a rule whose variable is missing from the data is flagged', () => {
  const ch = { a: mk('a', 'A', ['Hunter']), b: mk('b', 'B', ['Hunter']) };
  const tr = { Hunter: { name: 'Hunter', tiers: [{ min: 2, style: 1, vars: {} }] } };
  const res = applyTraits({ team: [{ id: 'a', pos: 0 }, { id: 'b', pos: 1 }], champ: ch, trait: tr, rules: { Hunter: rules.Hunter } });
  assert.equal(res.uncounted[0].reason, 'variables not found in the data');
});
ok('every variable the rules need can be decoded from a description', () => {
  assert.ok(ruleVarNames(rules).includes('DefenderDefenseGain'));
  assert.ok(ruleVarNames(rules).includes('LunarMultiplier'));
});

console.log(`\n${n} checks passed`);
