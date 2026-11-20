// Live art's workers and its session (live sharp art Task 6; the demo's pool, trimmed). `Pool` deals jobs to drawing
// workers, each given the one compiled module. `Session` is one run of the row: it answers an ask from the store first,
// asks a worker only on a miss, keeps what landed in landing order, and counts for the Dev panel. No DOM at load, so
// node imports it for its tests; the page passes the real `Worker` factory. With Task 10b the pool also reads a density's
// pack index once and has a worker unpack a family's pack on demand (`pack`); a listed family's copies are keyed by its pack
// stamp, any other's by its art stamp (`stamp(family, density)`).
import { keyOf } from "./live-art-store.js?v=50100830f";
import { indexUrl, packUrl, parseIndex } from "./live-art-pack.js?v=50100830f";

export const LAPTOP_MAX = 7;
export const PHONE_MAX = 3;

/** A phone (design 4 and ruling 4): a coarse pointer and a short side under 700 CSS px. */
export function isPhone({ coarse, width, height }) {
  return !!coarse && Math.min(width, height) < 700;
}

/** Three workers on a phone; elsewhere the cores minus one (the game keeps one), at most seven. A made-up core count is never trusted past the cap. */
export function workerCount({ coarse, width, height, cores }) {
  const spare = Math.max(1, (Number.isFinite(cores) ? cores : 1) - 1);
  return Math.min(isPhone({ coarse, width, height }) ? PHONE_MAX : LAPTOP_MAX, spare);
}

export class Pool {
  /**
   * `module`: the compiled forge_live module, posted to each worker once. `makeWorker(id)`: a worker that follows
   * `live-art-worker.js`. `onDrawn(m)`, `onFailed(m)`: a drawn copy, or a name the family has not. `onError(e)`: a worker
   * that failed to start or threw (the session stops for the visit). `onBusy()`: a job is about to go out (the guard's mark).
   * `fetch(url)` and `version` ("?v=<build>" or "") are the page's, for the pack index; without a `fetch` no family is listed.
   */
  constructor({ module, count, makeWorker, onDrawn, onFailed, onError, onBusy, now = () => performance.now(), fetch = null, version = "" }) {
    this.queue = [];
    this.packQueue = [];
    this.fetch = fetch;
    this.version = version;
    this.indexes = new Map();
    this.listed = new Map();
    this.families = 0;
    this.slots = new Map();
    this.idle = [];
    this.stats = { drawn: 0, ms: 0, failed: 0, packed: 0, packFailed: 0 };
    this.stamps = new Map();
    this.tokens = new Map();
    this.nextToken = 0;
    this.onDrawn = onDrawn || (() => {});
    this.onFailed = onFailed || (() => {});
    this.onError = onError || (() => {});
    this.onBusy = onBusy || (() => {});
    this.now = now;
    this.pumping = false;
    this.closed = false;
    for (let id = 0; id < count; id++) {
      const w = makeWorker(id);
      const slot = { id, w, job: null, ready: false, held: new Set(), memory: 0 };
      this.slots.set(id, slot);
      w.onmessage = (e) => this.#message(slot, e.data);
      w.onerror = (e) => this.#fail(e);
      w.postMessage({ kind: "init", id, module });
    }
  }

  get size() { return this.slots.size; }
  get waiting() { return this.queue.length; }
  get busy() { let n = 0; for (const s of this.slots.values()) if (s.job) n++; return n; }
  /** The workers' wasm memory, summed from each one's last reply. */
  get memory() { let n = 0; for (const s of this.slots.values()) n += s.memory; return n; }

  /** Packs waiting for a worker, and packs being unpacked. */
  get packing() { let n = this.packQueue.length; for (const s of this.slots.values()) if (s.job && s.job.kind === "pack") n++; return n; }

  /**
   * The pack index of a density, read once: a Map from family to `{ stamp, records, bytes }`. A 404, a failure or no fetch
   * is an empty Map (every family draws live, and nothing is said). Resolves; never rejects.
   */
  index(density) {
    if (!this.indexes.has(density)) {
      this.indexes.set(density, (async () => {
        let map = new Map();
        try {
          const r = this.fetch && (await this.fetch(indexUrl(density, this.version)));
          if (r && r.ok) map = parseIndex(new TextDecoder().decode(await r.arrayBuffer()));
        } catch {
          // No index: every family draws live.
        }
        this.listed.set(density, map);
        return map;
      })());
    }
    return this.indexes.get(density);
  }

  /** The stamp that keys the family's copies at `density`: its pack stamp where the density's index lists it, else its art stamp (16 hex digits, "" for an unknown family). Without a density, always the art stamp. */
  async stamp(family, density) {
    if (density) {
      const listed = (await this.index(density)).get(family);
      if (listed) return listed.stamp;
    }
    return this.#art(family);
  }

  /** The family's art stamp, asked of a worker once and kept. */
  #art(family) {
    if (this.stamps.has(family)) return this.stamps.get(family);
    const p = new Promise((ok, no) => {
      const token = this.nextToken++;
      this.tokens.set(token, { ok, no, family });
      const send = () => {
        const s = [...this.slots.values()].find((x) => x.ready);
        if (s) s.w.postMessage({ kind: "stamp", token, family });
        else if (!this.closed) setTimeout(send, 5);
      };
      send();
    });
    this.stamps.set(family, p);
    return p;
  }

  /** Queues a job `{ family, name, density }`. */
  request(job) {
    if (this.closed) return;
    this.queue.push(job);
    this.#schedule();
  }

  /**
   * Has a worker fetch and unpack one pack `{ family, density, stamp, records, bytes, url }` into the store. Resolves with
   * the record count; rejects when the pack fails (a sentence) or the pool stops. A view change never drops a pack.
   */
  pack(job) {
    return new Promise((ok, no) => {
      if (this.closed) return no(new Error("live art stopped"));
      this.packQueue.push({ kind: "pack", ...job, ok, no });
      this.#schedule();
    });
  }

  /** Drops what waits (not what draws). Returns the dropped jobs. */
  dropWaiting() {
    const gone = this.queue;
    this.queue = [];
    return gone;
  }

  #schedule() {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => { this.pumping = false; this.#pump(); });
  }

  /** Each ready worker is offered a job of a family it has built first, then one of a family none holds, then the oldest. */
  #pump() {
    if (this.closed) return;
    for (const slot of this.slots.values()) {
      if (slot.ready && !slot.job && this.packQueue.length) {
        const job = this.packQueue.shift();
        slot.job = job;
        this.onBusy();
        slot.w.postMessage({ kind: "pack", id: slot.id, family: job.family, density: job.density, stamp: job.stamp, records: job.records, bytes: job.bytes, url: job.url });
        continue;
      }
      if (!slot.ready || slot.job || !this.queue.length) continue;
      const held = (f) => [...this.slots.values()].some((s) => s.held.has(f) || (s.job && s.job.family === f));
      let at = this.queue.findIndex((j) => slot.held.has(j.family));
      if (at < 0) at = this.queue.findIndex((j) => !held(j.family));
      if (at < 0) at = 0;
      const [job] = this.queue.splice(at, 1);
      slot.job = job;
      slot.held.add(job.family);
      this.onBusy();
      slot.w.postMessage({ kind: "draw", id: slot.id, family: job.family, name: job.name, density: job.density });
    }
  }

  #fail(e) {
    if (this.closed) return;
    this.onError(e instanceof Error ? e : new Error(String((e && e.message) || e)));
  }

  #message(slot, m) {
    if (this.closed) return;
    if (m.kind === "ready") {
      slot.ready = true;
      if (m.families) this.families = m.families;
    } else if (m.kind === "packed" || m.kind === "packfailed") {
      const job = slot.job;
      slot.job = null;
      if (m.kind === "packed") this.stats.packed++;
      else this.stats.packFailed++;
      if (job && job.kind === "pack") (m.kind === "packed" ? job.ok(m.count) : job.no(new Error(m.message)));
    } else if (m.kind === "stamp") {
      const t = this.tokens.get(m.token);
      this.tokens.delete(m.token);
      if (t) t.ok(m.stamp);
    } else if (m.kind === "drew") {
      slot.job = null;
      slot.memory = m.memory || slot.memory;
      this.stats.drawn++;
      this.stats.ms += m.ms || 0;
      this.onDrawn(m);
    } else if (m.kind === "failed") {
      slot.job = null;
      this.stats.failed++;
      this.onFailed(m);
    } else if (m.kind === "error") {
      this.#fail(new Error(m.message));
      return;
    }
    this.#schedule();
  }

  /** Ends every worker. Nothing more lands, and a stamp still asked for rejects. */
  close() {
    this.closed = true;
    this.queue = [];
    const stopped = new Error("live art stopped");
    for (const j of this.packQueue.splice(0)) j.no(stopped);
    for (const s of this.slots.values()) if (s.job && s.job.kind === "pack") s.job.no(stopped);
    for (const s of this.slots.values()) s.w.terminate();
    for (const t of this.tokens.values()) t.no(new Error("live art stopped"));
    this.tokens.clear();
  }
}

/** The stats block's fields, in order, each a little-endian u32 (`Session.stats`). */
export const STATS = ["density", "hits", "misses", "entries2", "bytes2", "entries3", "bytes3", "asked", "landed", "waiting", "busy", "workers", "waitMs", "workerMs", "workerMemory", "jsHeap", "failed", "unclaimed", "listed2", "listed3", "families", "packs"];
/** `packs` is a bit set: 1 and 2 say the 2x and 3x indexes are read, 4 and 8 that a download of that density is running. */
export const PACK_BITS = { known2: 1, known3: 2, loading2: 4, loading3: 8 };

export class Session {
  /**
   * `density`: 2 or 3. `store`: a `Store` (or null when the browser gave none: every ask then goes to a worker and is not
   * kept). `pool`: a `Pool` made with this session's `onDrawn` and `onFailed` (`session.hooks`). `heap()`: bytes of the
   * page's JS heap, or 0 where the browser gives none.
   */
  constructor({ density, store, now = () => performance.now(), heap = () => 0 }) {
    this.density = density;
    this.store = store;
    this.now = now;
    this.heap = heap;
    this.pool = null;
    this.pending = new Set();
    this.failed = new Set();
    this.readies = new Map();
    this.packLoads = new Map();
    this.downloads = new Set();
    this.landed = [];
    this.writes = [];
    this.n = { hits: 0, misses: 0, asked: 0, landed: 0, packs: 0 };
    this.badPacks = new Set();
    this.since = null;
    this.last = 0;
    this.stopped = false;
    this.hooks = {
      onDrawn: (m) => this.#drawn(m),
      onFailed: (m) => this.#unfound(m.family, m.name, m.density),
    };
  }

  attach(pool) { this.pool = pool; }

  #id(family, name, density) { return `${family}\u0000${name}\u0000${density}`; }

  /** The page's ask: a copy of `name` in `family` at `density`. A name already asked (or found missing) is not asked twice. */
  ask(family, name, density) {
    const id = this.#id(family, name, density);
    if (this.stopped || this.pending.has(id) || this.failed.has(id)) return;
    this.pending.add(id);
    this.n.asked++;
    if (this.since === null) this.since = this.now();
    this.writes.push(this.#lookup(family, name, density, id));
  }

  /**
   * The density's pack index, once its stale entries are purged (a family whose pack stamp or art stamp moved loses its
   * old copies at this density; everything else stays). Resolves with the index; never rejects.
   */
  ready(density) {
    if (!this.readies.has(density)) {
      this.readies.set(density, (async () => {
        const index = await this.pool.index(density);
        if (this.store) {
          try {
            await this.store.purgeStale(async (f, d) => (await this.pool.stamp(f, d)) || null, density);
          } catch {
            // A store that cannot be purged keeps what it has; the keys still say what is current.
          }
        }
        return index;
      })());
    }
    return this.readies.get(density);
  }

  /** Starts the density's index and purge now (the page calls it once the store is open). */
  begin() { return this.density ? this.ready(this.density) : Promise.resolve(); }

  async #lookup(family, name, density, id) {
    try {
      const index = await this.ready(density);
      const stamp = await this.pool.stamp(family, density);
      if (this.stopped) return;
      if (!stamp) return this.#unfound(family, name, density);
      const key = keyOf({ family, stamp, density, name });
      let hit = this.store && (await this.store.get(key));
      if (this.stopped) return;
      const listed = this.store && index.get(family);
      if (!hit && listed && !this.badPacks.has(this.#packId(family, density))) {
        // The family has a pack: one fetch brings every name, so the waiting asks come from the store (design 9).
        if (await this.#pack(family, density, listed)) {
          hit = await this.store.get(key);
          if (this.stopped) return;
          if (!hit) return this.#unfound(family, name, density);
        }
      }
      if (hit) {
        this.n.hits++;
        this.#land(family, name, density, hit.frg, hit.mask || null);
      } else {
        this.n.misses++;
        this.pool.request({ family, name, density, stamp });
      }
    } catch {
      this.pending.delete(id);
    }
  }

  #packId(family, density) { return `${family}\u0000${density}`; }

  /** One family's pack into the store, once however many asks wait on it. Resolves true when its records are in, false when the pack failed (those asks then draw live under the same key). */
  #pack(family, density, entry) {
    const id = this.#packId(family, density);
    const live = this.packLoads.get(id);
    if (live && live.epoch === this.store.epoch) return live.done;
    const done = this.pool
      .pack({ family, density, stamp: entry.stamp, records: entry.records, bytes: entry.bytes, url: packUrl(density, family, entry.stamp) })
      .then(
        async () => { await this.store.refresh(); this.n.packs++; return true; },
        () => { this.badPacks.add(id); return false; },
      );
    this.packLoads.set(id, { epoch: this.store.epoch, done });
    this.writes.push(done);
    return done;
  }

  /**
   * The Dev panel's Download: every family the density's index lists that the store does not hold whole, each fetched
   * once. Resolves when they are in (a failed pack is left; its asks draw live).
   */
  async download(density) {
    if (this.stopped || !this.store || this.downloads.has(density)) return;
    this.downloads.add(density);
    try {
      const index = await this.ready(density);
      const have = await this.store.counts();
      await Promise.all([...index].filter(([family, e]) => (have.get(`${family}\u0000${e.stamp}\u0000${density}`) || 0) < e.records).map(([family, e]) => this.#pack(family, density, e)));
      await this.store.refresh();
    } finally {
      this.downloads.delete(density);
    }
  }

  async #drawn(m) {
    this.#land(m.family, m.name, m.density, m.frg, m.mask || null);
    if (!this.store) return;
    try {
      const stamp = await this.pool.stamp(m.family, m.density);
      const w = this.store.put(keyOf({ family: m.family, stamp, density: m.density, name: m.name }), { frg: m.frg, mask: m.mask || null });
      this.writes.push(w.catch(() => {}));
      await w;
    } catch {
      // A store that throws costs a redraw next visit, nothing else.
    }
  }

  #unfound(family, name, density) {
    const id = this.#id(family, name, density);
    this.pending.delete(id);
    this.failed.add(id);
  }

  #land(family, name, density, frg, mask) {
    this.landed.push({ family, name, density, frg, mask });
    this.n.landed++;
    this.last = this.now();
  }

  /** The next landed copy `{ family, name, density, frg, mask }`, in landing order, or null. It may be asked for again. */
  take() {
    const c = this.landed.shift();
    if (c) this.pending.delete(this.#id(c.family, c.name, c.density));
    return c || null;
  }

  peek() { return this.landed[0] || null; }

  /** Forgets what waits (a changed row, or Off). What a worker is drawing finishes and lands. */
  dropWaiting() {
    if (this.pool) for (const j of this.pool.dropWaiting()) this.pending.delete(this.#id(j.family, j.name, j.density));
  }

  /** Resolves when every ask so far has landed or failed and every store write is done (for tests, and Clear cache). */
  async idle() {
    for (;;) {
      const w = this.writes;
      this.writes = [];
      await Promise.all(w);
      const busy = this.pool && (this.pool.waiting > 0 || this.pool.busy > 0 || this.pool.packing > 0);
      if (!this.writes.length && !busy) return;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  stop() {
    this.stopped = true;
    this.landed = [];
    if (this.pool) this.pool.close();
  }

  /** The Dev panel's numbers as the `STATS` array. */
  stats() {
    const t2 = this.store ? this.store.totals(2) : { n: 0, bytes: 0 };
    const t3 = this.store ? this.store.totals(3) : { n: 0, bytes: 0 };
    const p = this.pool;
    const listed = (d) => (p && p.listed.get(d) ? p.listed.get(d).size : 0);
    const bits = (p && p.listed.has(2) ? PACK_BITS.known2 : 0) | (p && p.listed.has(3) ? PACK_BITS.known3 : 0) | (this.downloads.has(2) ? PACK_BITS.loading2 : 0) | (this.downloads.has(3) ? PACK_BITS.loading3 : 0);
    return [
      this.density, this.n.hits, this.n.misses, t2.n, t2.bytes, t3.n, t3.bytes, this.n.asked, this.n.landed,
      p ? p.waiting : 0, p ? p.busy : 0, p ? p.size : 0,
      this.since === null ? 0 : Math.max(0, Math.round(this.last - this.since)),
      p ? Math.round(p.stats.ms) : 0, p ? p.memory : 0, this.heap(), p ? p.stats.failed : 0, this.landed.length,
      listed(2), listed(3), p ? p.families : 0, bits,
    ].map((v) => Math.max(0, Math.min(0xffffffff, Math.round(v))));
  }
}

/** One landed copy as the bytes `loopy_live_take` writes: u8 density, u8 family length, u16 name length, u32 FRG length, u32 mask length (all little-endian), then the family, the name, the FRG1 bytes and the mask. */
export function encodeCopy(c) {
  const te = new TextEncoder();
  const f = te.encode(c.family);
  const n = te.encode(c.name);
  const mask = c.mask || new Uint8Array(0);
  const out = new Uint8Array(12 + f.length + n.length + c.frg.length + mask.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, c.density);
  v.setUint8(1, f.length);
  v.setUint16(2, n.length, true);
  v.setUint32(4, c.frg.length, true);
  v.setUint32(8, mask.length, true);
  let o = 12;
  for (const part of [f, n, c.frg, mask]) { out.set(part, o); o += part.length; }
  return out;
}
