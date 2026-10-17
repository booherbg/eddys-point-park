// Browser storage for the game: a miniquad plugin of our own. The game keeps small
// named text values and this plugin keeps them: its parks in the browser's IndexedDB,
// everything else (settings, key bindings, tips, designs) in localStorage. The game
// names each key in full: "loopy.<key>" for the player, "loopy.dev.<key>" for a
// scripted development run (storage.rs). The plugin also tells the game what only
// the page knows: whether it is fullscreen, whether the pointer is over it, and its
// address (for development runs). And it quiets the game's sound while the page is
// hidden (another tab, a minimized window).
//
// Parks (polish Task 8). A park is a folder of values, "loopy.parks/<id>/save" and
// the rest (saves/parks.rs). localStorage is about 5 MB for a whole site, shared with
// every page under the same address (Blaine's own other projects filled it, and
// the game's autosaves were refused: "Your park was not saved"), so parks live in
// IndexedDB, whose quota is a share of the disk. IndexedDB answers later and the
// game's calls answer now, so the page reads every park value into memory (`parks`)
// before the game's first frame (index.html waits for `loopy_storage_ready`), a read
// is answered from memory, and a write changes memory at once and goes to the
// database behind it: one readwrite transaction a write, which the database runs in
// the order they were made. A write the database refuses is kept for the game to ask
// about (`storage_trouble`), which says so in the park's ticker; one refused for space
// says the browser's storage for this site is full. The first park write asks the
// browser to keep the site's storage for good (`navigator.storage.persist`).
//
// Leaving the page (a closed tab, a reload) or hiding it saves the park in the frame
// run then; a page being unloaded or frozen may be stopped before the database has the
// write. So the writes still on their way when the page is hidden or left are also put,
// whole, into localStorage under "loopy.journal", and the next page writes them to the
// database before the game starts, then lets the journal go once they land.
//
// Storage can be missing or refuse (a private window, blocked site data, a full
// store). Every access is inside try and catch, so a refusal comes back to the game
// as a failure value and a console warning, never as a thrown error. The game then
// runs on its defaults, and parks that cannot be kept are said so.
//
// Strings cross as UTF-8 bytes in wasm memory: miniquad's loader keeps the memory in
// the global `wasm_memory`, which is ready by the time the game calls in.
//
// Load this after mq_js_bundle.js, and call load("app.wasm") once
// `loopy_storage_ready()` has resolved.
"use strict";

(function () {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8");

    function text(ptr, len) {
        return decoder.decode(new Uint8Array(wasm_memory.buffer, ptr, len));
    }

    function warn(what, e) {
        console.warn("loopy_storage: " + what + ": " + (e && e.name ? e.name + ": " + e.message : e));
    }

    // Every key in localStorage that starts with prefix. Throws when storage refuses.
    function keysStarting(prefix) {
        const keys = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k !== null && k.startsWith(prefix)) {
                keys.push(k);
            }
        }
        return keys;
    }

    // ----- Parks, in IndexedDB --------------------------------------------------

    const DB_NAME = "loopy";
    const DB_STORE = "values";
    const JOURNAL = "loopy.journal";
    // How long the page waits for the database to open before the game starts
    // without it (a browser that never answers). A slow cold start takes seconds; past
    // this, parks are not kept for the session and the game says so.
    const OPEN_WAIT_MS = 15000;

    // `?storage_log=1` says in the console when each park write is made and when it
    // lands in the database (a development switch, as `?sound_log=1` is).
    const LOG = /[?&]storage_log=1\b/.test(window.location.search);

    // A park's key: the player's or a scripted run's.
    function isPark(key) {
        return /^loopy\.(dev\.)?parks\//.test(key);
    }

    // The open database, or null when the browser will not give one: then parks are
    // not kept, and the game says so.
    let db = null;
    // Every park value, by full key, as the game last wrote it.
    const parks = new Map();
    // Each park value's UTF-8 bytes, for the performance panel.
    const sizes = new Map();
    // Writes made and not yet in the database, oldest first: key to value (null for a
    // removal). A refused write stays until a later write of its key lands, since until
    // then it is newer than what the database holds.
    const inflight = new Map();
    // A journal is out in localStorage: from then on it is an exact copy of `inflight`,
    // rewritten as writes land and gone when none is left (`syncJournal`), so it never
    // holds a value older than the database's.
    let journaled = false;
    // The worst refusal since the game last asked: 0 none, 1 refused, 2 full.
    let trouble = 0;
    // The browser keeps the site's storage for good: null not known yet.
    let persisted = null;
    let askedPersist = false;
    // Load from file: the hidden file input, and the file picked, once read: its UTF-8
    // bytes, or why not. A park's save is at most a few hundred kilobytes (an hour of the
    // Everything Park is 231 KB); a file past MAX_FILE is not one, and is never copied
    // into the game's memory.
    let fileInput = null;
    let picked = null;
    // The same as saves::parks::MAX_FILE: the biggest parks are about 0.2 MB.
    const MAX_FILE = 4 * 1024 * 1024;
    // The site's use and quota from `navigator.storage.estimate`, and when asked.
    let estimate = null;
    let estimatedAt = -1e9;

    function remember(key, value) {
        if (value === null) {
            parks.delete(key);
            sizes.delete(key);
        } else {
            parks.set(key, value);
            sizes.set(key, encoder.encode(value).length);
        }
    }

    function full(e) {
        return !!e && (e.name === "QuotaExceededError" || /quota|space|disk/i.test(e.message || ""));
    }

    function refused(what, e) {
        trouble = Math.max(trouble, full(e) ? 2 : 1);
        warn(what, e);
    }

    // Make the journal, once one is out, an exact copy of the writes on their way: gone
    // when none is left. A journal that cannot be kept exact (localStorage full) goes too:
    // an older one would bring back older values on the next page.
    function syncJournal() {
        if (!journaled) {
            return;
        }
        try {
            if (inflight.size === 0) {
                window.localStorage.removeItem(JOURNAL);
                journaled = false;
            } else {
                window.localStorage.setItem(JOURNAL, JSON.stringify(Array.from(inflight.entries())));
            }
        } catch (e) {
            try {
                window.localStorage.removeItem(JOURNAL);
            } catch (e2) {}
            journaled = false;
            warn("could not keep the park writes on their way", e);
        }
    }

    // A write goes on the list of writes on their way, last; a removal takes the writes
    // under its key off it, which it undoes.
    function onTheWay(key, value) {
        if (value === null) {
            for (const k of Array.from(inflight.keys())) {
                if (k.startsWith(key + "/")) {
                    inflight.delete(k);
                }
            }
        }
        inflight.delete(key);
        inflight.set(key, value);
    }

    // One write to the database, behind the game: `value` null removes the key and
    // every key under "key/". It is on its way until its transaction completes.
    function write(key, value) {
        const tx = db.transaction(DB_STORE, "readwrite");
        const store = tx.objectStore(DB_STORE);
        if (value === null) {
            store.delete(key);
            store.delete(IDBKeyRange.bound(key + "/", key + "/￿"));
        } else {
            store.put(value, key);
        }
        onTheWay(key, value);
        // With a journal out, it follows this write at once: a newer write of a key on it
        // may commit and the page die before it hears so (fix round 3). One localStorage
        // write per park write, only while a journal is out.
        syncJournal();
        if (LOG) {
            console.info("loopy_storage: writing " + key + (value === null ? " (removed)" : " (" + value.length + " characters)"));
        }
        // A write that landed leaves the list (unless its key was written again since),
        // and the journal follows; one refused stays on both.
        const done = function (landed) {
            if (landed) {
                if (inflight.get(key) === value) {
                    inflight.delete(key);
                }
                syncJournal();
            }
        };
        tx.oncomplete = function () {
            if (LOG) {
                console.info("loopy_storage: " + key + " is in the database");
            }
            done(true);
        };
        tx.onabort = function () {
            refused("could not keep " + key, tx.error);
            done(false);
        };
        // Sent now, not when the page's task ends: a page being left has little time.
        if (typeof tx.commit === "function") {
            tx.commit();
        }
    }

    function persistOnce() {
        if (askedPersist) {
            return;
        }
        askedPersist = true;
        try {
            if (navigator.storage && navigator.storage.persist) {
                navigator.storage
                    .persisted()
                    .then((p) => p || navigator.storage.persist())
                    .then((ok) => {
                        persisted = ok;
                        console.info("loopy_storage: the browser " + (ok ? "keeps this site's storage for good" : "may clear this site's storage when space is short"));
                    }, (e) => warn("could not ask to keep the site's storage", e));
            }
        } catch (e) {
            warn("could not ask to keep the site's storage", e);
        }
    }

    // A park value from the game: in memory at once, in the database behind it. False
    // when there is no database to keep it in.
    function setPark(key, value) {
        if (db === null) {
            return false;
        }
        try {
            write(key, value);
        } catch (e) {
            refused("could not keep " + key, e);
            return false;
        }
        remember(key, value);
        persistOnce();
        return true;
    }

    // The writes the last page left in the journal, written to the database before the
    // game starts: they are newer than what the database had.
    function replayJournal() {
        let j = null;
        try {
            j = window.localStorage.getItem(JOURNAL);
        } catch (e) {
            return;
        }
        if (j === null) {
            return;
        }
        let writes;
        try {
            writes = JSON.parse(j);
            if (!Array.isArray(writes)) {
                throw new Error("the journal is not a list of writes");
            }
        } catch (e) {
            warn("the journal could not be read, and is let go", e);
            try {
                window.localStorage.removeItem(JOURNAL);
            } catch (e2) {}
            return;
        }
        // Every write goes on the list of writes on their way first, the journal out
        // standing for them, so a write that cannot be made (a throw partway) stays on the
        // journal for the next page with every one after it.
        const mine = writes.filter(([key]) => isPark(key));
        let landed = 0;
        for (const [key, value] of mine) {
            // Whether the page before's own write reached the database after all.
            if ((parks.has(key) ? parks.get(key) : null) === value) {
                landed += 1;
            }
            for (const k of Array.from(parks.keys())) {
                if (value === null && k.startsWith(key + "/")) {
                    remember(k, null);
                }
            }
            remember(key, value);
            onTheWay(key, value);
        }
        journaled = true;
        try {
            for (const [key, value] of mine) {
                write(key, value);
            }
            console.info("loopy_storage: " + mine.length + " park writes from the page before were written from its journal (" + landed + " had reached the database already)");
        } catch (e) {
            warn("the journal's writes could not all be made; it is kept for the next page", e);
        }
    }

    // The page is being hidden or left: the writes still on their way go into the
    // journal too, whole, where the next page finds them.
    function journal() {
        if (inflight.size === 0) {
            return;
        }
        journaled = true;
        syncJournal();
    }

    // Open the database and read every park value into memory. Resolves when the game
    // may start, with or without a database.
    const ready = new Promise(function (resolve) {
        let gaveUp = false;
        const without = function (why, e) {
            if (!gaveUp) {
                gaveUp = true;
                warn(why, e);
                resolve();
            }
        };
        const timer = setTimeout(() => without("parks will not be kept", "IndexedDB did not open in " + OPEN_WAIT_MS / 1000 + " s"), OPEN_WAIT_MS);
        try {
            const req = window.indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                req.result.createObjectStore(DB_STORE);
            };
            req.onerror = function () {
                clearTimeout(timer);
                without("parks will not be kept", req.error);
            };
            // Anything thrown here (a closing connection, a database without its
            // store) starts the game without parks, never leaves the page black.
            req.onsuccess = function () {
                clearTimeout(timer);
                let opened = null;
                try {
                    opened = req.result;
                    if (gaveUp) {
                        opened.close();
                        return;
                    }
                    // Another tab opening a newer version: let it.
                    opened.onversionchange = function () {
                        opened.close();
                    };
                    const tx = opened.transaction(DB_STORE, "readonly");
                    const cursor = tx.objectStore(DB_STORE).openCursor();
                    cursor.onsuccess = function () {
                        const c = cursor.result;
                        if (c) {
                            if (typeof c.key === "string" && typeof c.value === "string") {
                                remember(c.key, c.value);
                            }
                            c.continue();
                        }
                    };
                    tx.oncomplete = function () {
                        db = opened;
                        try {
                            replayJournal();
                            const n = new Set(Array.from(parks.keys()).filter((k) => k.split("/").length > 2).map((k) => k.split("/")[1])).size;
                            console.info("loopy_storage: " + parks.size + " park values read from IndexedDB, " + n + " parks");
                        } catch (e) {
                            warn("the journal could not be replayed", e);
                        }
                        resolve();
                    };
                    tx.onabort = function () {
                        without("the parks could not be read", tx.error);
                    };
                } catch (e) {
                    try {
                        if (opened) {
                            opened.close();
                        }
                    } catch (e2) {}
                    without("the parks could not be read", e);
                }
            };
        } catch (e) {
            clearTimeout(timer);
            without("parks will not be kept", e);
        }
        try {
            if (navigator.storage && navigator.storage.persisted) {
                navigator.storage.persisted().then((p) => (persisted = p), () => {});
            }
        } catch (e) {}
    });

    // index.html starts the game once this resolves.
    window.loopy_storage_ready = function () {
        return ready;
    };

    // ----- The game's calls ------------------------------------------------------

    // The stored value, or null when absent. Throws when localStorage refuses.
    function stored(key) {
        return isPark(key) ? (parks.has(key) ? parks.get(key) : null) : window.localStorage.getItem(key);
    }

    function register_plugin(importObject) {
        // 1 when kept (for a park: in memory, and on its way to the database), 0 when
        // not.
        importObject.env.storage_set = function (key_ptr, key_len, val_ptr, val_len) {
            const key = text(key_ptr, key_len);
            if (isPark(key)) {
                return setPark(key, text(val_ptr, val_len)) ? 1 : 0;
            }
            try {
                window.localStorage.setItem(key, text(val_ptr, val_len));
                return 1;
            } catch (e) {
                warn("could not keep " + key, e);
                return 0;
            }
        };

        // The value's length in UTF-8 bytes, or -1 when absent or unreadable.
        importObject.env.storage_len = function (key_ptr, key_len) {
            const key = text(key_ptr, key_len);
            try {
                const value = stored(key);
                return value === null ? -1 : encoder.encode(value).length;
            } catch (e) {
                warn("could not read " + key, e);
                return -1;
            }
        };

        // Copies the value into wasm memory and returns the bytes copied, or -1 when
        // absent, unreadable, or longer than dst_len (then nothing is copied).
        importObject.env.storage_get = function (key_ptr, key_len, dst_ptr, dst_len) {
            const key = text(key_ptr, key_len);
            try {
                const value = stored(key);
                const bytes = value === null ? null : encoder.encode(value);
                if (bytes === null || bytes.length > dst_len) {
                    return -1;
                }
                new Uint8Array(wasm_memory.buffer, dst_ptr, bytes.length).set(bytes);
                return bytes.length;
            } catch (e) {
                warn("could not read " + key, e);
                return -1;
            }
        };

        // 1 while the browser keeps parks (the database is open), 0 when it will not
        // (a private window, blocked site data): the game still runs, and says so.
        importObject.env.loopy_parks_kept = function () {
            return db === null ? 0 : 1;
        };

        // The worst refusal of a park write since the last ask: 0 none, 1 refused,
        // 2 refused for space. Asking clears it.
        importObject.env.storage_trouble = function () {
            const t = trouble;
            trouble = 0;
            return t;
        };

        // Removes the value and every value under "key/" (a park is a folder of
        // values). 1 when they are gone, 0 when not.
        importObject.env.storage_remove = function (key_ptr, key_len) {
            const key = text(key_ptr, key_len);
            if (isPark(key + "/")) {
                if (db === null) {
                    return 0;
                }
                try {
                    write(key, null);
                } catch (e) {
                    refused("could not remove " + key, e);
                    return 0;
                }
                for (const k of Array.from(parks.keys())) {
                    if (k === key || k.startsWith(key + "/")) {
                        remember(k, null);
                    }
                }
                return 1;
            }
            try {
                for (const k of keysStarting(key + "/")) {
                    window.localStorage.removeItem(k);
                }
                window.localStorage.removeItem(key);
                return 1;
            } catch (e) {
                warn("could not remove " + key, e);
                return 0;
            }
        };

        // Every full key that starts with prefix, a line each, copied into wasm memory
        // when it fits in dst_len bytes. Returns their whole length, or -1.
        importObject.env.storage_list = function (prefix_ptr, prefix_len, dst_ptr, dst_len) {
            const prefix = text(prefix_ptr, prefix_len);
            try {
                const keys = Array.from(parks.keys()).filter((k) => k.startsWith(prefix));
                if (!isPark(prefix)) {
                    keys.push(...keysStarting(prefix));
                }
                const bytes = encoder.encode(keys.map((k) => k + "\n").join(""));
                if (bytes.length <= dst_len) {
                    new Uint8Array(wasm_memory.buffer, dst_ptr, bytes.length).set(bytes);
                }
                return bytes.length;
            } catch (e) {
                warn("could not list " + prefix, e);
                return -1;
            }
        };

        // The UTF-8 bytes the values under prefix take, for the performance panel.
        importObject.env.storage_bytes = function (prefix_ptr, prefix_len) {
            const prefix = text(prefix_ptr, prefix_len);
            let n = 0;
            for (const [k, s] of sizes) {
                if (k.startsWith(prefix)) {
                    n += s;
                }
            }
            return n;
        };

        // The site's storage use and quota in bytes, as the browser last estimated
        // them (asked again every 5 s); -1 when not known. For the performance panel.
        importObject.env.loopy_site_usage = function () {
            siteEstimate();
            return estimate ? estimate.usage : -1;
        };
        importObject.env.loopy_site_quota = function () {
            siteEstimate();
            return estimate ? estimate.quota : -1;
        };
        // 1 when the browser keeps the site's storage for good, 0 when it may clear it,
        // -1 not known.
        importObject.env.loopy_persisted = function () {
            return persisted === null ? -1 : persisted ? 1 : 0;
        };

        // The Escape menu's Download: the park's save text, handed to the browser as a
        // file of that name. The game runs it in the frame after the click, well within
        // the click's own permission to download. 1 when handed over.
        importObject.env.loopy_download = function (name_ptr, name_len, text_ptr, text_len) {
            const name = text(name_ptr, name_len);
            try {
                const url = URL.createObjectURL(new Blob([text(text_ptr, text_len)], { type: "application/octet-stream" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = name;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                console.info("loopy_storage: the park's file " + name + " is handed to the browser");
                return 1;
            } catch (e) {
                warn("could not download " + name, e);
                return 0;
            }
        };

        // Load Park's Load from file: the browser's file picker. The file is read once
        // picked and waits for the game (`loopy_file_len`, `loopy_file_take`). 1 when
        // the picker opened.
        importObject.env.loopy_pick_file = function () {
            try {
                if (fileInput === null) {
                    fileInput = document.createElement("input");
                    fileInput.type = "file";
                    fileInput.accept = ".park";
                    fileInput.style.display = "none";
                    document.body.appendChild(fileInput);
                    fileInput.addEventListener("change", function () {
                        const f = fileInput.files && fileInput.files[0];
                        fileInput.value = "";
                        if (!f) {
                            return;
                        }
                        if (f.size > MAX_FILE) {
                            picked = { error: "the file is " + f.size + " bytes, more than any park" };
                            return;
                        }
                        f.text().then(
                            (t) => (picked = { bytes: encoder.encode(t) }),
                            (e) => {
                                warn("could not read " + f.name, e);
                                picked = { error: e };
                            }
                        );
                    });
                }
                fileInput.click();
                return 1;
            } catch (e) {
                warn("could not open the file picker", e);
                return 0;
            }
        };

        // The picked file's length in UTF-8 bytes once it is read; -1 with none waiting,
        // -2 when it could not be read (or is far too big for a park).
        importObject.env.loopy_file_len = function () {
            if (picked === null) {
                return -1;
            }
            return picked.bytes ? picked.bytes.length : -2;
        };

        // Copies the picked file into wasm memory when it fits and lets it go: the bytes
        // copied, or -1.
        importObject.env.loopy_file_take = function (dst_ptr, dst_len) {
            const p = picked;
            picked = null;
            if (!p || !p.bytes || p.bytes.length > dst_len) {
                return -1;
            }
            new Uint8Array(wasm_memory.buffer, dst_ptr, p.bytes.length).set(p.bytes);
            return p.bytes.length;
        };

        // For development runs: the page address's query ("?script=settings-web"),
        // copied up to dst_len bytes. Returns its whole length, or -1.
        importObject.env.loopy_query = function (dst_ptr, dst_len) {
            try {
                const bytes = encoder.encode(window.location.search || "");
                new Uint8Array(wasm_memory.buffer, dst_ptr, Math.min(bytes.length, dst_len)).set(
                    bytes.subarray(0, dst_len)
                );
                return bytes.length;
            } catch (e) {
                warn("could not read the page address", e);
                return -1;
            }
        };

        // 1 while the page is fullscreen, else 0. The player can leave fullscreen
        // with Escape at any moment, so the game asks every frame. A browser that
        // throws here reads as windowed, the game's own starting state on the web.
        importObject.env.loopy_is_fullscreen = function () {
            try {
                return document.fullscreenElement ? 1 : 0;
            } catch (e) {
                warnOnce("fullscreen", "could not read fullscreen", e);
                return 0;
            }
        };

        // A clock finer than `Date.now()`, which miniquad's `date::now` reads and which
        // is whole milliseconds: the performance panel times a sim step in a fraction
        // of one (`perf/clock.rs`). Seconds, as a float.
        importObject.env.loopy_now = function () {
            return performance.now() / 1000.0;
        };

        // 1 while the pointer is over the page, 0 once it has left, so the park never
        // scrolls at an edge the pointer is no longer at. A throw reads as outside:
        // no edge scrolling is the safe side.
        importObject.env.loopy_pointer_inside = function () {
            try {
                return pointerInside ? 1 : 0;
            } catch (e) {
                warnOnce("pointer", "could not read the pointer", e);
                return 0;
            }
        };
    }

    function siteEstimate() {
        const now = performance.now();
        if (now - estimatedAt < 5000) {
            return;
        }
        estimatedAt = now;
        try {
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then((e) => (estimate = e), () => {});
            }
        } catch (e) {}
    }

    // The two questions above are asked every frame, so each warns only the first
    // time it fails.
    const warned = {};
    function warnOnce(key, what, e) {
        if (!warned[key]) {
            warned[key] = true;
            warn(what, e);
        }
    }

    // Leaving the page (closing the tab, a reload, another address) or hiding it
    // (another tab, a minimized window) saves the park. A hidden or closing page gets
    // no more frames of its own, so the game is told, then run one frame at once, in
    // which it writes its autosave (main.rs, `App::page_hidden`). Once each time the
    // page goes: a closing tab is hidden first, then left.
    // A page being left (not merely hidden) may be stopped before the database has
    // the park, so on pagehide the writes still on their way also go into the journal.
    let leftSaved = false;
    function leaving() {
        if (leftSaved || typeof wasm_exports === "undefined" || !wasm_exports || !wasm_exports.loopy_page_hidden) {
            return;
        }
        leftSaved = true;
        try {
            wasm_exports.loopy_page_hidden();
            wasm_exports.frame();
        } catch (e) {
            warn("could not save the park on leaving", e);
        }
    }
    // Mobile browsers often send only visibilitychange before they freeze or end a
    // page, so the journal is written on hiding too; `syncJournal` lets it go once the
    // writes land.
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
            leaving();
            journal();
        } else {
            leftSaved = false;
        }
    });
    window.addEventListener("pagehide", function () {
        leaving();
        journal();
    });

    // No button or key the game heard go down is lost on its way up. The loader hears
    // a release only on the canvas, so a release the browser's own menu took (a
    // right-click to pan opened it), or one let go off the page, never reached the
    // game, which then held the button down for good: the view panned with every
    // move until a reload (Blaine, 2026-09-30). So the browser's menu never opens over
    // the game, a release anywhere else in the window is told to the game, and
    // losing focus (another tab, another app) lets go of everything still held.
    // `scripts/web-input-check.js` checks each.
    const heldButtons = new Set();
    const heldKeys = new Set();
    let lastX = 0;
    let lastY = 0;
    const gameReady = () => typeof wasm_exports !== "undefined";
    const letGoButton = function (button) {
        if (heldButtons.delete(button) && gameReady()) {
            const p = mouse_relative_position(lastX, lastY);
            wasm_exports.mouse_up(p.x, p.y, into_sapp_mousebutton(button));
        }
    };
    const letGoKey = function (code) {
        if (heldKeys.delete(code) && gameReady()) {
            wasm_exports.key_up(into_sapp_keycode(code), 0);
        }
    };
    canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault();
    });
    canvas.addEventListener("mousedown", function (e) {
        heldButtons.add(e.button);
    });
    canvas.addEventListener("keydown", function (e) {
        heldKeys.add(e.code);
    });
    window.addEventListener("mouseup", function (e) {
        lastX = e.clientX;
        lastY = e.clientY;
        if (e.target === canvas) {
            heldButtons.delete(e.button); // the loader told the game
        } else {
            letGoButton(e.button);
        }
    });
    window.addEventListener("keyup", function (e) {
        if (e.target === canvas) {
            heldKeys.delete(e.code);
        } else {
            letGoKey(e.code);
        }
    });
    window.addEventListener("blur", function () {
        Array.from(heldButtons).forEach(letGoButton);
        Array.from(heldKeys).forEach(letGoKey);
    });

    // The pointer is over the page from its first move there until it leaves the
    // window (a mouseout with nowhere to go).
    let pointerInside = false;
    document.addEventListener("mousemove", function (e) {
        pointerInside = true;
        lastX = e.clientX;
        lastY = e.clientY;
    });
    document.addEventListener("mouseout", function (e) {
        if (!e.relatedTarget) {
            pointerInside = false;
        }
    });

    // A hidden page goes quiet. Browsers stop a hidden page's frames, so the game
    // cannot fade its own sound then, and Web Audio would play its loops on (the
    // title song, the crowd, the carousel) behind another tab. So the page does it:
    // every AudioContext the page makes plays through one gain node of ours, put in
    // place of the context's `destination`, which fades to silence when the page
    // is hidden and back when it shows. A context it hushed is also suspended, so a
    // hidden tab costs no audio work. Native builds have no page and are untouched.
    const FADE_S = 0.2;
    const hushed = [];
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        let proto = Ctx && Ctx.prototype;
        let real = null;
        for (; proto && !real; proto = Object.getPrototypeOf(proto)) {
            const d = Object.getOwnPropertyDescriptor(proto, "destination");
            real = d && d.get;
        }
        if (!real) {
            throw new Error("this browser's AudioContext has no destination to wrap");
        }
        Object.defineProperty(Ctx.prototype, "destination", {
            configurable: true,
            get: function () {
                if (!this.loopy_gain) {
                    this.loopy_gain = this.createGain();
                    this.loopy_gain.gain.value = document.hidden ? 0 : 1;
                    this.loopy_gain.connect(real.call(this));
                    hushed.push(this);
                }
                return this.loopy_gain;
            },
        });
        document.addEventListener("visibilitychange", function () {
            const hidden = document.hidden;
            for (const ctx of hushed) {
                try {
                    const gain = ctx.loopy_gain.gain;
                    const ramp = function () {
                        const t = ctx.currentTime;
                        gain.cancelScheduledValues(t);
                        gain.setValueAtTime(gain.value, t);
                        gain.linearRampToValueAtTime(hidden ? 0 : 1, t + FADE_S);
                    };
                    if (hidden) {
                        ramp();
                        setTimeout(function () {
                            if (document.hidden && ctx.state === "running") {
                                ctx.loopy_suspended = true;
                                ctx.suspend();
                            }
                        }, FADE_S * 1000 + 50);
                    } else if (ctx.loopy_suspended) {
                        // Only a context this suspended: one the browser holds until
                        // the first click stays the browser's business.
                        ctx.loopy_suspended = false;
                        ctx.resume().then(ramp, function (e) {
                            warn("could not bring the sound back", e);
                        });
                    } else {
                        ramp();
                    }
                } catch (e) {
                    warn("could not quiet the sound", e);
                }
            }
        });
    } catch (e) {
        warn("the sound will not quiet in a hidden tab", e);
    }

    // For checks from the outside (a development tool): each context's state and
    // the level of its gain.
    window.loopy_sound_state = function () {
        return hushed.map(function (ctx) {
            return { state: ctx.state, gain: ctx.loopy_gain.gain.value };
        });
    };

    miniquad_add_plugin({ register_plugin: register_plugin, name: "loopy_storage", version: 2 });
})();
