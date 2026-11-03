// Gets the dataset. Order: prebuilt data/set.json (written at deploy time) →
// cached copy in this browser (< 24 h old) → live download from CommunityDragon.

import { buildDataset, RAW_URL } from './slim.js';

const DB = 'tft-comp-lab';
const STORE = 'kv';
const MAX_AGE = 24 * 3600 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } catch { return undefined; }
}
async function idbSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* caching is optional */ }
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

export async function loadData(onProgress = () => {}) {
  // 1. Prebuilt file
  try {
    const d = await fetchJson('data/set.json', { cache: 'no-cache' });
    if (d && Array.isArray(d.champions) && d.champions.length) return { data: d, from: 'prebuilt' };
  } catch { /* not generated yet */ }

  // 2. Cached copy
  const cached = await idbGet('dataset');
  if (cached && Date.now() - cached.savedAt < MAX_AGE) return { data: cached.data, from: 'cache' };

  // 3. Live download (large file: show progress)
  try {
    const cfg = await fetchJson('config/items.json').catch(() => ({}));
    const res = await fetch(RAW_URL);
    if (!res.ok) throw new Error(`CommunityDragon answered HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got, total);
    }
    onProgress(got, got);
    const raw = JSON.parse(await new Blob(chunks).text());
    const data = buildDataset(raw, cfg);
    await idbSet('dataset', { savedAt: Date.now(), data });
    return { data, from: 'live' };
  } catch (err) {
    if (cached) return { data: cached.data, from: 'stale-cache' };
    throw err;
  }
}
