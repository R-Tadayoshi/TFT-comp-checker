// Turns the raw CommunityDragon TFT dump into the small dataset the site uses.
// Shared by the browser (live fallback) and scripts/build-data.mjs. No DOM, no imports.

export const CDN = 'https://raw.communitydragon.org/latest/game/';
export const RAW_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
export const SET_NAMES = { 17: 'Space Gods', 18: 'Enchanted Wilds' };

export function assetUrl(path) {
  if (!path || typeof path !== 'string' || path[0] === '{' || path === 'None') return null;
  return CDN + path.toLowerCase().replace(/\.(tex|dds)$/, '.png');
}

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

/* ---------- hashed variable names ---------- */

// Riot stores many variables as "{8c16b281}": the FNV-1a hash of the lowercase variable name.
// Names that appear in descriptions (or in config/traits.json) can be mapped back.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str).toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function nameVars(vars, text, extraNames = []) {
  const out = { ...(vars || {}) };
  const have = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  const names = new Set(extraNames);
  for (const m of String(text || '').matchAll(/@([A-Za-z0-9_]+?)(?:\*100)?@/g)) names.add(m[1]);
  for (const n of names) {
    if (have.has(n.toLowerCase())) continue;
    const key = '{' + fnv1a(n) + '}';
    if (key in out) { out[n] = out[key]; have.add(n.toLowerCase()); }
  }
  return out;
}

/* ---------- text cleanup ---------- */

const SCALE_LABEL = {
  AD: 'AD', AP: 'AP', AS: 'AS', Health: 'Health', Armor: 'Armor', MR: 'MR',
  ManaRegen: 'Mana Regen', DR: 'Durability',
};

function resolveVars(str, vars) {
  const lower = {};
  for (const k of Object.keys(vars || {})) lower[k.toLowerCase()] = vars[k];
  return str.replace(/@([A-Za-z0-9_:.{}]+?)(\*100)?@/g, (m, key, pct) => {
    const v = lower[key.toLowerCase()];
    if (typeof v !== 'number') return m;
    return String(round(pct ? v * 100 : v, 1));
  });
}

export function cleanText(s, vars) {
  if (typeof s !== 'string') return '';
  let t = s.replace(/\\r|\\n|\r|\n/g, ' ').replace(/<br\s*\/?>/gi, ' ');
  if (vars) t = resolveVars(t, vars);
  t = t.replace(/%i:scale(\w+)%/g, (m, k) => ' ' + (SCALE_LABEL[k] || k) + ' ');
  t = t.replace(/@[^@]*@/g, '…');
  t = t.replace(/<[^>]+>/g, '');
  return t.replace(/\s+/g, ' ').replace(/\s+([.,;:)%])/g, '$1').trim();
}

/* ---------- picking the current set ---------- */

function listSets(raw) {
  if (raw.sets && !Array.isArray(raw.sets)) {
    return Object.entries(raw.sets).map(([key, v]) => ({ key, ...v }));
  }
  if (Array.isArray(raw.setData)) {
    return raw.setData.map((v) => ({ key: String(v.number ?? v.mutator ?? ''), ...v }));
  }
  return [];
}

function isPlayable(c) {
  return (
    c && c.name && c.apiName &&
    Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= 5 &&
    Array.isArray(c.traits) && c.traits.length > 0 &&
    c.stats && num(c.stats.hp) > 10
  );
}

function setNumberOfChampion(c) {
  const s = [c.squareIcon, c.tileIcon, c.icon, c.apiName, c.characterName]
    .filter((x) => typeof x === 'string').join(' ');
  const m = s.match(/tft(\d+)_/i) || s.match(/DA_(\d+)_/) || s.match(/[A-Za-z](\d{2})(?:_|\b)/);
  return m ? Number(m[1]) : null;
}

// The "name" field on a set entry is unreliable in the raw file, so the set number is
// taken from the asset paths of its champions (most common number wins).
function dominantSetNumber(champs) {
  const counts = new Map();
  for (const c of champs) {
    const n = setNumberOfChampion(c);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  let best = null;
  for (const [n, k] of counts) if (!best || k > best.k) best = { n, k };
  return best ? best.n : null;
}

export function pickSet(raw, wanted) {
  const cands = [];
  for (const s of listSets(raw)) {
    const champs = (s.champions || []).filter(isPlayable);
    if (champs.length < 8) continue;
    cands.push({ set: s, champs, number: dominantSetNumber(champs) });
  }
  if (!cands.length) throw new Error('No playable champions found in the data file.');
  if (wanted) {
    const hit = cands.find((c) => c.number === Number(wanted));
    if (!hit) throw new Error(`Set ${wanted} is not in the data file.`);
    return hit;
  }
  cands.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  return cands[0];
}

/* ---------- item stats ---------- */

const STAT_KEYS = {
  ad: ['ad', 'bonusad', 'attackdamage'],
  ap: ['ap', 'bonusap', 'abilitypower'],
  as: ['as', 'bonusas', 'attackspeed'],
  armor: ['armor', 'bonusarmor'],
  mr: ['mr', 'magicresist', 'bonusmr'],
  hp: ['health', 'hp', 'bonushealth', 'maxhealth', 'bonushp'],
  crit: ['critchance', 'critstrikechance', 'criticalstrikechance'],
  critDmg: ['critdamage', 'critdamagetogive', 'bonuscritdamage'],
  mana: ['mana', 'startingmana', 'initialmana', 'bonusmana', 'flatmana'],
  manaRegen: ['manaregen', 'manapersecond', 'manaregenpersecond'],
  amp: ['damageamp', 'damageamplification', 'bonusdamageamp'],
  dur: ['durability'],
  omni: ['omnivamp'],
  dodge: ['dodgechance', 'dodge'],
};
const FRACTION = new Set(['ad', 'as', 'crit', 'critDmg', 'amp', 'dur', 'omni', 'dodge']);

export function itemStats(effects) {
  const out = {};
  if (!effects) return out;
  const norm = {};
  for (const [k, v] of Object.entries(effects)) {
    if (typeof v === 'number') norm[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v;
  }
  for (const [stat, names] of Object.entries(STAT_KEYS)) {
    for (const n of names) {
      if (!(n in norm)) continue;
      let v = norm[n];
      if (FRACTION.has(stat) && Math.abs(v) > 3) v /= 100; // some builds store percents as 20 instead of 0.2
      if (stat === 'ap' && v !== 0 && Math.abs(v) <= 1) v *= 100;
      out[stat] = round(v, 4);
      break;
    }
  }
  return out;
}

/* ---------- items ---------- */

const NOT_STANDARD = /Emblem|Artifact|Radiant|Consumable|Anvil|Forge|Reforger|Remover|Ornn|Tome|Tactician|Augment/i;
const SPECIAL_COMPONENT = /Spatula|FryingPan|Frying/i;

function buildItems(raw, opts) {
  const all = (raw.items || []).filter((i) => i && i.apiName && i.name && !i.isAugment);
  const byId = new Map(all.map((i) => [i.apiName, i]));
  const recipe = (i) => (Array.isArray(i.composition) ? i.composition : []);

  // A "standard component" is a recipe-less item used in many ordinary two-part recipes.
  const usage = new Map();
  for (const i of all) {
    if (recipe(i).length !== 2 || NOT_STANDARD.test(i.apiName + ' ' + i.name)) continue;
    for (const id of recipe(i)) usage.set(id, (usage.get(id) || 0) + 1);
  }
  const compIds = new Set();
  for (const [id, n] of usage) {
    const c = byId.get(id);
    if (c && recipe(c).length === 0 && n >= 2 && !SPECIAL_COMPONENT.test(id)) compIds.add(id);
  }

  const exclude = new Set((opts.excludeItems || []).map((s) => s.toLowerCase()));
  const include = new Set((opts.includeItems || []).map((s) => s.toLowerCase()));
  const listed = (i, set) => set.has(i.apiName.toLowerCase()) || set.has(i.name.toLowerCase());

  const setOf = (id) => { const m = id.match(/^TFT(\d+)_/i); return m ? Number(m[1]) : 0; };
  const byName = new Map();
  for (const i of all) {
    const r = recipe(i);
    const standard =
      r.length === 2 && r.every((id) => compIds.has(id)) && !NOT_STANDARD.test(i.apiName + ' ' + i.name);
    if (!(standard || listed(i, include)) || listed(i, exclude)) continue;
    const prev = byName.get(i.name);
    if (!prev || setOf(i.apiName) > setOf(prev.apiName)) byName.set(i.name, i);
  }

  const slimItem = (i) => {
    const eff = nameVars(i.effects, i.desc);
    return { id: i.apiName, name: i.name, icon: assetUrl(i.icon), components: recipe(i), stats: itemStats(eff), desc: cleanText(i.desc, eff) };
  };

  const items = [...byName.values()].map(slimItem).sort((a, b) => a.name.localeCompare(b.name));
  const components = [...compIds]
    .map((id) => byId.get(id))
    .map((c) => ({ id: c.apiName, name: c.name, icon: assetUrl(c.icon), stats: itemStats(nameVars(c.effects, c.desc)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items, components };
}

/* ---------- traits ---------- */

function buildTraits(setTraits, usedNames, varNames = []) {
  const out = [];
  for (const t of setTraits || []) {
    if (!usedNames.has(t.name)) continue;
    const effects = (t.effects || [])
      .map((e) => ({ min: e.minUnits == null ? 1 : e.minUnits, max: e.maxUnits, style: e.style, vars: nameVars(e.variables, t.desc, varNames) }))
      .sort((a, b) => a.min - b.min);
    // Rewrite "<row>(@MinUnits@) …</row>" rows with each tier's own numbers.
    let i = 0;
    let desc = String(t.desc || '').replace(/<row>([\s\S]*?)<\/row>/gi, (m, inner) => {
      const tier = effects[i++];
      if (!tier) return ' ' + inner;
      const body = resolveVars(inner.replace(/@MinUnits@/g, String(tier.min)), tier.vars);
      return ' • ' + body + ' ';
    });
    desc = cleanText(desc, effects.length === 1 ? effects[0].vars : null);
    out.push({
      id: t.apiName,
      name: t.name,
      icon: assetUrl(t.icon),
      desc,
      tiers: effects.map((e) => ({
        min: e.min,
        style: e.style,
        // keep only named numeric variables (unresolved {hash} keys are useless to the site)
        vars: Object.fromEntries(Object.entries(e.vars).filter(([k, v]) => k[0] !== '{' && typeof v === 'number')),
      })),
    });
  }
  return out;
}

/* ---------- main entry ---------- */

export function buildDataset(raw, opts = {}) {
  const { set, champs, number } = pickSet(raw, opts.set);

  const seen = new Set();
  const champions = [];
  for (const c of champs) {
    if (seen.has(c.apiName)) continue;
    seen.add(c.apiName);
    const st = c.stats;
    const desc = (c.ability && c.ability.desc) || '';
    const nAD = (desc.match(/scaleAD/g) || []).length;
    const nAP = (desc.match(/scaleAP/g) || []).length;
    const total = nAD + nAP;
    champions.push({
      id: c.apiName,
      name: c.name,
      cost: c.cost,
      traits: c.traits,
      icon: assetUrl(c.squareIcon) || assetUrl(c.tileIcon) || assetUrl(c.icon),
      stats: {
        hp: num(st.hp), armor: num(st.armor), mr: num(st.magicResist),
        ad: num(st.damage), as: num(st.attackSpeed),
        crit: num(st.critChance, 0.25), critMult: num(st.critMultiplier, 1.4) || 1.4,
        mana: num(st.mana), startMana: num(st.initialMana), range: num(st.range, 1),
      },
      ability: {
        name: (c.ability && c.ability.name) || '',
        desc: cleanText(desc),
        adShare: total ? nAD / total : 0,
        apShare: total ? nAP / total : 1,
      },
    });
  }
  champions.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

  const usedTraits = new Set(champions.flatMap((c) => c.traits));
  const traits = buildTraits(set.traits, usedTraits, opts.varNames || []);
  const { items, components } = buildItems(raw, opts);

  return {
    meta: {
      set: number,
      setName: SET_NAMES[number] || '',
      generatedAt: new Date().toISOString(),
      source: RAW_URL,
      counts: { champions: champions.length, traits: traits.length, items: items.length },
    },
    champions,
    traits,
    components,
    items,
  };
}
