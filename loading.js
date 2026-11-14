// The loading screen (loading screen Task 1b, plan docs/superpowers/plans/2026-11-07-loading-screen.md). Ours,
// hand-written, the first script the page runs. It paints a grassy screen over the game's canvas from the first frame:
// a little coaster climbing its lift hill in step with a bar, the download, the compile and the game's own startup as
// one fraction, the lift over the first 70% and the drop, turns and return over the rest. When the game says its title
// is up (`loopy_ready`), the screen fades out over 400 ms, wherever the train is, and goes.
//
// The art is the forge's (`web/loading-coaster.js`, `loopy_art.coaster`); this file only places it. The rules (the
// shares, the creep, the bar, the scale, the train on its path, the frame limits) are plain functions in `LoopyLoading`,
// tested without a browser by `scripts/loading-test.mjs`; the page part runs only where there is a document.
//
// RCT's intro (OpenRCT2 src/openrct2/scenes/intro/IntroScene.cpp) is the influence: a coaster's chain lift, then the
// drop as the logo comes in. No sound plays here; the page is silent until a tap, as the game is.
(function (root) {
    "use strict";

    var L = {};

    // The last load's three stretches on this device, in ms, before any is kept: a phone on 10 Mbit/s (3.53 MB is
    // 2.8 s), the compile tail, and the startup at a phone's CPU (1c measured 1,495 ms at 4x). Task 1b's measured
    // phone run replaces these.
    L.DEFAULTS = { download_ms: 2800, compile_ms: 600, startup_ms: 1500 };
    // No part is less than this share of the bar, so a cached load's tiny download does not jump it.
    L.MIN_SHARE = 0.05;
    // A creeping part goes at most this far toward its end before it is done.
    L.CREEP_MAX = 0.95;
    // No byte for this long is a failed load.
    L.STALL_MS = 30000;
    // The hand-off's fade.
    L.FADE_MS = 400;
    // The page's limits on the game's startup (1c): no step over 30 ms, no frame gap over 50 ms.
    L.STEP_LIMIT_MS = 30;
    L.GAP_LIMIT_MS = 50;
    // The kept record's key in localStorage.
    L.KEY = "loopy.loading";
    // The bar, in art pixels: under the scene by GAP_ART, BAR_H high.
    L.BAR_H = 7;
    L.GAP_ART = 5;
    L.DOG_EVERY = 6;
    // The colors are the game's (palette.rs, candy): the grass, the outline violet, the light cream, the awning yellow.
    L.GRASS = "#8fdc7c";
    L.OUTLINE = "#2a1c3e";
    L.FACE = "#fdf6e6";
    L.FILL = "#ffd93b";
    L.FILL_LIGHT = "#ffec94";
    L.DOG = "#c99a12";
    // A scene's size before the art has come (the stub's and about the coaster's).
    L.SCENE = [160, 100];

    // The three shares of the bar from the last load's times (or the defaults), each at least MIN_SHARE, summing to 1.
    L.shares = function (rec) {
        var ok = function (v) {
            return typeof v === "number" && isFinite(v) && v >= 0;
        };
        var r = rec && ok(rec.download_ms) && ok(rec.compile_ms) && ok(rec.startup_ms) && rec.download_ms + rec.compile_ms + rec.startup_ms > 0 ? rec : L.DEFAULTS;
        var sum = r.download_ms + r.compile_ms + r.startup_ms;
        var raw = [r.download_ms / sum, r.compile_ms / sum, r.startup_ms / sum];
        // Lift the small parts to the floor, and take what they gained from the others in proportion.
        var low = raw.map(function (s) {
            return s < L.MIN_SHARE;
        });
        var lifted = 0;
        var rest = 0;
        raw.forEach(function (s, i) {
            if (low[i]) lifted += L.MIN_SHARE;
            else rest += s;
        });
        var out = raw.map(function (s, i) {
            return low[i] ? L.MIN_SHARE : (s / rest) * (1 - lifted);
        });
        return { download: out[0], compile: out[1], startup: out[2] };
    };

    // Toward the end of a part whose length is not known: a fraction of CREEP_MAX that rises with time, never reaching it.
    L.creep = function (elapsed, expected) {
        if (!(elapsed > 0)) return 0;
        return L.CREEP_MAX * (1 - Math.exp(-elapsed / Math.max(1, expected)));
    };

    // A load's state: what the page has heard, with the times (ms on one clock) each stretch ended.
    L.fresh = function (totalBytes) {
        return { started: 0, total: totalBytes || 0, bytes: 0, downloaded: null, compiled: null, boot: null, ready: null, expect: L.DEFAULTS };
    };

    // Each part's own fraction at `now`.
    L.parts = function (st, now) {
        var e = st.expect || L.DEFAULTS;
        var download;
        if (st.downloaded !== null) download = 1;
        else if (st.total > 0 && st.bytes > 0) download = Math.min(L.CREEP_MAX, st.bytes / st.total);
        else download = L.creep(now - st.started, e.download_ms);
        var compile;
        if (st.compiled !== null) compile = 1;
        else if (st.downloaded !== null) compile = L.creep(now - st.downloaded, e.compile_ms);
        else compile = 0;
        var startup;
        if (st.ready !== null) startup = 1;
        else if (st.boot && st.boot[1] > 0) startup = Math.min(L.CREEP_MAX, st.boot[0] / st.boot[1]);
        else startup = 0;
        return { download: download, compile: compile, startup: startup };
    };

    // The whole bar's true fraction.
    L.fraction = function (st, shares, now) {
        if (st.ready !== null) return 1;
        var p = L.parts(st, now);
        return Math.min(1, shares.download * p.download + shares.compile * p.compile + shares.startup * p.startup);
    };

    // The bar shown: eases toward the true fraction and never goes back, never ahead.
    L.bar = function () {
        var shown = 0;
        var target = 0;
        return {
            update: function (f, dt) {
                target = Math.max(target, Math.min(1, f));
                var k = 1 - Math.exp(-Math.max(0, dt) / 120);
                shown = Math.min(target, Math.max(shown, shown + (target - shown) * k));
                // The last sliver closes at once, so the bar is full when the load is.
                if (target - shown < 0.002) shown = target;
                return shown;
            },
            get value() {
                return shown;
            },
        };
    };

    // A Response that counts the bytes its body gives (unpacked, so gzip does not matter), keeping the original's
    // status and type, so `compileStreaming` takes it as the wasm. A response with no stream is passed on as it is.
    L.counting = function (response, onBytes, onEnd) {
        if (!response || !response.body || typeof ReadableStream === "undefined" || typeof Response === "undefined") return response;
        var reader = response.body.getReader();
        var body = new ReadableStream({
            pull: function (c) {
                return reader.read().then(function (r) {
                    if (r.done) {
                        onEnd();
                        c.close();
                        return;
                    }
                    onBytes(r.value.byteLength);
                    c.enqueue(r.value);
                });
            },
            cancel: function (why) {
                return reader.cancel(why);
            },
        });
        var headers = new Headers(response.headers);
        if (!headers.get("Content-Type")) headers.set("Content-Type", "application/wasm");
        return new Response(body, { status: response.status, statusText: response.statusText, headers: headers });
    };

    // Device pixels per art pixel: the largest whole number that fits the scene in 90% of the width and 60% of the
    // height, at least 1.
    L.scale = function (cssW, cssH, dpr, sceneW, sceneH) {
        var s = Math.floor(Math.min((0.9 * cssW * dpr) / sceneW, (0.6 * cssH * dpr) / sceneH));
        return Math.max(1, s);
    };

    // The coaster file's train fields (`cars`, forge/src/loading.rs): n cars `gap` units apart, the front car's start
    // `d0`, the crest `crest`, the last unit `end`, the first car frame `first` with `kinds` frames to a car, and the
    // run's points `every` 60ths of a second apart. Defaults hold a file with none of them.
    L.carsOf = function (c) {
        var k = (c && c.cars) || {};
        return {
            n: k.n | 0 || 1,
            gap: +k.gap || 16,
            d0: +k.d0 || 0,
            crest: +k.crest || 0,
            end: +k.end || 0,
            first: k.first | 0 || 1,
            kinds: k.kinds | 0 || 1,
            every: k.every | 0 || 1,
        };
    };

    // Car `car` when the front car is `d` units along (a fraction is fine): its pixel and frame. Car c is at d - c*gap;
    // up to the crest it is on the lift (a point a unit), past it between the run's points by their `d` (the page
    // draws between points); the frame comes from the nearer point (forge's Art::car_at, smoothed).
    L.carAt = function (art, d, car) {
        var k = L.carsOf(art);
        d -= k.gap * car;
        var pts;
        var i;
        var j;
        var t;
        if (d <= k.crest) {
            pts = art.lift;
            d = Math.max(0, Math.min(d, pts.length - 1));
            i = Math.floor(d);
            j = Math.min(i + 1, pts.length - 1);
            t = d - i;
        } else {
            pts = art.run;
            j = 0;
            while (j < pts.length - 1 && pts[j][3] < d) j++;
            i = Math.max(0, j - 1);
            var span = pts[j][3] - pts[i][3];
            t = span > 0 ? Math.max(0, Math.min(1, (d - pts[i][3]) / span)) : 1;
        }
        var p = pts[i];
        var q = pts[j];
        var kind = t < 0.5 ? p[2] : q[2];
        return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, frame: k.first + car * k.kinds + kind };
    };

    // The front car's d at bar fraction f over the whole lap: the lift over the first LIFT_SHARE of the bar (the station's
    // start at 0, the crest at LIFT_SHARE), then the drop, the turns and the return over the rest, to the lap's end at 1.
    // The run's points are evenly spaced in time, so the last 30% of the bar still rushes. Rising throughout, so the
    // bar never going back keeps the train from going back.
    L.LIFT_SHARE = 0.7;
    L.lapD = function (art, f) {
        var k = L.carsOf(art);
        var end = k.end || art.run[art.run.length - 1][3];
        f = Math.max(0, Math.min(1, f));
        if (f <= L.LIFT_SHARE) return k.d0 + (k.crest - k.d0) * (f / L.LIFT_SHARE);
        return k.crest + (end - k.crest) * ((f - L.LIFT_SHARE) / (1 - L.LIFT_SHARE));
    };

    // The front car's d `ms` after it tipped over the crest: along the run, a point every `every` 60ths of a second,
    // stopping at the last.
    L.runD = function (art, ms) {
        var k = L.carsOf(art);
        var run = art.run;
        var at = Math.max(0, (ms * 60) / 1000 / k.every);
        if (at >= run.length - 1) return run[run.length - 1][3];
        var i = Math.floor(at);
        return run[i][3] + (run[i + 1][3] - run[i][3]) * (at - i);
    };

    // Each car of the train, rear last, when the front car is at d.
    L.train = function (art, d) {
        var out = [];
        for (var c = 0; c < L.carsOf(art).n; c++) out.push(L.carAt(art, d, c));
        return out;
    };

    // The longest gap between frame times.
    L.longestGap = function (times) {
        var g = 0;
        for (var i = 1; i < times.length; i++) g = Math.max(g, times[i] - times[i - 1]);
        return g;
    };

    // The longest startup step from the game's ART_LOG line (`?art_log=1`), in ms, or null.
    L.longestStep = function (text) {
        var m = /longest step ([0-9.]+) ms/.exec(text || "");
        return m ? Number(m[1]) : null;
    };

    // 1c's limits as checks: [what, passed].
    L.limits = function (m) {
        var step = m.step;
        var gap = m.gap;
        return [
            ["the longest startup step is at most " + L.STEP_LIMIT_MS + " ms (" + step + ")", typeof step === "number" && step <= L.STEP_LIMIT_MS],
            ["the longest frame gap during the startup is at most " + L.GAP_LIMIT_MS + " ms (" + (typeof gap === "number" ? gap.toFixed(1) : gap) + ")", typeof gap === "number" && gap <= L.GAP_LIMIT_MS],
        ];
    };

    // A pixel [r, g, b, a] read under the hand-off is dark: the page's old body, or black. One that could not be read
    // (alpha 0) is not.
    L.dark = function (p) {
        if (!p || p[3] === 0) return false;
        return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] < 48;
    };

    if (typeof module !== "undefined" && module.exports) module.exports = L;
    root.LoopyLoading = L;

    if (typeof document === "undefined") return;

    // ----- The page ----------------------------------------------------------------------------------------------

    var now = function () {
        return performance.now();
    };
    var query = location.search || "";
    var scripted = /[?&]script=/.test(query);
    var showLog = /[?&]load_log=1/.test(query);
    var canvas = document.getElementById("loading");
    if (!canvas) return;
    canvas.style.display = "block";
    var ctx = canvas.getContext("2d");
    var bytesTotal = Number(canvas.getAttribute("data-wasm-bytes")) || 0;

    function readKept() {
        try {
            var t = window.localStorage.getItem(L.KEY);
            return t ? JSON.parse(t) : null;
        } catch (e) {
            return null;
        }
    }
    function keep(rec) {
        try {
            window.localStorage.setItem(L.KEY, JSON.stringify(rec));
        } catch (e) {}
    }
    var kept = readKept();
    var shares = L.shares(kept);
    var st = L.fresh(bytesTotal);
    st.started = now();
    st.expect = kept && kept.download_ms >= 0 ? { download_ms: kept.download_ms || L.DEFAULTS.download_ms, compile_ms: kept.compile_ms || L.DEFAULTS.compile_ms, startup_ms: kept.startup_ms || L.DEFAULTS.startup_ms } : L.DEFAULTS;
    var bar = L.bar();
    var failed = false;
    var lastByte = now();
    var gone = false;
    var fading = null;
    // The page's own record, for the checks (scripts/loading-check.js): frame times from the game's first step to the
    // title, and what lay under the canvas on each frame of the hand-off.
    var record = { frames: [], under: [], unread: 0, removed: null, readyAt: null, failed: false };
    var state = { st: st, record: record, bar: bar };
    root.loopy_loading_state = state;

    // ----- The download, started at once ------------------------------------------------------------------------

    var wasmUrl = root.loopy_wasm || "app.wasm";
    var early = null;
    var plainFetch = root.fetch ? root.fetch.bind(root) : null;
    function fail() {
        if (failed || gone) return;
        failed = true;
        record.failed = true;
        var p = document.createElement("div");
        p.id = "loading_failed";
        // A sentence (CLAUDE.md, "Game words"): what happened and what a tap does.
        p.textContent = "The game did not load. Tap to try again.";
        p.style.cssText = "position:fixed;left:0;right:0;top:calc(50% + " + (layoutCache ? layoutCache.textTop : 40) + "px);text-align:center;" + "font:bold 18px/1.3 monospace;color:" + L.OUTLINE + ";z-index:2;cursor:pointer";
        p.onclick = function () {
            location.reload();
        };
        canvas.onclick = p.onclick;
        document.body.appendChild(p);
    }
    if (plainFetch) {
        early = plainFetch(wasmUrl).then(
            function (r) {
                if (!r.ok) {
                    fail();
                    return r;
                }
                // No stream to count (an old browser): the download creeps, and no stall is called on a healthy load.
                if (!r.body) st.uncounted = true;
                return L.counting(
                    r,
                    function (n) {
                        st.bytes += n;
                        lastByte = now();
                    },
                    function () {
                        st.downloaded = now();
                    }
                );
            },
            function (e) {
                fail();
                throw e;
            }
        );
        // macroquad's `load` calls the global fetch for the wasm; it gets the download already under way.
        root.fetch = function (input) {
            if (early && input === wasmUrl) {
                var p = early;
                early = null;
                return p;
            }
            return plainFetch.apply(root, arguments);
        };
    }

    // ----- The game's calls (a miniquad plugin; index.html adds it after storage.js's) ------------------------------

    root.loopy_loading_plugin = function () {
        if (typeof root.miniquad_add_plugin !== "function") return;
        root.miniquad_add_plugin({
            name: "loopy_loading",
            version: 1,
            register_plugin: function (importObject) {
                importObject.env.loopy_loading = function (done, total) {
                    if (st.compiled === null) st.compiled = now();
                    st.boot = [done, total];
                    record.frames.push(now());
                };
                importObject.env.loopy_ready = function () {
                    if (st.ready === null) ready();
                };
                // A panic goes to storage.js's panic page; the loading screen stops and goes first.
                var panic = importObject.env.loopy_panic;
                importObject.env.loopy_panic = function (p, n) {
                    remove();
                    if (panic) return panic(p, n);
                };
            },
            // Right before the game's main(): the compile is over.
            on_init: function () {
                if (st.downloaded === null) st.downloaded = now();
                if (st.compiled === null) st.compiled = now();
            },
        });
    };

    function ready() {
        var t = now();
        st.ready = t;
        record.readyAt = t;
        if (st.downloaded === null) st.downloaded = t;
        if (st.compiled === null) st.compiled = t;
        var next = { download_ms: st.downloaded - st.started, compile_ms: st.compiled - st.downloaded, startup_ms: t - st.compiled };
        var old = readKept();
        if (old && typeof old.next_ride === "number") next.next_ride = old.next_ride;
        keep(next);
        var game = document.getElementById("glcanvas");
        if (game && game.focus) game.focus();
        if (scripted) {
            remove();
            return;
        }
        fading = t;
        // The fade is the compositor's (a CSS opacity transition), so it runs on even through a slow game frame.
        // A probed run (the web shots' hand-off check) fades five times slower, so its screenshots land inside the fade.
        var fadeMs = root.loopy_loading_probe ? L.FADE_MS * 5 : L.FADE_MS;
        canvas.style.transition = "opacity " + fadeMs + "ms linear";
        canvas.style.opacity = "0";
        setTimeout(remove, fadeMs + 50);
    }

    function remove() {
        if (gone) return;
        gone = true;
        record.removed = now();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        var f = document.getElementById("loading_failed");
        if (f && f.parentNode) f.parentNode.removeChild(f);
        if (plainFetch && !early) root.fetch = plainFetch;
    }

    // ----- Drawing ----------------------------------------------------------------------------------------------

    var art = null;
    var img = null;
    function takeArt() {
        var c = root.loopy_art && root.loopy_art.coaster;
        if (!c || art) return;
        art = c;
        img = new Image();
        img.src = "data:image/png;base64," + c.png;
    }

    var layoutCache = null;
    function layout() {
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, Math.round(window.innerWidth * dpr));
        var h = Math.max(1, Math.round(window.innerHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        var scene = art ? art.frames[art.scene] : null;
        var sw = scene ? scene[2] : L.SCENE[0];
        var sh = scene ? scene[3] : L.SCENE[1];
        var s = L.scale(window.innerWidth, window.innerHeight, dpr, sw, sh);
        var totalH = (sh + L.GAP_ART + L.BAR_H) * s;
        var x0 = Math.floor((w - sw * s) / 2);
        var y0 = Math.floor((h - totalH) / 2);
        layoutCache = { dpr: dpr, s: s, x0: x0, y0: y0, sw: sw, sh: sh, barY: y0 + (sh + L.GAP_ART) * s, textTop: ((y0 + totalH) / dpr) - h / dpr / 2 + 12 };
        return layoutCache;
    }

    function drawFrame(f, x, y, s, lay) {
        var r = art.frames[f];
        if (!r) return;
        // Placed by device pixels, so the train moves smoothly while each art pixel stays square.
        var dx = Math.round(lay.x0 + (x - r[4]) * s);
        var dy = Math.round(lay.y0 + (y - r[5]) * s);
        ctx.drawImage(img, r[0], r[1], r[2], r[3], dx, dy, r[2] * s, r[3] * s);
    }

    function drawBar(lay, f, t) {
        var s = lay.s;
        var x = lay.x0;
        var y = lay.barY;
        var w = lay.sw * s;
        var h = L.BAR_H * s;
        ctx.fillStyle = L.OUTLINE;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = L.FACE;
        ctx.fillRect(x + s, y + s, w - 2 * s, h - 2 * s);
        var inner = w - 2 * s;
        var filled = Math.round(inner * f);
        if (filled > 0) {
            ctx.fillStyle = L.FILL;
            ctx.fillRect(x + s, y + s, filled, h - 2 * s);
            ctx.fillStyle = L.FILL_LIGHT;
            ctx.fillRect(x + s, y + s, filled, s);
            // The lift chain's dogs slide through the filled part, a device pixel at a time.
            ctx.fillStyle = L.DOG;
            var period = L.DOG_EVERY * s;
            var off = Math.floor((t / 1000) * 12 * s) % period;
            for (var dx = off - period; dx < filled; dx += period) {
                var a = Math.max(0, dx);
                var b = Math.min(filled, dx + s);
                if (b > a) ctx.fillRect(x + s + a, y + 2 * s, b - a, h - 4 * s);
            }
        }
    }

    function drawLog(lay) {
        var lines = [];
        var t = now();
        var d = (st.downloaded !== null ? st.downloaded : t) - st.started;
        lines.push("Download: " + Math.round(d) + " ms (" + st.bytes + " of " + (st.total || "?") + " bytes)");
        if (st.downloaded !== null) lines.push("Compile: " + Math.round((st.compiled !== null ? st.compiled : t) - st.downloaded) + " ms");
        if (st.compiled !== null) lines.push("Startup: " + Math.round((st.ready !== null ? st.ready : t) - st.compiled) + " ms" + (st.boot ? " (" + st.boot[0] + " of " + st.boot[1] + " steps)" : ""));
        var px = Math.max(10, Math.round(12 * lay.dpr));
        ctx.font = px + "px monospace";
        ctx.fillStyle = L.OUTLINE;
        lines.forEach(function (l, i) {
            ctx.fillText(l, lay.x0, lay.barY + (L.BAR_H + 3) * lay.s + (i + 1) * px * 1.3);
        });
    }

    function sampleUnder() {
        var game = document.getElementById("glcanvas");
        if (!game) return;
        try {
            var c = sampleUnder.c || (sampleUnder.c = document.createElement("canvas"));
            c.width = 4;
            c.height = 4;
            var g = c.getContext("2d");
            g.clearRect(0, 0, 4, 4);
            g.drawImage(game, 0, 0, 4, 4);
            var d = g.getImageData(0, 0, 4, 4).data;
            var sum = [0, 0, 0, 0];
            for (var i = 0; i < d.length; i += 4) for (var k = 0; k < 4; k++) sum[k] += d[i + k];
            var p = sum.map(function (v) {
                return Math.round(v / 16);
            });
            if (p[3] === 0) record.unread += 1;
            record.under.push([now(), p]);
        } catch (e) {
            record.unread += 1;
        }
    }

    var last = now();
    function frame() {
        if (gone) return;
        var t = now();
        var dt = t - last;
        last = t;
        if (!failed && !st.uncounted && st.downloaded === null && st.bytes > 0 && t - lastByte > L.STALL_MS) fail();
        if (!failed && !st.uncounted && st.downloaded === null && st.bytes === 0 && t - st.started > L.STALL_MS) fail();
        takeArt();
        var f = bar.update(L.fraction(st, shares, t), dt);
        var lay = layout();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = L.GRASS;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (art && img && img.complete && img.naturalWidth) {
            drawFrame(art.scene, art.frames[art.scene][4], art.frames[art.scene][5], lay.s, lay); // the scene's own pixel is its anchor, so its box sits at 0,0 in the points' space
            var d = L.lapD(art, f); // the whole lap follows the bar, the fade included (the train is wherever the bar left it)
            var train = L.train(art, d);
            for (var k = train.length - 1; k >= 0; k--) drawFrame(train[k].frame, train[k].x, train[k].y, lay.s, lay);
        }
        drawBar(lay, f, t);
        if (showLog) drawLog(lay);
        // The GPU readback is for the checks only (scripted runs, ?load_log=1, or a probe), never a player's hand-off.
        if (fading !== null && (scripted || showLog || root.loopy_loading_probe)) sampleUnder();
        requestAnimationFrame(frame);
    }
    // The first paint: the grass and an empty bar, before any other script has come.
    frame();
})(typeof window !== "undefined" ? window : globalThis);
