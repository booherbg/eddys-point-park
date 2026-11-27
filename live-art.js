// Live art loads on demand. A test holds this file under 8 KiB. state(): density, 0 off, -1 stopped, -2 cut short.
(function (root) {
  "use strict";
  var KEY = "loopy_up_close", MARK = "loopy_live_drawing", FIELDS = 22;
  var SAY = "Live art stopped the game last time, so it opened with baked art.";
  function level(s) { return s === "2" || s === "3" ? +s : 0; }
  function isPhone(h) { return !!h.coarse && Math.min(h.width, h.height) < 700; }
  function decide(i) {
    var q = /[?&]art=([^&#]*)/.exec(i.query || ""), art = q ? q[1] : "";
    function r(n, save, clear, say) { return { density: i.phone && n > 2 ? 2 : n, save: save, clearMark: clear, say: say || "" }; }
    if (art === "baked") return r(0, "off", true);
    if (i.blocked) return r(0, null, false);
    if (i.mark) return r(0, "off", true, SAY);
    if (art === "2x" || art === "3x") return r(+art[0], art[0], false);
    return r(level(i.saved), null, false);
  }
  function create(env) {
    var st = env.storage, v = env.version || "", log = env.log || function () {}, gen = 0, cur = null, lib = null, loading = null, storeP = null;
    var asks = [], stopped = false, marked = false, mod = null, ro = null, lazy = null, dls = 0, kept = null;
    function rd(k) { try { return st.getItem(k); } catch (e) { return null; } }
    function wr(k, x) { try { if (x === null) st.removeItem(k); else st.setItem(k, x); } catch (e) {} }
    var ok = false;
    try { st.setItem(MARK + "_p", "1"); st.removeItem(MARK + "_p"); ok = true; } catch (e) {}
    var d = decide({ query: env.query, saved: rd(KEY), mark: rd(MARK), phone: isPhone(env.hardware), blocked: !ok });
    if (d.save !== null) wr(KEY, d.save);
    if (d.clearMark) wr(MARK, null);
    var density = d.density, guarded = !!d.say;
    function mark() { if (!marked) { marked = true; wr(MARK, "1"); } }
    function unmark() { marked = false; wr(MARK, null); }
    function fail(e) { stopped = true; teardown(); log("Live art stopped for this visit: " + ((e && e.message) || e)); }
    function openStore(S) { return storeP || (storeP = S.openStore(env.indexedDB).then((x) => (ro = x))); }
    function store() { return lazy || (lazy = env.importModule("live-art-store.js").then(openStore)); }
    function start() {
      var g = gen;
      return Promise.all([env.importModule("live-art-pool.js"), env.importModule("live-art-store.js"), mod || env.fetch("forge_live.wasm" + v).then(function (r) {
        if (!r.ok) throw new Error("forge_live.wasm " + r.status);
        return r.arrayBuffer();
      }).then(env.compile)]).then(function (m) {
        lib = m[0]; mod = m[2];
        if (g !== gen) return;
        var s = new lib.Session({ density: density, store: null, now: env.now, heap: env.heap });
        var pool = new lib.Pool({ module: mod, count: lib.workerCount(env.hardware), makeWorker: env.makeWorker,
          onDrawn: s.hooks.onDrawn, onFailed: s.hooks.onFailed, onError: fail, onBusy: mark, now: env.now, fetch: env.fetch, version: v });
        s.attach(pool);
        return openStore(m[1]).then(function (stor) { s.store = stor; return s.begin(); }, function () { s.store = null; }).then(function () {
          if (g !== gen) { pool.close(); return; }
          cur = s;
          asks.splice(0).forEach(a => s.ask(...a));
        });
      }).catch(fail);
    }
    function touch() { if ((density || dls) && !cur && !loading && !stopped) loading = start(); }
    function teardown() { gen++; asks = []; if (cur) cur.stop(); cur = loading = null; unmark(); }
    function set(n) {
      n = n === 2 || n === 3 ? (isPhone(env.hardware) ? 2 : n) : 0;
      if (stopped) return;
      wr(KEY, n ? String(n) : "off"); guarded = false; density = n;
      if (!n) teardown(); else if (cur) { cur.density = n; cur.dropWaiting(); } else touch();
    }
    function drop() { asks = []; if (cur) cur.dropWaiting(); }
    function next() { var c = cur && cur.peek(); return c ? lib.encodeCopy(c) : null; }
    var self = {
      state: function () { touch(); return stopped ? -1 : guarded ? -2 : density; }, set: set,
      ask: function (f, n, dd) {
        if (!density || stopped) return;
        touch(); if (cur) cur.ask(f, n, dd); else if (asks.length < 4096) asks.push([f, n, dd]);
      },
      drop: drop, next: next, taken: function () { cur.take(); },
      stats: function () {
        var a = cur ? cur.stats() : [density];
        while (a.length < FIELDS) a.push(0);
        if (!cur) {
          if (!lazy) store().catch(function () {});
          if (ro) ro.fill(a);
          for (var i = 18; kept && i < FIELDS; i++) a[i] = kept[i];
        }
        return a;
      },
      download: function (d) {
        if (stopped || (d === 3 && isPhone(env.hardware))) return;
        dls++; touch();
        loading.then(function () { return cur && cur.download(d); }).catch(function () {}).then(function () {
          if (!--dls && !density && cur) { kept = cur.stats(); teardown(); }
        });
      },
      clear: function () { return store().then(function (s) { return s.clear(); }); },
      session: () => cur,
      loaded: function () { return loading; },
      register: function (io) {
        var e = io.env, mem = function () { return root.wasm_memory.buffer; };
        var str = function (p, n) { return new TextDecoder().decode(new Uint8Array(mem(), p, n)); };
        e.loopy_live_state = self.state;
        e.loopy_live_set = set;
        e.loopy_live_drop = (p, n) => {
          if (!p) return drop();
          var keys = str(p, n).split("\n").filter(Boolean);
          if (cur) cur.keep(keys);
          else {
            var early = new Map(asks.map(a => [a.join("\0"), a]));
            asks = keys.map(k => early.get(k)).filter(Boolean);
          }
        };
        e.loopy_live_ask = function (fp, fl, np, nl, dd) { self.ask(str(fp, fl), str(np, nl), dd); };
        e.loopy_live_take = function (dst, len) {
          var b = next();
          if (!b) return 0;
          if (b.length > len) return -b.length;
          new Uint8Array(mem(), dst, b.length).set(b); cur.take();
          return b.length;
        };
        e.loopy_live_stats = function (dst) {
          var dv = new DataView(mem()), a = self.stats(), i = 0;
          for (; i < FIELDS; i++) dv.setUint32(dst + 4 * i, a[i] >>> 0, true);
        };
        e.loopy_live_clear = function () { self.clear().catch(function () {}); };
        e.loopy_live_download = self.download;
      }
    };
    if (env.onPageHide) env.onPageHide(unmark);
    if (d.say) log(d.say);
    return self;
  }
  var api = { decide: decide, create: create, isPhone: isPhone, KEY: KEY, MARK: MARK };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document && root.miniquad_add_plugin) {
    var v = (/\?[^#]*/.exec(root.document.currentScript.src) || [""])[0];
    var url = (n) => new URL(n + v, root.document.baseURI).href;
    var imp = new Function("u", "return import(u)");
    var store = null;
    try { store = root.localStorage; } catch (e) {}
    var mq = (q) => !!root.matchMedia && root.matchMedia(q).matches;
    var live = create({
      query: root.location.search, storage: store, version: v, indexedDB: root.indexedDB,
      hardware: { coarse: mq("(pointer: coarse)"), width: root.innerWidth, height: root.innerHeight, cores: root.navigator.hardwareConcurrency },
      now: () => root.performance.now(),
      heap: function () { return (root.performance.memory || {}).usedJSHeapSize || 0; },
      fetch: function (u) { return root.fetch(new URL(u, root.document.baseURI).href); },
      compile: function (b) { return root.WebAssembly.compile(b); },
      importModule: function (n) { return imp(url(n)); },
      makeWorker: function () { return new root.Worker(url("live-art-worker.js"), { type: "module" }); },
      onPageHide: function (f) { root.addEventListener("pagehide", f); },
      log: function (s) { root.console.warn(s); }
    });
    root.loopy_live_art = live;
    root.addEventListener("load", live.state);
    root.miniquad_add_plugin({ register_plugin: live.register, name: "loopy_live_art", version: 1 });
  }
})(typeof window !== "undefined" ? window : globalThis);
