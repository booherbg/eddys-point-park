// A live-art drawing worker (live sharp art Task 6): instantiates the forge_live.wasm module the page compiled once, then
// answers what it is sent. The page times nothing in Rust: each call is timed here with `performance.now()`.
// `makeHandler` is the whole worker with its forge and its way to reply passed in, so node tests drive it with stand-ins.
// A "pack" message (Task 10b) makes it fetch one family's pack and write the whole set into the store itself, so the page's
// thread never unpacks.
import { openStore } from "./live-art-store.js?v=822a24b73";
import { fetchPack, unpack } from "./live-art-pack.js?v=822a24b73";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The wasm's C ABI as functions (`crates/forge-live/src/wasm.rs`): strings go in at a pointer, results come back at one with the length from `lf_len`. */
export async function instantiateLive(module) {
  const { exports: x } = await WebAssembly.instantiate(module, {});
  const mem = () => new Uint8Array(x.memory.buffer);
  const take = (p) => (p === 0 ? null : mem().slice(p, p + x.lf_len()));
  const withName = (s, f) => {
    const b = enc.encode(s);
    const p = x.lf_alloc(b.length);
    mem().set(b, p);
    try { return f(p, b.length); } finally { x.lf_free(p, b.length); }
  };
  return {
    /** The family's art stamp as 16 hex digits; "" for an unknown family. */
    stamp: (family) => {
      const s = withName(family, (p, n) => x.lf_stamp(p, n));
      return s === 0n ? "" : BigInt.asUintN(64, s).toString(16).padStart(16, "0"); // a wasm i64 reaches JS signed
    },
    /** The family's sprite names in bake order, or null. */
    prepare: (family) => {
      const out = withName(family, (p, n) => take(x.lf_prepare(p, n)));
      return out && dec.decode(out).split("\n").filter(Boolean);
    },
    /** The sprite at `index` as one-sprite FRG1 bytes, or null. */
    draw: (family, index, density) => withName(family, (p, n) => take(x.lf_draw(p, n, index, density))),
    /** Every family's name, in the build's order. */
    families: () => {
      const out = take(x.lf_families());
      return out ? dec.decode(out).split("\n").filter(Boolean) : [];
    },
    /** The paint mask of the sprite just drawn, or null. */
    codes: () => take(x.lf_codes()),
    memory: () => x.memory.buffer.byteLength,
  };
}

/**
 * `pack(m)` fetches and unpacks one family's pack and resolves its record count (the real worker passes `packInto` below;
 * a node test passes a stand-in). A pack that fails is answered "packfailed" with a sentence, never "error", so one bad
 * file leaves the pool and every other family running.
 */
export function makeHandler({ instantiate, post, now = () => performance.now(), pack = null }) {
  let forge = null;
  const names = new Map();
  return async (m) => {
    try {
      if (m.kind === "init") {
        const t = now();
        forge = await instantiate(m.module);
        post({ kind: "ready", id: m.id, ms: now() - t, families: forge.families ? forge.families().length : 0 });
      } else if (m.kind === "stamp") {
        post({ kind: "stamp", token: m.token, family: m.family, stamp: forge.stamp(m.family) });
      } else if (m.kind === "pack") {
        const t0 = now();
        try {
          if (!pack) throw new Error("This worker cannot unpack.");
          const count = await pack(m);
          post({ kind: "packed", id: m.id, family: m.family, density: m.density, count, ms: now() - t0 });
        } catch (e) {
          post({ kind: "packfailed", id: m.id, family: m.family, density: m.density, message: String((e && e.message) || e) });
        }
      } else if (m.kind === "draw") {
        const t0 = now();
        if (!names.has(m.family)) {
          const list = forge.prepare(m.family);
          names.set(m.family, new Map((list || []).map((n, i) => [n, i])));
        }
        const t1 = now();
        const index = names.get(m.family).get(m.name);
        const frg = index === undefined ? null : forge.draw(m.family, index, m.density);
        const mask = frg ? forge.codes() : null;
        const t2 = now();
        const base = { id: m.id, family: m.family, name: m.name, density: m.density };
        if (!frg) post({ kind: "failed", ...base });
        else post({ kind: "drew", ...base, frg, mask, ms: t2 - t0, prepMs: t1 - t0, memory: forge.memory() }, mask ? [frg.buffer, mask.buffer] : [frg.buffer]);
      }
    } catch (e) {
      post({ kind: "error", id: m.id, message: String((e && e.message) || e) });
    }
  };
}

/** The real unpacker: the worker's own fetch and its own handle on the store (opened once). */
export function packInto({ fetch, indexedDB }) {
  let opened = null;
  return async (m) => {
    opened = opened || openStore(indexedDB);
    const [store, bytes] = await Promise.all([opened, fetchPack(fetch, m.url)]);
    return unpack(store, bytes, m);
  };
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const pack = packInto({ fetch: (u) => self.fetch(u), indexedDB: self.indexedDB });
  const handle = makeHandler({ instantiate: instantiateLive, post: (m, t) => self.postMessage(m, t || []), pack });
  self.onmessage = (e) => handle(e.data);
}
