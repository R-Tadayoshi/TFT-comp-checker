// Applies the stat bonuses of active traits to every unit on the board.
// The rules live in config/traits.json (which variable of a trait means which stat, and who gets it).
// Pure functions, no DOM.

import { neighbors } from './board.js';

const lc = (s) => String(s).toLowerCase();

// Variable names the rules refer to, so the data build can decode their hashed keys.
export function ruleVarNames(rules) {
  const out = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (typeof x.var === 'string') out.add(x.var);
      if (typeof x.timesVar === 'string') out.add(x.timesVar);
      Object.values(x).forEach(walk);
    }
  };
  for (const [k, v] of Object.entries(rules || {})) if (k[0] !== '_') walk(v);
  return [...out];
}

function term(t, vars) {
  if (typeof t === 'number') return t;
  if (!t || typeof t.var !== 'string') return null;
  let v = vars[lc(t.var)];
  if (typeof v !== 'number') return null;
  v *= t.scale ?? 1;
  v *= t.times ?? 1;
  if (t.timesVar) {
    const m = vars[lc(t.timesVar)];
    if (typeof m !== 'number') return null;
    v *= 1 + m;
  }
  return v;
}

function value(spec, vars) {
  let sum = 0;
  for (const t of Array.isArray(spec) ? spec : [spec]) {
    const v = term(t, vars);
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

// spec: { statName: term | [term, …] }. "adap" means: AD% for attack-scaling units, AP for spell-scaling ones.
export function evalSpec(spec, vars, champ) {
  const stats = {};
  const missing = [];
  for (const [k, s] of Object.entries(spec)) {
    const v = value(s, vars);
    if (v == null) { missing.push(k); continue; }
    if (!v) continue;
    if (k === 'adap') {
      const ab = champ.ability || { adShare: 0, apShare: 1 };
      if (ab.adShare >= ab.apShare) stats.ad = (stats.ad || 0) + v;
      else stats.ap = (stats.ap || 0) + v * 100;
    } else {
      stats[k] = (stats[k] || 0) + v;
    }
  }
  return { stats, missing };
}

function varsAtTier(tiers, idx) {
  const out = {};
  for (let i = 0; i <= idx; i++) for (const [k, v] of Object.entries(tiers[i].vars || {})) out[lc(k)] = v;
  return out;
}

const baseName = (name) => name.replace(/\s*\(.*\)$/, '');

/**
 * team:   array of { id, pos, … } units on the board
 * champ:  id → champion      trait: name → trait      rules: config/traits.json
 * Returns { byUnit: Map(unit → { stats, notes[] }), active: [{ name, count, tier }], uncounted: [{ name, count, reason }] }
 */
export function applyTraits({ team, champ, trait, rules }) {
  const byUnit = new Map(team.map((u) => [u, { stats: {}, notes: [] }]));
  const members = new Map();
  for (const u of team) {
    for (const t of champ[u.id].traits) {
      if (!members.has(t)) members.set(t, []);
      members.get(t).push(u);
    }
  }
  const active = [];
  const uncounted = [];

  for (const [name, list] of members) {
    const t = trait[name];
    if (!t || !t.tiers.length) continue;
    const count = new Set(list.map((u) => baseName(champ[u.id].name))).size;
    let idx = -1;
    t.tiers.forEach((tier, i) => { if (count >= tier.min) idx = i; });
    if (idx < 0) continue;
    active.push({ name, count, tier: t.tiers[idx] });

    const rule = rules && rules[name];
    if (!rule) { uncounted.push({ name, count, reason: 'no stat rule' }); continue; }

    const vars = varsAtTier(t.tiers, idx);
    const memberSet = new Set(list);
    let adjacent = new Set();
    if (rule.adjacent) {
      const spots = new Set();
      for (const m of list) if (m.pos != null) for (const n of neighbors(m.pos)) spots.add(n);
      adjacent = new Set(team.filter((u) => !memberSet.has(u) && spots.has(u.pos)));
    }

    let anyMissing = false;
    let anyApplied = false;
    for (const u of team) {
      let spec = null;
      if (memberSet.has(u)) spec = rule.members || rule.team || null;
      else if (rule.team) spec = rule.team;
      else if (adjacent.has(u)) spec = rule.adjacent;
      if (!spec) continue;
      const { stats, missing } = evalSpec(spec, vars, champ[u.id]);
      if (missing.length) anyMissing = true;
      const slot = byUnit.get(u);
      for (const [k, v] of Object.entries(stats)) slot.stats[k] = (slot.stats[k] || 0) + v;
      if (Object.keys(stats).length) {
        anyApplied = true;
        slot.notes.push({ trait: name, count, stats, adjacent: adjacent.has(u) });
      }
    }
    if (!anyApplied) uncounted.push({ name, count, reason: anyMissing ? 'variables not found in the data' : 'no stat at this tier' });
  }

  active.sort((a, b) => (b.tier.style || 0) - (a.tier.style || 0) || b.count - a.count || a.name.localeCompare(b.name));
  return { byUnit, active, uncounted };
}
