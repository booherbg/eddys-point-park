// The copy store (live sharp art Task 6, design 1): the browser's IndexedDB database `eddys-art`, one store `copies`
// keyed [family, stamp, density, style, name], each value { frg, mask } (a one-sprite FRG1 and the paint mask of a coded
// sprite as a one-sprite bundle, or null). A second store `meta` holds the running totals by density, so the Dev panel's "Cache 2x: 812
// sprites, 1.1 MB" never reads the copies to count them. Loaded only when the row is on. No DOM: node tests pass an
// in-memory IndexedDB of the subset used. A pack's worker opens its own `Store` and writes whole families (Task 10b), so
// the totals are read, changed and written inside each transaction, never trusted from memory.
export const DB_NAME = "eddys-art";
// The database's version is the copies' format. 1 held masks one byte a pixel (b600: 58 of the 63 MB of rides_flat at 3x);
// 2 holds them as bundles. Opening a version 1 database empties it (its copies cannot be read, and the next draw refills them).
export const DB_VERSION = 2;
export const COPIES = "copies";
export const META = "meta";
const TOTALS = "totals";

/** The key of one copy. `stamp` is the family's 16-digit hex art stamp (`lf_stamp`), so a recipe change misses by key. */
export function keyOf({ family, stamp, density, style = "classic", name }) {
  return [family, stamp, density, style, name];
}

const sizeOf = (v) => (v && v.frg ? v.frg.length : 0) + (v && v.mask ? v.mask.length : 0);
const done = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error || new Error("store request failed")); });
const finished = (tx) => new Promise((ok, no) => { tx.oncomplete = () => ok(); tx.onerror = () => no(tx.error || new Error("store transaction failed")); tx.onabort = () => no(tx.error || new Error("store transaction aborted")); });

/** Opens (and on first use makes) the database. Rejects when the browser has none or refuses it. */
export async function openStore(indexedDB) {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = (event) => {
    const had = event && event.oldVersion > 0;
    if (!had) {
      open.result.createObjectStore(COPIES);
      open.result.createObjectStore(META);
    } else if (event.oldVersion < DB_VERSION && open.transaction) {
      // The old copies and their totals go in the upgrade's own transaction: nothing reads a half-purged store.
      open.transaction.objectStore(COPIES).clear();
      open.transaction.objectStore(META).clear();
    }
  };
  const db = await done(open);
  const read = db.transaction([META], "readonly");
  const saved = await done(read.objectStore(META).get(TOTALS));
  return new Store(db, saved || {});
}

export class Store {
  constructor(db, totals) {
    this.db = db;
    /** density -> { n, bytes }. */
    this.sums = fromSaved(totals);
    /** Counts the times this handle emptied the store, so a session knows a pack it loaded earlier is gone. */
    this.epoch = 0;
  }

  /** The store's totals for one density: `{ n, bytes }`. */
  totals(density) {
    return this.sums.get(density) || { n: 0, bytes: 0 };
  }

  /** Writes the totals into a stats block: fields 3 to 6 (`STATS` in live-art-pool.js). */
  fill(a) {
    [2, 3].forEach((d, i) => { const t = this.totals(d); a[3 + 2 * i] = t.n; a[4 + 2 * i] = t.bytes; });
  }

  /** Reads the saved totals again (another `Store`, in a worker, may have written since). */
  async refresh() {
    const saved = await done(this.db.transaction([META], "readonly").objectStore(META).get(TOTALS));
    this.sums = fromSaved(saved || {});
  }

  /** Inside `tx` (which names META): adds `deltas` (density -> [sprites, bytes]) to the saved totals and writes them back. */
  async #commit(tx, deltas) {
    const meta = tx.objectStore(META);
    const sums = fromSaved((await done(meta.get(TOTALS))) || {});
    for (const [density, [dn, dbytes]] of deltas) {
      const t = sums.get(density) || { n: 0, bytes: 0 };
      t.n = Math.max(0, t.n + dn);
      t.bytes = Math.max(0, t.bytes + dbytes);
      sums.set(density, t);
    }
    meta.put(Object.fromEntries(sums), TOTALS);
    this.sums = sums;
  }

  /** The stored copy `{ frg, mask }` for a key, or undefined. */
  async get(key) {
    const tx = this.db.transaction([COPIES], "readonly");
    return done(tx.objectStore(COPIES).get(key));
  }

  /** Writes one copy (a second write of one key replaces the first and counts once). */
  async put(key, value) {
    const tx = this.db.transaction([COPIES, META], "readwrite");
    const copies = tx.objectStore(COPIES);
    const before = await done(copies.get(key));
    copies.put(value, key);
    await this.#commit(tx, new Map([[key[2], [before ? 0 : 1, sizeOf(value) - sizeOf(before)]]]));
    await finished(tx);
  }

  /** Writes many copies, `[[key, value], ...]`, in one transaction (a pack's records). Returns how many were new. */
  async putMany(entries) {
    const tx = this.db.transaction([COPIES, META], "readwrite");
    const copies = tx.objectStore(COPIES);
    const have = new Set((await done(copies.getAllKeys())).map((k) => JSON.stringify(k)));
    const deltas = new Map();
    let added = 0;
    for (const [key, value] of entries) {
      const before = have.has(JSON.stringify(key)) ? await done(copies.get(key)) : undefined;
      copies.put(value, key);
      const d = deltas.get(key[2]) || [0, 0];
      d[0] += before ? 0 : 1;
      d[1] += sizeOf(value) - sizeOf(before);
      deltas.set(key[2], d);
      if (!before) added++;
    }
    await this.#commit(tx, deltas);
    await finished(tx);
    return added;
  }

  /** How many copies the store holds under each `family`, `stamp` and `density`: a Map from `family\u0000stamp\u0000density`. */
  async counts() {
    const keys = await done(this.db.transaction([COPIES], "readonly").objectStore(COPIES).getAllKeys());
    const out = new Map();
    for (const k of keys) {
      const id = `${k[0]}\u0000${k[1]}\u0000${k[2]}`;
      out.set(id, (out.get(id) || 0) + 1);
    }
    return out;
  }

  /**
   * For each family in the store: every entry whose stamp is not this build's goes, by key; the other families stay
   * (design 1). `stampOf(family, density)` gives the stamp the family's entries at that density should carry (a hex
   * string: a pack's stamp where the build lists one, else the art stamp), or null for a family this build no longer
   * has (its entries go too); a rejection leaves the whole store as it is. With `only` (a density) the other densities
   * are left alone. Returns how many entries went.
   */
  async purgeStale(stampOf, only) {
    const all = await done(this.db.transaction([COPIES], "readonly").objectStore(COPIES).getAllKeys());
    const keys = only === undefined ? all : all.filter((k) => k[2] === only);
    const wanted = new Map();
    for (const k of keys) {
      const id = `${k[0]}\u0000${k[2]}`;
      if (!wanted.has(id)) wanted.set(id, await stampOf(k[0], k[2]));
    }
    const stale = keys.filter((k) => wanted.get(`${k[0]}\u0000${k[2]}`) !== k[1]);
    if (!stale.length) return 0;
    const tx = this.db.transaction([COPIES, META], "readwrite");
    const copies = tx.objectStore(COPIES);
    const deltas = new Map();
    for (const k of stale) {
      const v = await done(copies.get(k));
      copies.delete(k);
      const d = deltas.get(k[2]) || [0, 0];
      d[0] -= 1;
      d[1] -= sizeOf(v);
      deltas.set(k[2], d);
    }
    await this.#commit(tx, deltas);
    await finished(tx);
    return stale.length;
  }

  /** Empties the store (the Dev panel's Clear cache). */
  async clear() {
    const tx = this.db.transaction([COPIES, META], "readwrite");
    tx.objectStore(COPIES).clear();
    tx.objectStore(META).put({}, TOTALS);
    this.sums = new Map();
    this.epoch++;
    await finished(tx);
  }

  close() {
    this.db.close();
  }
}

const fromSaved = (totals) => new Map(Object.entries(totals).map(([d, t]) => [Number(d), { n: t.n, bytes: t.bytes }]));
