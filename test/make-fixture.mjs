// Builds test/fixture-raw.json: a tiny file shaped like the CommunityDragon dump.
// Champion stats are copied from the real Set 18 data. ITEMS ARE SYNTHETIC: only for testing the code.
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const champ = (apiName, name, cost, traits, st, desc, setTag = 18) => ({
  ability: { desc, icon: 'None', name: name + ' ability', variables: [] },
  apiName, characterName: apiName, cost, icon: 'None', name, role: null,
  squareIcon: `assets/characters/tft${setTag}_${name.toLowerCase().replace(/\W/g, '')}/skins/base/images/t_${setTag}_${name.toLowerCase().replace(/\W/g, '')}_tile.tex`,
  stats: { armor: st[0], attackSpeed: st[1], critChance: 0.25, critMultiplier: 1.4, damage: st[2], hp: st[3], initialMana: st[4], magicResist: st[0], mana: st[5], range: st[6] },
  tileIcon: 'None', traits,
});
//                                armor AS    AD   HP   iMana mana range
const set18 = [
  champ('DA_Karma18', 'Karma', 1, ['Blossom', 'Spellweaver'], [25, 0.7, 25, 500, 0, 40, 4], 'Tether dealing @X@ %i:scaleAP% magic damage.'),
  champ('DA_18_LeBlanc', 'LeBlanc', 2, ['Elderwood', 'Spellweaver'], [30, 0.7, 30, 550, 0, 40, 4], 'Launch a mirror image dealing @X@ %i:scaleAP% magic damage.'),
  champ('DA_18_MasterYi_AD', 'Master Yi', 3, ['Blossom', 'Adaptor'], [55, 0.8, 63, 850, 0, 3, 1], 'Every third attack is a Double Strike. Adaptor %i:scaleAD% grants Attack Speed. %i:scaleAP% bonus damage.'),
  champ('DA_18_Shen', 'Shen', 2, ['Inferno', 'Defender'], [45, 0.65, 50, 900, 30, 90, 1], 'Grant @X@ %i:scaleAP% Shield to Shen. Both attacks deal bonus %i:scaleAP% damage.'),
  champ('DA_18_Warwick', 'Warwick', 2, ['Blackthorn', 'Ravager'], [45, 0.75, 45, 750, 0, 40, 1], 'Bite dealing @X@ %i:scaleAD% physical damage.'),
  champ('DA_18_Camille', 'Camille', 1, ['Coven', 'Ravager'], [40, 0.75, 40, 700, 0, 25, 1], 'Slice for @X@ %i:scaleAD%%i:scaleAP% physical damage and gain a Shield.'),
  champ('DA_CrimsonRaptor18', 'Mama Beak', 3, ['Riftbeast', 'Summoner', 'Rapidfire'], [35, 0.75, 60, 650, 20, 60, 4], 'Summon Tiny Beaks dealing @X@ %i:scaleAD% damage.'),
  champ('DA_18_ElderDragon', 'Elder Dragon', 5, ['Apex Predator', 'Riftbeast'], [75, 0.5, 125, 1800, 20, 60, 2], 'Spew fire dealing @X@ %i:scaleAD%%i:scaleAP% damage.'),
  champ('DA_Lux18_Blossom', 'Lux (Blossom)', 5, ['Blossom', 'Avatar'], [45, 0.8, 40, 900, 20, 70, 6], 'Fire a laser dealing @X@ %i:scaleAP% magic damage.'),
  champ('DA_18_Lux_Fae', 'Lux (Fae)', 5, ['Fae', 'Avatar'], [45, 0.8, 40, 900, 20, 70, 6], 'Fire a laser dealing @X@ %i:scaleAP% magic damage.'),
];
// Non-playable entries that the real file also contains
const junk = [
  { ...champ('TFT5_EmblemArmoryKey', 'Tome of Traits', 8, [], [10, 1, 0, 10, 0, 100, 0], 'Drag me.'), stats: { armor: 10, attackSpeed: 1, critChance: null, critMultiplier: 0, damage: null, hp: 10, initialMana: 0, magicResist: 10, mana: 100, range: 0 } },
  { ...champ('TFT_ArmoryKeyCompleted', 'Completed Item Anvil', 8, [], [10, 1, 70, 10, 0, 100, 0], 'Drag me.') },
];
const set17 = Array.from({ length: 9 }, (_, i) =>
  champ(`TFT17_Old${i}`, `Old${i}`, 1 + (i % 5), ['Anima'], [20, 0.7, 30, 600, 0, 60, 2], 'x %i:scaleAD%', 17));

const trait = (apiName, name, tiers, desc = '') => ({
  apiName, name, desc, icon: `assets/ux/traiticons/trait_icon_18_${name.toLowerCase().replace(/\W/g, '')}.tex`,
  effects: tiers.map(([min, max, style, variables = {}]) => ({ minUnits: min, maxUnits: max, style, variables })),
});
const traits18 = [
  trait('DA_18_Blossom', 'Blossom', [[3, 4, 1, { ADAP: 0.12 }], [5, 6, 3, { ADAP: 0.3 }], [7, 8, 5, { ADAP: 0.5 }]],
    'Blossom champions gain AD and AP.<row>(@MinUnits@) @ADAP*100@% AD/AP</row><row>(@MinUnits@) @ADAP*100@%</row><row>(@MinUnits@) @ADAP*100@%</row>'),
  trait('DA_18_Spellweaver', 'Spellweaver', [[2, 3, 1], [4, 5, 3], [6, 25000, 5]]),
  trait('DA_18_Adaptor', 'Adaptor', [[2, 2, 1], [3, 3, 3], [4, 25000, 5]]),
  trait('DA_18_Elderwood', 'Elderwood', [[3, 4, 1], [5, 6, 3]]),
  trait('DA_18_Defender', 'Defender', [[2, 3, 1], [4, 5, 3], [6, 25000, 5]]),
  trait('DA_18_Inferno', 'Inferno', [[2, 2, 1], [3, 4, 3]]),
  trait('DA_18_Slayer', 'Ravager', [[2, 3, 1, { Omnivamp: 0.1 }], [4, 5, 3], [6, 25000, 5]]),
  trait('DA_18_Blackthorn', 'Blackthorn', [[2, 3, 1], [4, 5, 3]]),
  trait('DA_18_Coven', 'Coven', [[3, 3, 1], [4, 4, 3]]),
  trait('DA_Riftbeast18', 'Riftbeast', [[3, 4, 1], [5, 6, 3]]),
  trait('DA_18_Summoner', 'Summoner', [[2, 2, 1], [3, 25000, 5]]),
  trait('DA_18_Rapidfire', 'Rapidfire', [[2, 2, 1], [3, 3, 3]]),
  trait('DA_18_ApexPredator', 'Apex Predator', [[1, 25000, 4]], 'Elder Dragon takes up 2 team slots.'),
  trait('DA_18_LuxUniqueTrait', 'Avatar', [[1, 25000, 4]]),
  trait('DA_18_Fae', 'Fae', [[2, 3, 1], [4, 25000, 5]]),
];

// ---- synthetic items ----
const comp = (apiName, name, effects) => ({ apiName, name, composition: [], desc: 'component', effects, icon: `assets/maps/tft/icons/items/${apiName.toLowerCase()}.tex`, isAugment: false });
const comps = [
  comp('TFT_Item_BFSword', 'B.F. Sword', { AD: 0.1 }),
  comp('TFT_Item_RecurveBow', 'Recurve Bow', { AS: 0.1 }),
  comp('TFT_Item_NeedlesslyLargeRod', 'Needlessly Large Rod', { AP: 10 }),
  comp('TFT_Item_TearOfTheGoddess', 'Tear of the Goddess', { Mana: 15 }),
  comp('TFT_Item_ChainVest', 'Chain Vest', { Armor: 20 }),
  comp('TFT_Item_NegatronCloak', 'Negatron Cloak', { MR: 20 }),
  comp('TFT_Item_GiantsBelt', "Giant's Belt", { Health: 150 }),
  comp('TFT_Item_SparringGloves', 'Sparring Gloves', { CritChance: 0.2 }),
  comp('TFT_Item_Spatula', 'Spatula', {}),
  comp('TFT_Item_FryingPan', 'Frying Pan', {}),
];
const B = (n) => `TFT_Item_${n}`;
const done = (apiName, name, a, b, effects, desc = '') => ({
  apiName: `TFT_Item_${apiName}`, name, composition: [B(a), B(b)], desc: desc || 'Gain @AD*100@% AD.', effects, icon: `assets/maps/tft/icons/items/${apiName.toLowerCase()}.tex`, isAugment: false,
});
const completed = [
  done('SyntheticEdge', 'Synthetic Edge', 'BFSword', 'SparringGloves', { AD: 0.35, CritChance: 0.35 }),
  done('SyntheticBlade', 'Synthetic Blade', 'BFSword', 'RecurveBow', { AD: 0.2, AS: 0.2 }),
  done('SyntheticRod', 'Synthetic Rod', 'NeedlesslyLargeRod', 'NeedlesslyLargeRod', { AP: 50 }),
  done('SyntheticBlue', 'Synthetic Blue', 'TearOfTheGoddess', 'NeedlesslyLargeRod', { AP: 20, Mana: 15 }),
  done('SyntheticWall', 'Synthetic Wall', 'ChainVest', 'GiantsBelt', { Armor: 20, Health: 200 }),
  done('SyntheticVeil', 'Synthetic Veil', 'NegatronCloak', 'GiantsBelt', { MR: 20, Health: 200 }),
  done('SyntheticBow', 'Synthetic Bow', 'RecurveBow', 'RecurveBow', { AS: 0.5 }),
  done('SyntheticTear', 'Synthetic Tear', 'TearOfTheGoddess', 'TearOfTheGoddess', { Mana: 30, ManaRegen: 2 }),
  done('SyntheticMix', 'Synthetic Mix', 'BFSword', 'NeedlesslyLargeRod', { AD: 0.18, AP: 18, DamageAmp: 0.05 }),
  done('SyntheticGuard', 'Synthetic Guard', 'ChainVest', 'NegatronCloak', { Armor: 20, MR: 20, Durability: 0.1 }),
  done('SyntheticGambit', 'Synthetic Gambit', 'SparringGloves', 'NegatronCloak', { MR: 20, CritChance: 0.2 }),
  done('RetiredThing', 'Retired Thing', 'ChainVest', 'ChainVest', { Armor: 50 }),
  done('SyntheticPlain', 'Synthetic Plain', 'GiantsBelt', 'GiantsBelt', {}, 'Does something conditional.'),
];
const noise = [
  { apiName: 'TFT_Item_SyntheticEmblem', name: 'Synthetic Emblem', composition: [B('Spatula'), B('BFSword')], desc: '', effects: {}, icon: 'x.tex', isAugment: false },
  { apiName: 'TFT_Item_Artifact_Synth', name: 'Synthetic Artifact', composition: [], desc: '', effects: { AD: 0.5 }, icon: 'x.tex', isAugment: false },
  { apiName: 'TFT5_Item_SyntheticRadiant', name: 'Radiant Synthetic', composition: [B('BFSword'), B('RecurveBow')], desc: '', effects: { AD: 0.9 }, icon: 'x.tex', isAugment: false },
  { apiName: 'TFT13_Augment_Test', name: 'Some Augment', composition: [], desc: '', effects: {}, icon: 'x.tex', isAugment: true },
];

const raw = {
  items: [...noise, ...comps, ...completed],
  // Like the real file, the 18 data is NOT filed under key "18" and its "name" is misleading.
  sets: {
    10: { name: 'Set10', champions: [...junk, ...set18], traits: traits18 },
    17: { name: 'Set17', champions: set17, traits: [] },
  },
};
await writeFile(resolve(here, 'fixture-raw.json'), JSON.stringify(raw));
console.log('wrote test/fixture-raw.json');
