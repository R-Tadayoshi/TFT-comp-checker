import { loadData } from './loader.js';
import { computeStats, scoreOf, guessMode, bestBuilds, MODES } from './engine.js';
import { applyTraits } from './traits.js';
import { ROWS as BROWS, COLS, SIZE, firstFree } from './board.js';

/* ───────────── tiny DOM helpers ───────────── */

const $ = (s, r = document) => r.querySelector(s);

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

const f0 = (v) => Math.round(v).toLocaleString('en-US');
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-US');
const f2 = (v) => v.toFixed(2);
const pct = (v, d = 0) => (v * 100).toFixed(d) + '%';
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
const signed = (v, fmt) => sign(v) + fmt(Math.abs(v));

function pic(url, label, size = 44, cls = '') {
  const w = h('span', { class: ('pic ' + cls).trim(), '--s': size + 'px' });
  const fallback = () => {
    w.classList.add('noimg');
    w.replaceChildren(String(label).replace(/\(.*\)/, '').trim().slice(0, 2));
  };
  if (!url) { fallback(); return w; }
  const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', fallback);
  w.append(img);
  return w;
}

// A focusable div that acts like a button (draggable buttons do not drag in Firefox).
function press(el, fn) {
  el.addEventListener('click', fn);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } });
  return el;
}

/* ───────────── state ───────────── */

const MAX_ITEMS = 3;
const KEY = 'tft-comp-lab:v1';

const S = {
  data: null, champ: {}, item: {}, trait: {}, comp: {},
  team: [], cap: 9,
  ref: null,                 // unit shown in the item lab: { id, star, items[], mode? }
  edit: 'A', slot: 0, B: [], compare: false,
  sort: 'score', itemQ: '', itemComp: '', showAll: false,
  filters: { q: '', cost: 0, trait: '' },
  builds: null, computing: false,
  rules: {}, tinfo: null, traitsOn: true,
};
let dragging = null; // { kind: 'pool' | 'unit', id }

/* ───────────── persistence & share link ───────────── */

function encodeHash() {
  const c = S.team
    .map((u) => [u.id, u.star, u.items.join('+'), u.mode || '', u.pos ?? ''].map(encodeURIComponent).join('~'))
    .join(',');
  return `n=${S.cap}&c=${c}`;
}

function decodeHash(hash) {
  const out = { cap: null, team: [] };
  for (const part of hash.replace(/^#/, '').split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i), v = part.slice(i + 1);
    if (k === 'n') out.cap = Number(v) || null;
    if (k === 'c' && v) {
      for (const unit of v.split(',')) {
        const [id, star, items, mode, pos] = unit.split('~').map((s) => decodeURIComponent(s || ''));
        out.team.push({ id, star: Number(star) || 2, items: items ? items.split('+') : [], mode: mode || undefined, pos: pos === '' || pos == null ? undefined : Number(pos) });
      }
    }
  }
  return out;
}

function cleanTeam(list) {
  const seen = new Set();
  const out = [];
  for (const u of list) {
    if (!S.champ[u.id] || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push({
      id: u.id,
      star: Math.min(3, Math.max(1, u.star | 0 || 2)),
      items: (u.items || []).filter((id) => S.item[id]).filter((id, i, a) => a.indexOf(id) === i).slice(0, MAX_ITEMS),
      mode: MODES[u.mode] ? u.mode : undefined,
      pos: Number.isInteger(u.pos) && u.pos >= 0 && u.pos < SIZE ? u.pos : undefined,
    });
  }
  // keep valid, unique hexes; everyone else goes to the first free hex
  const taken = new Set();
  for (const u of out) { if (u.pos != null && !taken.has(u.pos)) taken.add(u.pos); else u.pos = undefined; }
  for (const u of out) if (u.pos == null) { u.pos = firstFree(taken); taken.add(u.pos); }
  return out;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ set: S.data.meta.set, cap: S.cap, team: S.team, traitsOn: S.traitsOn }));
  } catch { /* private mode: fine */ }
  history.replaceState(null, '', '#' + encodeHash());
}

function restore() {
  try { const pref = JSON.parse(localStorage.getItem(KEY) || 'null'); if (pref && pref.traitsOn === false) S.traitsOn = false; } catch { /* ignore */ }
  const fromHash = decodeHash(location.hash);
  if (fromHash.team.length) {
    S.team = cleanTeam(fromHash.team);
    if (fromHash.cap) S.cap = fromHash.cap;
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && saved.set === S.data.meta.set) {
        S.team = cleanTeam(saved.team || []);
        if (saved.cap) S.cap = saved.cap;
      }
    } catch { /* ignore */ }
  }
  S.cap = Math.min(12, Math.max(1, S.cap));
  if (S.team.length > S.cap) S.cap = Math.min(12, S.team.length);
}

/* ───────────── actions ───────────── */

let toastTimer;
function flash(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function inspect(ref) {
  S.ref = ref;
  S.edit = 'A';
  S.slot = Math.min(ref.items.length, MAX_ITEMS - 1);
  S.B = [];
  S.builds = null;
  render();
}

function usedPositions() { return new Set(S.team.map((u) => u.pos)); }

// Put a unit on a hex; whoever stands there swaps to the hex it leaves.
function place(u, pos) {
  const other = S.team.find((x) => x !== u && x.pos === pos);
  if (other) other.pos = u.pos;
  u.pos = pos;
}

function moveUnit(u, pos) {
  if (u.pos === pos) return;
  place(u, pos);
  persist();
  render();
}

function addUnit(id, pos) {
  const existing = S.team.find((u) => u.id === id);
  if (existing) { if (pos != null) { place(existing, pos); persist(); } return inspect(existing); }
  if (S.team.length >= S.cap) return flash(`Team is full (${S.cap}). Raise the team size or remove a unit.`);
  const u = { id, star: 2, items: [] };
  if (pos != null) {
    const other = S.team.find((x) => x.pos === pos);
    if (other) other.pos = firstFree(new Set([...usedPositions(), pos]));
    u.pos = pos;
  } else {
    u.pos = firstFree(usedPositions());
  }
  S.team.push(u);
  persist();
  inspect(u);
}

function removeUnit(u) {
  S.team = S.team.filter((x) => x !== u);
  if (S.ref === u) S.ref = { id: u.id, star: u.star, items: [...u.items], mode: u.mode };
  persist();
  render();
}

function currentArr() { return S.edit === 'A' ? S.ref.items : S.B; }

function equip(id) {
  const arr = currentArr();
  S.slot = Math.min(S.slot, arr.length);
  if (arr[S.slot] === id) {
    arr.splice(S.slot, 1);
  } else if (arr.includes(id)) {
    return flash('That item is already on this unit.');
  } else if (S.slot >= arr.length) {
    arr.push(id);
  } else {
    arr[S.slot] = id;
  }
  S.slot = Math.min(arr.length, MAX_ITEMS - 1);
  if (S.edit === 'A') persist();
  render();
}

function setBuild(which, ids) {
  const arr = which === 'A' ? S.ref.items : S.B;
  arr.length = 0;
  arr.push(...ids.slice(0, MAX_ITEMS));
  S.edit = which;
  S.slot = Math.min(arr.length, MAX_ITEMS - 1);
  if (which === 'A') persist();
  render();
}

/* ───────────── pool ───────────── */

function renderPool() {
  const { q, cost, trait } = S.filters;
  const needle = q.trim().toLowerCase();
  const inTeam = new Set(S.team.map((u) => u.id));
  const list = S.data.champions.filter(
    (c) =>
      (!cost || c.cost === cost) &&
      (!trait || c.traits.includes(trait)) &&
      (!needle || c.name.toLowerCase().includes(needle) || c.traits.some((t) => t.toLowerCase().includes(needle))),
  );
  const grid = $('#pool-grid');
  grid.replaceChildren(
    ...list.map((c) =>
      press(h('div', {
        class: `tile c${c.cost}` + (inTeam.has(c.id) ? ' in' : ''),
        role: 'button', tabindex: '0', draggable: 'true',
        title: `${c.name} · ${c.cost}-cost · ${c.traits.join(', ')}`,
        'aria-label': `${inTeam.has(c.id) ? 'Select' : 'Add'} ${c.name}, ${c.cost}-cost`,
        'data-fk': 'pool:' + c.id,
        ondragstart: (e) => startDrag(e, { kind: 'pool', id: c.id }),
        ondragend: endDrag,
      }, pic(c.icon, c.name, 52), h('span', { class: 'tn', text: c.name })), () => addUnit(c.id)),
    ),
  );
  if (!list.length) grid.append(h('p', { class: 'muted', text: 'No champion matches that search.' }));
}

/* ───────────── team & traits ───────────── */

function startDrag(e, d) {
  dragging = d;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', d.kind + ':' + d.id); } catch { /* ignore */ }
  document.body.classList.add('dragging');
}
function endDrag() {
  dragging = null;
  document.body.classList.remove('dragging');
  document.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
}

function dropOn(pos) {
  const d = dragging;
  endDrag();
  if (!d) return;
  if (d.kind === 'pool') addUnit(d.id, pos);
  else { const u = S.team.find((x) => x.id === d.id); if (u) moveUnit(u, pos); }
}

const ARROWS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };

function portrait(c) {
  const img = h('img', { src: c.icon || '', alt: '', draggable: 'false', decoding: 'async' });
  const wrap = h('span', { class: 'hpic' }, img);
  const fb = () => { wrap.classList.add('noimg'); wrap.replaceChildren(c.name.replace(/\(.*\)/, '').trim().slice(0, 2)); };
  if (!c.icon) fb(); else img.addEventListener('error', fb);
  return wrap;
}

function hexCell(pos, u) {
  const over = (e) => { if (!dragging) return; e.preventDefault(); e.currentTarget.classList.add('over'); };
  const leave = (e) => e.currentTarget.classList.remove('over');
  const drop = (e) => { e.preventDefault(); dropOn(pos); };
  if (!u) {
    return h('div', {
      class: 'hcell empty', 'data-pos': String(pos),
      onclick: () => { if (S.team.includes(S.ref)) moveUnit(S.ref, pos); },
      ondragover: over, ondragleave: leave, ondrop: drop,
    }, h('span', { class: 'hring' }), h('span', { class: 'hin' }));
  }
  const c = S.champ[u.id];
  const sel = S.ref === u;
  const nextStar = () => { u.star = (u.star % 3) + 1; S.builds = null; persist(); render(); };
  const main = press(h('div', {
    class: 'hin', role: 'button', tabindex: '0', 'aria-pressed': String(sel), 'data-fk': 'unit:' + u.id,
    title: `${c.name} · ${c.traits.join(', ')}`,
    'aria-label': `${c.name}, ${u.star} star. Select it to try items. Arrow keys move it on the board.`,
  }, portrait(c), h('span', { class: 'hname', text: c.name.replace(/\s*\(.*\)$/, '') })), () => inspect(u));
  main.addEventListener('keydown', (e) => {
    const d = ARROWS[e.key];
    if (d == null) return;
    const to = pos + d;
    if (to < 0 || to >= SIZE || (Math.abs(d) === 1 && Math.floor(to / COLS) !== Math.floor(pos / COLS))) return;
    e.preventDefault();
    moveUnit(u, to);
  });
  const items = u.items.map((id) => S.item[id]).filter(Boolean);
  return h('div', {
    class: `hcell has c${c.cost}` + (sel ? ' sel' : ''), 'data-pos': String(pos), draggable: 'true',
    ondragstart: (e) => { startDrag(e, { kind: 'unit', id: u.id }); e.currentTarget.classList.add('lift'); },
    ondragend: endDrag, ondragover: over, ondragleave: leave, ondrop: drop,
  },
    h('span', { class: 'hring' }),
    main,
    h('button', { class: 'hstar', type: 'button', 'aria-label': `${c.name}: ${u.star} star. Click to change.`, onclick: (e) => { e.stopPropagation(); nextStar(); }, text: '★'.repeat(u.star) }),
    items.length ? h('span', { class: 'hitems' }, items.map((it) => h('span', { class: 'hi', title: it.name }, h('img', { src: it.icon || '', alt: it.name, draggable: 'false' })))) : null,
    h('button', { class: 'hx', type: 'button', 'aria-label': `Remove ${c.name}`, onclick: (e) => { e.stopPropagation(); removeUnit(u); }, text: '×' }),
  );
}

function renderTeam() {
  const box = $('#team');
  const byPos = new Map(S.team.map((u) => [u.pos, u]));
  const rows = [];
  for (let r = 0; r < BROWS; r++) {
    const cells = [];
    for (let col = 0; col < COLS; col++) cells.push(hexCell(r * COLS + col, byPos.get(r * COLS + col)));
    rows.push(h('div', { class: 'brow' + (r % 2 ? ' odd' : '') }, cells));
  }
  box.replaceChildren(
    h('div', { class: 'board-wrap' }, h('div', { class: 'board', role: 'group', 'aria-label': 'Board: 4 rows of 7 hexes' }, rows)),
    h('p', { class: 'muted small board-hint', text: S.team.length
      ? 'Drag units to place them (drag onto the champion list to remove). Or select a unit and click an empty hex. Arrow keys move the focused unit. Click the stars to change star level.'
      : 'Click or drag champions from the list onto the board. Click a unit to try items on it.' }),
  );
}

function traitCounts() {
  const seen = new Map();
  for (const u of S.team) {
    const c = S.champ[u.id];
    const base = c.name.replace(/\s*\(.*\)$/, '');
    for (const t of c.traits) {
      if (!seen.has(t)) seen.set(t, new Set());
      seen.get(t).add(base);
    }
  }
  return [...seen].map(([name, set]) => ({ name, count: set.size }));
}

function renderTraits() {
  const box = $('#traits');
  box.replaceChildren();
  $('#cap').value = String(S.cap);
  if (!S.team.length) { box.append(h('span', { class: 'muted', text: 'Active traits will show up here.' })); return; }
  const rows = traitCounts().map(({ name, count }) => {
    const t = S.trait[name] || { name, tiers: [], desc: '' };
    let active = null, next = null;
    for (const tier of t.tiers) { if (count >= tier.min) active = tier; else if (!next) next = tier; }
    return { t, count, active, next };
  });
  const notCounted = new Set(S.tinfo ? S.tinfo.uncounted.map((x) => x.name) : []);
  rows.sort((a, b) => (b.active ? b.active.style : 0) - (a.active ? a.active.style : 0) || b.count - a.count || a.t.name.localeCompare(b.t.name));
  for (const { t, count, active, next } of rows) {
    box.append(
      h('span', { class: 'trait ' + (active ? 's' + active.style : 'off') + (active && notCounted.has(t.name) ? ' nostat' : ''), title: `${t.name}\n${t.desc || ''}`.trim() + (active && notCounted.has(t.name) ? '\n\n(Its stat bonus is not counted in the numbers.)' : '') },
        pic(t.icon, t.name, 22, 'ti'),
        h('b', { text: count }),
        h('span', { text: t.name }),
        next ? h('i', { text: '/' + next.min }) : null),
    );
  }
  if (S.traitsOn && notCounted.size) {
    box.append(h('p', { class: 'muted small trait-note', text: `Active, but their bonus is not counted in the numbers: ${[...notCounted].join(', ')}.` }));
  }
}

/* ───────────── item lab ───────────── */

const STAT_LABEL = {
  ad: (v) => `${signed(v, (x) => pct(x))} AD`,
  ap: (v) => `${signed(v, f0)} AP`,
  as: (v) => `${signed(v, (x) => pct(x))} AS`,
  armor: (v) => `${signed(v, f0)} Armor`,
  mr: (v) => `${signed(v, f0)} MR`,
  hp: (v) => `${signed(v, f0)} HP`,
  crit: (v) => `${signed(v, (x) => pct(x))} Crit`,
  critDmg: (v) => `${signed(v, (x) => pct(x))} Crit dmg`,
  mana: (v) => `${signed(v, f0)} Mana`,
  manaRegen: (v) => `${signed(v, f1)} Mana/s`,
  amp: (v) => `${signed(v, (x) => pct(x))} Dmg amp`,
  dur: (v) => `${signed(v, (x) => pct(x))} Durability`,
  omni: (v) => `${signed(v, (x) => pct(x))} Omnivamp`,
  dodge: (v) => `${signed(v, (x) => pct(x))} Dodge`,
  hpPct: (v) => `${signed(v, (x) => pct(x))} base HP`,
  shield: (v) => `${signed(v, (x) => pct(x))} HP as shield`,
};

function statChips(it) {
  const keys = Object.keys(it.stats).filter((k) => STAT_LABEL[k] && it.stats[k]);
  if (!keys.length) return [h('span', { class: 'chip faint', text: 'effect only' })];
  return keys.map((k) => h('span', { class: 'chip', text: STAT_LABEL[k](it.stats[k]) }));
}

const ROWS = [
  { k: 'hp', label: 'Health', fmt: f0 },
  { k: 'armor', label: 'Armor', fmt: f0 },
  { k: 'mr', label: 'Magic resist', fmt: f0 },
  { k: 'ad', label: 'Attack damage', fmt: f1 },
  { k: 'as', label: 'Attack speed', fmt: f2 },
  { k: 'crit', label: 'Crit chance', fmt: (v) => pct(v) },
  { k: 'critMult', label: 'Crit damage', fmt: (v) => '×' + f2(v), dfmt: f2 },
  { k: 'ap', label: 'Ability power', fmt: f0 },
  { k: 'startMana', label: 'Starting mana', fmt: f0 },
  { k: 'firstCast', label: 'First cast', fmt: (v) => (v == null ? '—' : f1(v) + ' s'), dfmt: (v) => f1(v) + ' s', lower: true },
  { k: 'casts', label: 'Casts in 20 s', fmt: f1 },
  { k: 'autoDps', label: 'Auto-attack damage per second', short: 'Auto DPS', fmt: f0, rel: true },
  { k: 'spellRel', label: 'Ability output', fmt: (v) => '×' + f2(v), rel: true },
  { k: 'ehpP', label: 'Effective HP vs physical', short: 'Eff. HP (phys)', fmt: f0, rel: true },
  { k: 'ehpM', label: 'Effective HP vs magic', short: 'Eff. HP (magic)', fmt: f0, rel: true },
];

function withExtras(stats, naked) {
  return { ...stats, spellRel: naked.spellIdx > 0 ? stats.spellIdx / naked.spellIdx : null };
}

function cell(row, v, base, isBase) {
  if (v == null) return h('td', { class: 'num' }, h('span', { class: 'v', text: '—' }));
  const kids = [h('span', { class: 'v', text: row.fmt(v) })];
  if (!isBase && base != null) {
    const d = v - base;
    if (Math.abs(d) > 1e-9) {
      const good = row.lower ? d < 0 : d > 0;
      const txt = row.rel ? signed(d / base, (x) => pct(x)) : signed(d, row.dfmt || row.fmt);
      kids.push(h('span', { class: 'd ' + (good ? 'up' : 'down'), text: txt }));
    }
  }
  return h('td', { class: 'num' }, kids);
}

// base = unit with nothing, ref = unit with its trait bonuses (or the same when there are none)
function statTable(base, ref, cols, modeKey, hasT) {
  const nb = withExtras(base, base);
  const nt = withExtras(ref, base);
  const bigScore = (d, on) => h('td', { class: 'num' }, h('span', { class: 'v big ' + (d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : ''), text: on ? signed(d, (x) => pct(x, 1)) : '—' }));
  const head = h('tr', null,
    h('th', { scope: 'col', text: 'Stat' }),
    h('th', { scope: 'col', class: 'num', text: hasT ? 'Base' : 'No items' }),
    hasT ? h('th', { scope: 'col', class: 'num', text: 'With traits' }) : null,
    ...cols.map((c) => h('th', { scope: 'col', class: 'num', text: c.label })));
  const scoreRow = h('tr', { class: 'score-row' },
    h('th', { scope: 'row' }, 'Build score ', h('small', { text: MODES[modeKey].label + (hasT ? ', items on top of traits' : '') })),
    h('td', { class: 'num' }, h('span', { class: 'v', text: '—' })),
    hasT ? h('td', { class: 'num' }, h('span', { class: 'v', text: '—' })) : null,
    ...cols.map((c) => bigScore(scoreOf(c.stats, ref, modeKey) - 1, c.items.length)));
  const body = ROWS.filter((r) => !(r.k === 'spellRel' && base.spellIdx <= 0) && !(['firstCast', 'casts', 'startMana'].includes(r.k) && base.maxMana <= 0))
    .map((r) => h('tr', null,
      h('th', { scope: 'row', text: r.short || r.label }),
      cell(r, nb[r.k], null, true),
      hasT ? cell(r, nt[r.k], nb[r.k], false) : null,
      ...cols.map((c) => cell(r, withExtras(c.stats, base)[r.k], nt[r.k], false))));
  return h('table', { class: 'stats' }, h('thead', null, head), h('tbody', null, scoreRow, body));
}

function slotRow(which) {
  const arr = which === 'A' ? S.ref.items : S.B;
  return h('div', { class: 'build' },
    h('span', { class: 'build-l', text: 'Build ' + which }),
    h('div', { class: 'slots' },
      [0, 1, 2].map((i) => {
        const it = S.item[arr[i]];
        const active = S.edit === which && Math.min(S.slot, arr.length) === i;
        return h('div', { class: 'slot' + (active ? ' active' : '') },
          h('button', {
            class: 'slot-btn', type: 'button', 'aria-pressed': String(active), 'data-fk': `slot:${which}${i}`,
            'aria-label': it ? `${it.name}, build ${which} slot ${i + 1}. Select this slot to swap it.` : `Empty slot ${i + 1} in build ${which}. Select to fill it.`,
            onclick: () => { S.edit = which; S.slot = Math.min(i, arr.length); render(); },
          }, it ? pic(it.icon, it.name, 46) : h('span', { class: 'plus', text: '+' })),
          it ? h('button', { class: 'slot-x', type: 'button', 'aria-label': `Remove ${it.name}`, onclick: () => { arr.splice(i, 1); S.edit = which; S.slot = Math.min(i, arr.length); if (which === 'A') persist(); render(); }, text: '×' }) : null);
      })),
    which === 'A' && S.ref.items.length ? h('button', { class: 'link', type: 'button', onclick: () => setBuild('A', []), text: 'Clear' }) : null,
    which === 'B' ? h('button', { class: 'link', type: 'button', onclick: () => { S.compare = false; if (S.edit === 'B') { S.edit = 'A'; S.slot = Math.min(S.ref.items.length, 2); } render(); }, text: 'Hide' }) : null,
  );
}

function rankPanel(c, star, naked, modeKey, extra) {
  const arr = currentArr();
  const slot = Math.min(S.slot, arr.length);
  const baseItems = arr.filter((_, i) => i !== slot).map((id) => S.item[id]);
  const baseStats = computeStats(c, star, baseItems, extra);
  const baseScore = scoreOf(baseStats, naked, modeKey);

  let rows = S.data.items
    .filter((it) => !baseItems.includes(it))
    .map((it) => {
      const st = computeStats(c, star, [...baseItems, it], extra);
      const rel = (a, b) => (b > 0 ? a / b - 1 : 0);
      return {
        it, st,
        score: scoreOf(st, naked, modeKey) / baseScore - 1,
        auto: rel(st.autoDps, baseStats.autoDps),
        spell: rel(st.spellIdx, baseStats.spellIdx),
        ehp: rel((st.ehpP + st.ehpM) / 2, (baseStats.ehpP + baseStats.ehpM) / 2),
      };
    });

  const needle = S.itemQ.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => r.it.name.toLowerCase().includes(needle));
  if (S.itemComp) rows = rows.filter((r) => r.it.components.includes(S.itemComp));
  rows.sort((a, b) => b[S.sort] - a[S.sort] || a.it.name.localeCompare(b.it.name));
  const shown = S.showAll ? rows : rows.slice(0, 12);
  const maxAbs = Math.max(0.05, ...rows.map((r) => Math.abs(r[S.sort])));
  const cname = (id) => (S.comp[id] ? S.comp[id].name : id);
  const sortLabel = { score: 'build score', auto: 'auto-attack damage', spell: 'ability output', ehp: 'survivability' }[S.sort];

  const list = h('div', { class: 'ranking', role: 'list' },
    shown.map((r) => {
      const on = arr[slot] === r.it.id;
      const v = r[S.sort];
      const w = Math.min(50, (Math.abs(v) / maxAbs) * 50);
      return h('button', {
        class: 'rank-row' + (on ? ' on' : ''), type: 'button', role: 'listitem', 'data-fk': 'rank:' + r.it.id,
        title: `${r.it.name}\n${r.it.desc}`, onclick: () => equip(r.it.id),
      },
        pic(r.it.icon, r.it.name, 44),
        h('span', { class: 'rn' },
          h('b', { text: r.it.name }),
          h('span', { class: 'recipe', text: r.it.components.map(cname).join(' + ') }),
          h('span', { class: 'chips' }, statChips(r.it))),
        h('span', { class: 'rv' },
          h('span', { class: 'dl ' + (v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : ''), text: signed(v, (x) => pct(x, 1)) }),
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'fill ' + (v >= 0 ? 'pos' : 'neg'), '--w': w + '%' })),
          h('span', { class: 'mm' },
            h('span', { class: r.auto > 0.0005 ? 'up' : r.auto < -0.0005 ? 'down' : '', text: 'Auto ' + signed(r.auto, (x) => pct(x)) }),
            c.stats.mana > 0 ? h('span', { class: r.spell > 0.0005 ? 'up' : r.spell < -0.0005 ? 'down' : '', text: 'Spell ' + signed(r.spell, (x) => pct(x)) }) : null,
            h('span', { class: r.ehp > 0.0005 ? 'up' : r.ehp < -0.0005 ? 'down' : '', text: 'HP ' + signed(r.ehp, (x) => pct(x)) }))),
      );
    }),
    !rows.length ? h('p', { class: 'muted', text: 'No item matches.' }) : null,
  );

  const sortSel = h('select', { 'aria-label': 'Sort items by', onchange: (e) => { S.sort = e.target.value; render(); } },
    [['score', 'Best overall'], ['auto', 'Auto-attack damage'], ['spell', 'Ability output'], ['ehp', 'Survivability']]
      .map(([v, l]) => h('option', { value: v, text: l, selected: S.sort === v ? '' : null })));

  const chips = h('div', { class: 'comp-chips', role: 'group', 'aria-label': 'Filter items by component' },
    h('button', { class: 'cchip' + (!S.itemComp ? ' on' : ''), type: 'button', 'aria-pressed': String(!S.itemComp), onclick: () => { S.itemComp = ''; render(); }, text: 'All' }),
    S.data.components.map((k) => h('button', {
      class: 'cchip' + (S.itemComp === k.id ? ' on' : ''), type: 'button', 'aria-pressed': String(S.itemComp === k.id), title: k.name,
      onclick: () => { S.itemComp = S.itemComp === k.id ? '' : k.id; render(); },
    }, pic(k.icon, k.name, 22, 'sq'), h('span', { text: k.name }))));

  const search = h('input', { type: 'search', placeholder: 'Search an item', 'aria-label': 'Search items', value: S.itemQ, autocomplete: 'off', 'data-fk': 'itemq',
    oninput: (e) => { S.itemQ = e.target.value; render(); } });

  return h('div', { class: 'rank' },
    h('div', { class: 'rank-head' },
      h('h3', { class: 'h3', text: `Best item for slot ${slot + 1} of build ${S.edit}` }),
      h('p', { class: 'muted small' }, `Percentages show how ${sortLabel} changes versus ${baseItems.length ? 'the rest of the build' : 'a unit with no items'}. Click an item to put it in the highlighted slot.`)),
    h('div', { class: 'rank-tools' }, search, sortSel),
    chips,
    list,
    rows.length > 12 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.showAll = !S.showAll; render(); }, text: S.showAll ? 'Show fewer' : `Show all ${rows.length} items` }) : null,
  );
}

function buildsPanel(c, star, modeKey, extra, hasT) {
  const key = `${c.id}|${star}|${modeKey}|${JSON.stringify(extra)}`;
  const have = S.builds && S.builds.key === key ? S.builds.list : null;
  const body = [];
  if (have) {
    const cname = (id) => (S.comp[id] ? S.comp[id].name : id);
    body.push(h('ol', { class: 'combos' }, have.map((b) =>
      h('li', { class: 'combo' },
        h('span', { class: 'combo-items' }, b.items.map((it) => pic(it.icon, it.name, 40))),
        h('span', { class: 'combo-names' },
          h('b', { text: b.items.map((i) => i.name).join(' · ') }),
          h('span', { class: 'recipe', text: `Auto ${signed(b.stats.autoDps / b.naked.autoDps - 1, (x) => pct(x))} · Eff. HP ${signed((b.stats.ehpP + b.stats.ehpM) / (b.naked.ehpP + b.naked.ehpM) - 1, (x) => pct(x))}${b.naked.spellIdx > 0 ? ` · Ability ${signed(b.stats.spellIdx / b.naked.spellIdx - 1, (x) => pct(x))}` : ''}` })),
        h('span', { class: 'combo-score up', text: signed(b.score - 1, (x) => pct(x)) }),
        h('button', { class: 'btn small', type: 'button', onclick: () => setBuild('A', b.items.map((i) => i.id)), text: 'Use as build A' }),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { S.compare = true; setBuild('B', b.items.map((i) => i.id)); }, text: 'Compare as B' }),
      ))));
  }
  const run = () => {
    S.computing = true;
    render();
    setTimeout(() => {
      const naked = computeStats(c, star, [], extra);
      S.builds = { key, list: bestBuilds(c, star, modeKey, S.data.items, 3, 6, extra).map((b) => ({ ...b, naked })) };
      S.computing = false;
      render();
    }, 30);
  };
  return h('div', { class: 'builds' },
    h('div', { class: 'row between wrap' },
      h('div', null,
        h('h3', { class: 'h3', text: `Best 3-item builds for ${c.name}` }),
        h('p', { class: 'muted small', text: `Tries every combination of ${S.data.items.length} items at ${star} star, role: ${MODES[modeKey].label}${hasT ? ', including this unit’s trait bonuses' : ''}. Flat stats only.` })),
      h('button', { class: 'btn', type: 'button', disabled: S.computing ? '' : null, onclick: run, text: S.computing ? 'Calculating…' : have ? 'Recalculate' : 'Find the best builds' })),
    body);
}

function renderLab() {
  const box = $('#lab');
  const ref = S.ref;
  const c = S.champ[ref.id];
  const guess = guessMode(c);
  const modeKey = ref.mode || guess;
  const onBoard = S.team.includes(ref);
  const slotInfo = S.traitsOn && onBoard && S.tinfo ? S.tinfo.byUnit.get(ref) : null;
  const extra = slotInfo ? slotInfo.stats : {};
  const hasT = Object.keys(extra).length > 0;
  const base = computeStats(c, ref.star, []);
  const naked = hasT ? computeStats(c, ref.star, [], extra) : base;
  const A = ref.items.map((id) => S.item[id]);
  const B = S.B.map((id) => S.item[id]);
  const cols = [{ label: 'Build A', items: A, stats: computeStats(c, ref.star, A, extra) }];
  if (S.compare) cols.push({ label: 'Build B', items: B, stats: computeStats(c, ref.star, B, extra) });

  const label = (stats) => Object.entries(stats).map(([k, v]) => (STAT_LABEL[k] ? STAT_LABEL[k](v) : null)).filter(Boolean).join(', ');
  const tnotes = !S.traitsOn ? null
    : slotInfo && slotInfo.notes.length
      ? h('div', { class: 'tnotes' }, h('span', { class: 'muted small', text: 'Trait bonuses on this unit:' }),
          slotInfo.notes.map((n) => h('span', { class: 'chip tchip', title: `${n.trait} (${n.count})`, text: `${n.trait} ${n.count}${n.adjacent ? ' · adjacent' : ''}: ${label(n.stats)}` })))
      : !onBoard && S.team.length
        ? h('p', { class: 'muted small tnotes', text: 'This unit is not on your board, so no trait bonuses are counted. Add it to your comp to include them.' })
        : null;

  const unitSel = h('select', { 'aria-label': 'Unit to test', onchange: (e) => {
    const id = e.target.value;
    const inTeam = S.team.find((u) => u.id === id);
    inspect(inTeam || { id, star: 2, items: [] });
  } },
    [1, 2, 3, 4, 5].map((cost) => h('optgroup', { label: `${cost}-cost` },
      S.data.champions.filter((x) => x.cost === cost).map((x) => h('option', { value: x.id, text: x.name, selected: x.id === ref.id ? '' : null })))));

  const head = h('div', { class: 'lab-head' },
    h('div', { class: 'lab-unit' },
      pic(c.icon, c.name, 64, 'cost' + c.cost),
      h('div', null,
        unitSel,
        h('div', { class: 'muted small', text: `${c.cost}-cost · ${c.traits.join(' · ')} · range ${c.stats.range}` }))),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Star level' },
      [1, 2, 3].map((n) => h('button', { type: 'button', 'aria-pressed': String(ref.star === n), 'data-fk': 'star:' + n,
        onclick: () => { ref.star = n; S.builds = null; persist(); render(); }, text: n + '★' }))),
    h('div', { class: 'seg wrapseg', role: 'group', 'aria-label': 'Role of this unit' },
      Object.entries(MODES).map(([k, m]) => h('button', { type: 'button', class: k === guess ? 'guess' : '', 'aria-pressed': String(modeKey === k), 'data-fk': 'mode:' + k,
        title: k === guess ? 'Suggested from the unit’s stats and ability' : '',
        onclick: () => { ref.mode = k; S.builds = null; persist(); render(); }, text: m.label }))),
    !S.team.includes(ref) ? h('button', { class: 'btn', type: 'button', onclick: () => addUnit(ref.id), text: 'Add to comp' }) : null,
  );

  const ability = h('details', { class: 'ability' },
    h('summary', { text: c.ability.name ? `Ability: ${c.ability.name}` : 'Ability' }),
    h('p', { class: 'small', text: c.ability.desc || 'No description available.' }),
    h('p', { class: 'muted small', text: `Ability scales ${pct(c.ability.adShare)} with AD and ${pct(c.ability.apShare)} with AP (read from its text).` }));

  const left = h('div', { class: 'lab-l' },
    slotRow('A'),
    S.compare ? slotRow('B') : h('button', { class: 'link', type: 'button', onclick: () => { S.compare = true; S.edit = 'B'; S.slot = 0; render(); }, text: '+ Compare with a second build' }),
    tnotes,
    statTable(base, naked, cols, modeKey, hasT),
    ability);

  box.replaceChildren(head, h('div', { class: 'lab-grid' }, left, rankPanel(c, ref.star, naked, modeKey, extra)), buildsPanel(c, ref.star, modeKey, extra, hasT));
}

/* ───────────── render orchestration ───────────── */

function render() {
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const caret = focus === 'itemq' ? document.activeElement.selectionStart : null;
  S.tinfo = applyTraits({ team: S.team, champ: S.champ, trait: S.trait, rules: S.rules });
  renderPool();
  renderTeam();
  renderTraits();
  renderLab();
  if (focus) {
    const el = document.querySelector(`[data-fk="${CSS.escape(focus)}"]`);
    if (el) { el.focus({ preventScroll: true }); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
  }
}

/* ───────────── boot ───────────── */

function setupControls() {
  const costs = $('#costs');
  const draw = () => {
    costs.replaceChildren(
      h('button', { type: 'button', class: 'cost-btn' + (!S.filters.cost ? ' on' : ''), 'aria-pressed': String(!S.filters.cost), onclick: () => { S.filters.cost = 0; draw(); renderPool(); }, text: 'All' }),
      ...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: `cost-btn c${n}` + (S.filters.cost === n ? ' on' : ''), 'aria-pressed': String(S.filters.cost === n),
        onclick: () => { S.filters.cost = S.filters.cost === n ? 0 : n; draw(); renderPool(); }, text: String(n) })));
  };
  draw();
  $('#q').addEventListener('input', (e) => { S.filters.q = e.target.value; renderPool(); });
  const tf = $('#trait-filter');
  tf.replaceChildren(h('option', { value: '', text: 'All traits' }),
    ...S.data.traits.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => h('option', { value: t.name, text: t.name })));
  tf.addEventListener('change', (e) => { S.filters.trait = e.target.value; renderPool(); });
  const cap = $('#cap');
  cap.replaceChildren(...Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1) })));
  cap.addEventListener('change', (e) => { S.cap = Number(e.target.value); if (S.team.length > S.cap) { S.team.length = S.cap; if (S.ref && !S.team.includes(S.ref)) S.ref = { ...S.ref, items: [...S.ref.items] }; } persist(); render(); });

  const tg = $('#traits-on');
  tg.checked = S.traitsOn;
  tg.addEventListener('change', () => { S.traitsOn = tg.checked; S.builds = null; persist(); render(); });

  // dropping a unit on the champion list takes it off the board
  const pool = $('.pool');
  pool.addEventListener('dragover', (e) => { if (dragging && dragging.kind === 'unit') { e.preventDefault(); pool.classList.add('over'); } });
  pool.addEventListener('dragleave', (e) => { if (!pool.contains(e.relatedTarget)) pool.classList.remove('over'); });
  pool.addEventListener('drop', (e) => {
    e.preventDefault();
    const d = dragging;
    endDrag();
    pool.classList.remove('over');
    const u = d && d.kind === 'unit' ? S.team.find((x) => x.id === d.id) : null;
    if (u) removeUnit(u);
  });

  $('#btn-share').addEventListener('click', async () => {
    persist();
    try { await navigator.clipboard.writeText(location.href); flash('Link copied. It holds your whole comp.'); }
    catch { window.prompt('Copy this link', location.href); }
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!S.team.length) return;
    S.team = [];
    S.ref = { id: S.ref.id, star: S.ref.star, items: [...S.ref.items], mode: S.ref.mode };
    persist();
    render();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#' + encodeHash()) return;
    const d = decodeHash(location.hash);
    if (d.team.length) { S.team = cleanTeam(d.team); if (d.cap) S.cap = d.cap; S.ref = S.team[0] || S.ref; render(); }
  });
}

async function boot() {
  const msg = $('#boot-msg'), bar = $('#boot-bar'), fill = $('#boot-fill'), sub = $('#boot-sub'), retry = $('#boot-retry');
  retry.hidden = true;
  msg.textContent = 'Loading the current set…';
  try {
    const { data, from } = await loadData((got, total) => {
      bar.hidden = false;
      const mb = (got / 1048576).toFixed(1);
      sub.textContent = total ? `Downloading game data: ${mb} of ${(total / 1048576).toFixed(0)} MB. Only the first visit is slow.` : `Downloading game data: ${mb} MB. Only the first visit is slow.`;
      fill.style.width = total ? Math.min(100, (got / total) * 100) + '%' : '60%';
    });
    S.data = data;
    S.champ = Object.fromEntries(data.champions.map((c) => [c.id, c]));
    S.item = Object.fromEntries(data.items.map((i) => [i.id, i]));
    S.trait = Object.fromEntries(data.traits.map((t) => [t.name, t]));
    S.comp = Object.fromEntries(data.components.map((k) => [k.id, k]));

    S.rules = await fetch('config/traits.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

    restore();
    S.ref = S.team[0] || { id: (data.champions.find((c) => c.cost === 4) || data.champions[0]).id, star: 2, items: [] };
    S.slot = Math.min(S.ref.items.length, MAX_ITEMS - 1);

    const m = data.meta;
    const badge = $('#set-badge');
    badge.textContent = `Set ${m.set}${m.setName ? ' · ' + m.setName : ''}`;
    badge.hidden = false;
    document.title = `TFT Comp Lab · Set ${m.set}`;
    const when = m.generatedAt ? new Date(m.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    $('#src-note').textContent = when ? `Data from ${when}` : '';
    if (!data.items.length) flash('No completed items were found in the data, so the item lab is empty.');

    setupControls();
    render();
    $('#boot').hidden = true;
    $('#app').hidden = false;
  } catch (err) {
    console.error(err);
    bar.hidden = true;
    msg.textContent = 'Could not load the game data.';
    sub.textContent = String(err && err.message ? err.message : err);
    retry.hidden = false;
  }
}
$('#boot-retry').addEventListener('click', boot);
boot();
