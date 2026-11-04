// Stat math for the item lab. Pure functions, no DOM.
//
// Model (same rules the game uses, simplified where noted):
//  - Stars multiply base Health by 1.8 and base Attack Damage by 1.5 per star above 1.
//  - Item "Attack Damage" and "Attack Speed" are percentages of the unit's own base values.
//  - Ability Power starts at 100 and items add to it; ability damage scales with AP / 100.
//  - Mana: 10 per attack (units with 10 or less max mana count attacks instead).
//  - Crit chance is capped at 100%.
// Conditional item effects (stacking, triggers, shields…) are NOT modelled, only flat stats.

export const STAR_HP = 1.8;
export const STAR_AD = 1.5;
export const MANA_PER_ATTACK = 10;
export const FIGHT_SECONDS = 20;

export const MODES = {
  ad:       { label: 'AD carry',   short: 'AD',       auto: 0.80, spell: 0.20, dmg: 0.90, def: 0.10 },
  ap:       { label: 'AP caster',  short: 'AP',       auto: 0.15, spell: 0.85, dmg: 0.90, def: 0.10 },
  hybrid:   { label: 'Hybrid',     short: 'Hybrid',   auto: 0.50, spell: 0.50, dmg: 0.90, def: 0.10 },
  tank:     { label: 'Tank',       short: 'Tank',     auto: 0.40, spell: 0.60, dmg: 0.25, def: 0.75 },
  balanced: { label: 'Bruiser',    short: 'Bruiser',  auto: 0.50, spell: 0.50, dmg: 0.55, def: 0.45 },
};

const STAT_NAMES = ['ad', 'ap', 'as', 'armor', 'mr', 'hp', 'crit', 'critDmg', 'mana', 'manaRegen', 'amp', 'dur', 'omni', 'dodge', 'hpPct', 'shield'];

export function sumStats(items) {
  const t = Object.fromEntries(STAT_NAMES.map((k) => [k, 0]));
  for (const it of items) {
    if (!it || !it.stats) continue;
    for (const k of STAT_NAMES) t[k] += it.stats[k] || 0;
  }
  return t;
}

// `extra` holds bonuses that do not come from items (trait bonuses), same stat names as item stats.
export function computeStats(champ, star, items, extra) {
  const s = champ.stats;
  const b = sumStats(items);
  if (extra) for (const k of Object.keys(extra)) b[k] = (b[k] || 0) + extra[k];
  const ad0 = s.ad * Math.pow(STAR_AD, star - 1);

  const hp = s.hp * Math.pow(STAR_HP, star - 1) * (1 + b.hpPct) + b.hp;
  const ad = ad0 * (1 + b.ad);
  const as = s.as * (1 + b.as);
  const ap = 100 + b.ap;
  const armor = s.armor + b.armor;
  const mr = s.mr + b.mr;
  const crit = Math.min(1, s.crit + b.crit);
  const critMult = s.critMult + b.critDmg;
  const amp = b.amp;
  const dur = Math.min(0.9, b.dur);

  // Mana and casting
  const maxMana = s.mana;
  const startMana = Math.min(s.startMana + b.mana, maxMana);
  const byAttacks = maxMana > 0 && maxMana <= MANA_PER_ATTACK; // e.g. "every 3rd attack" abilities
  let casts = 0;
  let firstCast = null;
  if (maxMana > 0 && as > 0) {
    const rate = byAttacks ? as : MANA_PER_ATTACK * as + b.manaRegen; // mana (or attacks) per second
    const need = byAttacks ? maxMana : maxMana - startMana;
    const interval = byAttacks ? maxMana / as : maxMana / rate;
    if (rate > 0) {
      firstCast = Math.max(0, need / rate);
      casts = firstCast > FIGHT_SECONDS ? 0 : 1 + (FIGHT_SECONDS - firstCast) / interval;
    }
  }

  const ab = champ.ability || { adShare: 0, apShare: 1 };
  const scale = ab.adShare * (ad0 > 0 ? ad / ad0 : 1) + ab.apShare * (ap / 100);
  const spellIdx = casts * scale * (1 + amp);

  const autoDps = ad * as * (1 + crit * (critMult - 1)) * (1 + amp);
  const shield = 1 + b.shield; // a shield on max Health is extra effective Health
  const ehpP = (hp * shield * (1 + armor / 100)) / (1 - dur) / (1 - Math.min(0.9, b.dodge));
  const ehpM = (hp * shield * (1 + mr / 100)) / (1 - dur);

  return { hp, ad, as, ap, armor, mr, crit, critMult, amp, dur, omni: b.omni, dodge: b.dodge,
    maxMana, startMana, firstCast, casts, spellIdx, autoDps, ehpP, ehpM, range: s.range };
}

// 1.00 means "same as the unit with no items". 1.25 means 25% better under the chosen role.
export function scoreOf(stats, naked, modeKey) {
  const m = MODES[modeKey] || MODES.hybrid;
  const autoR = naked.autoDps > 0 ? stats.autoDps / naked.autoDps : 1;
  const hasSpell = naked.spellIdx > 0;
  const spellR = hasSpell ? stats.spellIdx / naked.spellIdx : autoR;
  const dmg = hasSpell ? m.auto * autoR + m.spell * spellR : autoR;
  const def = (stats.ehpP / naked.ehpP + stats.ehpM / naked.ehpM) / 2;
  return m.dmg * dmg + m.def * def;
}

export function guessMode(champ) {
  const { stats: s, ability: a } = champ;
  const attackerness = s.hp > 0 ? (s.ad * s.as) / s.hp : 0;
  if (s.range <= 2 && /shield|durability|damage reduction|resist/i.test(a.desc || '') && attackerness < 0.04) return 'tank';
  if (a.apShare >= 0.6) return 'ap';
  if (a.adShare >= 0.6) return 'ad';
  return 'hybrid';
}

export function bestBuilds(champ, star, modeKey, pool, size = 3, keep = 6, extra) {
  const items = pool.filter((i) => Object.keys(i.stats || {}).length > 0);
  const naked = computeStats(champ, star, [], extra);
  const top = [];
  const push = (combo) => {
    const st = computeStats(champ, star, combo, extra);
    const sc = scoreOf(st, naked, modeKey);
    if (top.length < keep || sc > top[top.length - 1].score) {
      top.push({ items: combo, stats: st, score: sc });
      top.sort((a, b) => b.score - a.score);
      if (top.length > keep) top.pop();
    }
  };
  const n = items.length;
  if (size >= 3) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) push([items[i], items[j], items[k]]);
  } else if (size === 2) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) push([items[i], items[j]]);
  } else {
    for (let i = 0; i < n; i++) push([items[i]]);
  }
  return top;
}
