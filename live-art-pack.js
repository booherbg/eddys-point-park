// Family packs on the page (live sharp art Task 10b). A pack is one file per family and density, `art-<d>x/<family>-<pack
// stamp>.pack`, drawn by the host job and copied by the deploy for the families that have one (crates/forge-live/src/pack.rs
// holds its layout; ARP2 since b600: masks are run-coded bundles, never a byte a pixel, and an ARP1 file is refused).
// `art-<d>x/index.txt` lists them: `<family> <pack stamp> <records> <bytes>`. The page keys a listed
// family's copies by its pack stamp, so a pack and a live draw fill the same keys; the unpacker below runs in a worker and
// writes the family's whole set into the store in one transaction. No DOM, so node imports it.
import { keyOf } from "./live-art-store.js?v=822a24b73";

const STAMP = /^[0-9a-f]{16}$/;
const NAME = /^[a-z0-9_]+$/;

/** The address of a density's index, with the build (`version` is the page's "?v=<build>" or ""). */
export const indexUrl = (density, version = "") => `art-${density}x/index.txt${version}`;

/** The address of one pack. Its name is its pixels' hash, so it never changes under a name. */
export const packUrl = (density, family, stamp) => `art-${density}x/${family}-${stamp}.pack`;

/** The index's text as a Map from family to `{ stamp, records, bytes }`. A line that does not parse is skipped. */
export function parseIndex(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    const [family, stamp, records, bytes] = line.trim().split(" ");
    if (!NAME.test(family || "") || !STAMP.test(stamp || "") || !/^\d+$/.test(records || "") || !/^\d+$/.test(bytes || "")) continue;
    out.set(family, { stamp, records: Number(records), bytes: Number(bytes) });
  }
  return out;
}

/** A pack's records `{ name, frg, mask }` (each a copy, not a view: the store keeps only the bytes it is given), checked against `want` (`{ family, density, records, bytes }`). Throws a short sentence when the file is not that pack. */
export function readPack(bytes, want) {
  const dec = new TextDecoder();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cut = () => new Error("The pack is cut short.");
  let at = 0;
  const need = (n) => { if (at + n > bytes.length) throw cut(); };
  const take = (n) => { need(n); const out = bytes.slice(at, at + n); at += n; return out; };
  const magic = bytes.length < 4 ? "" : dec.decode(bytes.subarray(0, 4));
  if (magic === "ARP1") throw new Error("This pack is from an older version.");
  if (magic !== "ARP2") throw new Error("This is not a pack.");
  at = 4;
  need(3);
  const density = v.getUint8(at); at += 1;
  const flen = v.getUint16(at, true); at += 2;
  const family = dec.decode(take(flen));
  need(4);
  const count = v.getUint32(at, true); at += 4;
  if (want) {
    if (family !== want.family) throw new Error(`This pack is for ${family}, not ${want.family}.`);
    if (density !== want.density) throw new Error(`This pack is for ${density}x, not ${want.density}x.`);
    if (count !== want.records) throw new Error("This pack holds a different number of sprites than the index says.");
    if (want.bytes !== undefined && bytes.length !== want.bytes) throw new Error("This pack is not the size the index says.");
  }
  const records = [];
  for (let i = 0; i < count; i++) {
    need(2);
    const nlen = v.getUint16(at, true); at += 2;
    const name = dec.decode(take(nlen));
    need(4);
    const glen = v.getUint32(at, true); at += 4;
    const frg = take(glen);
    need(4);
    const mlen = v.getUint32(at, true); at += 4;
    records.push({ name, frg, mask: mlen ? take(mlen) : null });
  }
  if (at !== bytes.length) throw new Error("The pack has bytes after its last sprite.");
  return { family, density, records };
}

/** Fetches a pack's bytes. `fetch` is the worker's own. */
export async function fetchPack(fetch, url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Unpacks `bytes` into `store`: every record under the key a live draw of it would use (`stamp` is the pack stamp the index
 * names). `want` is `{ family, density, records, bytes }` from the index. Returns the number of records.
 */
export async function unpack(store, bytes, { family, density, stamp, records, bytes: size }) {
  const pack = readPack(bytes, { family, density, records, bytes: size });
  const entries = pack.records.map((r) => [keyOf({ family, stamp, density, name: r.name }), { frg: r.frg, mask: r.mask }]);
  await store.putMany(entries);
  return entries.length;
}
