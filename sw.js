// The game's service worker (small fixes Task 82; Blaine, 2026-11-10: "playing on the plane thursday would be great").
// On install it saves every file the deploy publishes under a cache named for the version, serves them cache-first,
// and on activate deletes the caches of other versions. The deploy (scripts/deploy-web.sh) replaces the two
// placeholders below: the version, and the guide's file list. scripts/sw-test.mjs holds that every file the deploy
// copies into the build is listed here.
var VERSION = "0.6.13037";
var CACHE = "loopy-" + VERSION;

// Every file the deploy copies from web/, plus app.wasm. loading-rides.js is copied only once the forge writes it, and
// a cache.add of a missing file would fail the whole install, so it is fetched on its own below and may be absent.
var CORE = [
  "./",
  "index.html",
  "mq_js_bundle.js",
  "live-art.js",
  "storage.js",
  "loading.js",
  "loading-coaster.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "app.wasm"
];
var OPTIONAL = ["loading-rides.js"];
// Live art's files (live sharp art Task 9): the worker pool, the worker, the store and the drawing wasm. They are fetched
// only when she turns the Dev panel's Up close row on, and saved the first time they are, so a player who never does
// never downloads them. Never in install. (live-art.js, the small guard the page always loads, is in CORE.)
var ON_DEMAND = [
  "live-art-pool.js",
  "live-art-worker.js",
  "live-art-store.js",
  "live-art-pack.js",
  "forge_live.wasm"
];
// The family packs (live sharp art Task 10b) and their indexes, art-2x/ and art-3x/: up to 62 MB beside the game. The page's
// own store (IndexedDB) keeps what it takes from them, so the worker neither saves them nor answers for them: they go to the
// network as they are. Off never asks for one.
// The manual beside the game: guide/index.html and its pictures, written by the deploy.
var GUIDE = ["guide/", "guide/i/1172.png","guide/i/13140.png","guide/i/13145.png","guide/i/13150.png","guide/i/13155.png","guide/i/13160.png","guide/i/13165.png","guide/i/13170.png","guide/i/13185.png","guide/i/13190.png","guide/i/13195.png","guide/i/1350.png","guide/i/1432.png","guide/i/1504.png","guide/i/1713.png","guide/i/1805.png","guide/i/19416.png","guide/i/19488.png","guide/i/19560.png","guide/i/20136.png","guide/i/20409.png","guide/i/20489.png","guide/i/20655.png","guide/i/20863.png","guide/i/2412.png","guide/i/2524.png","guide/i/305.png","guide/i/306.png","guide/i/307.png","guide/i/308.png","guide/i/309.png","guide/i/310.png","guide/i/311.png","guide/i/312.png","guide/i/314.png","guide/i/319.png","guide/i/320.png","guide/i/321.png","guide/i/324.png","guide/i/325.png","guide/i/327.png","guide/i/358.png","guide/i/375.png","guide/i/376.png","guide/i/377.png","guide/i/381.png","guide/i/382.png","guide/i/383.png","guide/i/384.png","guide/i/385.png","guide/i/388.png","guide/i/389.png","guide/i/391.png","guide/i/396.png","guide/i/411.png","guide/i/412.png","guide/i/413.png","guide/i/414.png","guide/i/415.png","guide/i/416.png","guide/i/417.png","guide/i/418.png","guide/i/419.png","guide/i/420.png","guide/i/421.png","guide/i/423.png","guide/i/424.png","guide/i/425.png","guide/i/426.png","guide/i/427.png","guide/i/428.png","guide/i/429.png","guide/i/437.png","guide/i/438.png","guide/i/439.png","guide/i/440.png","guide/i/441.png","guide/i/442.png","guide/i/443.png","guide/i/444.png","guide/i/445.png","guide/i/446.png","guide/i/447.png","guide/i/448.png","guide/i/449.png","guide/i/450.png","guide/i/451.png","guide/i/452.png","guide/i/453.png","guide/i/454.png","guide/i/455.png","guide/i/456.png","guide/i/457.png","guide/i/458.png","guide/i/459.png","guide/i/460.png","guide/i/461.png","guide/i/462.png","guide/i/463.png","guide/i/464.png","guide/i/465.png","guide/i/466.png","guide/i/467.png","guide/i/468.png","guide/i/469.png","guide/i/470.png","guide/i/471.png","guide/i/472.png","guide/i/473.png","guide/i/474.png","guide/i/475.png","guide/i/476.png","guide/i/477.png","guide/i/478.png","guide/i/479.png","guide/i/480.png","guide/i/481.png","guide/i/605.png","guide/i/606.png","guide/i/612.png","guide/i/625.png","guide/i/626.png","guide/i/627.png","guide/i/628.png","guide/i/661.png","guide/i/662.png","guide/i/663.png","guide/i/664.png","guide/i/665.png","guide/i/666.png","guide/i/667.png","guide/i/670.png","guide/i/671.png","guide/i/672.png","guide/i/674.png","guide/i/817.png","guide/i/8292.png","guide/i/833.png","guide/i/8364.png","guide/i/871.png","guide/i/899.png","guide/i/927.png","guide/index.html","guide/p/animal-barn-swallow.html","guide/p/animal-blue-jay.html","guide/p/animal-bluegill.html","guide/p/animal-butterfly.html","guide/p/animal-cardinal.html","guide/p/animal-channel-catfish.html","guide/p/animal-crossbill.html","guide/p/animal-duck.html","guide/p/animal-frog.html","guide/p/animal-gray-squirrel.html","guide/p/animal-green-darner.html","guide/p/animal-heron.html","guide/p/animal-kingfisher.html","guide/p/animal-largemouth-bass.html","guide/p/animal-monarch.html","guide/p/animal-painted-turtle.html","guide/p/animal-parakeet.html","guide/p/animal-rabbit.html","guide/p/animal-river-otter.html","guide/p/animal-robin.html","guide/p/animal-songbird.html","guide/p/animal-swallowtail.html","guide/p/animal-trumpeter-swan.html","guide/p/animal-wood-duck.html","guide/p/bench.html","guide/p/bin.html","guide/p/climber-creeper.html","guide/p/climber-honeysuckle.html","guide/p/climber-rose.html","guide/p/coaster-bobsled.html","guide/p/coaster-boomerang.html","guide/p/coaster-family.html","guide/p/coaster-inverted.html","guide/p/coaster-invertedimpulse.html","guide/p/coaster-logflume.html","guide/p/coaster-looper.html","guide/p/coaster-mine.html","guide/p/coaster-mouse.html","guide/p/coaster-swinging.html","guide/p/coaster-wooden.html","guide/p/fence-hedge.html","guide/p/fence-picket.html","guide/p/fence-stone.html","guide/p/fence-wooden.html","guide/p/fountain.html","guide/p/gu-credits.html","guide/p/gu-decisions.html","guide/p/gu-differs.html","guide/p/gu-glossary.html","guide/p/gu-numbers.html","guide/p/gu-pictures.html","guide/p/gu-references.html","guide/p/gu-whats.html","guide/p/guest-crowds.html","guide/p/guest-energy.html","guide/p/guest-hunger.html","guide/p/guest-mood.html","guide/p/guest-nausea.html","guide/p/guest-say.html","guide/p/guest-thirst.html","guide/p/guest-toilet.html","guide/p/house-fun.html","guide/p/house-haunted.html","guide/p/howto-banks.html","guide/p/howto-block-brakes.html","guide/p/howto-breakdowns.html","guide/p/howto-coaster.html","guide/p/howto-crowds.html","guide/p/howto-doors.html","guide/p/howto-flat-ride.html","guide/p/howto-food-court.html","guide/p/howto-lift.html","guide/p/howto-litter.html","guide/p/howto-path.html","guide/p/howto-plants.html","guide/p/howto-queue.html","guide/p/howto-ratings.html","guide/p/howto-second.html","guide/p/howto-test.html","guide/p/howto-tunnel.html","guide/p/lamp.html","guide/p/maze-year.html","guide/p/music-calypso.html","guide/p/music-chiptune.html","guide/p/music-gamelan.html","guide/p/music-hoedown.html","guide/p/music-jazz.html","guide/p/music-jig.html","guide/p/music-organ.html","guide/p/music-park.html","guide/p/music-shanty.html","guide/p/music-songs.html","guide/p/music-stars.html","guide/p/music-waltz.html","guide/p/nature-animals.html","guide/p/nature-habitats.html","guide/p/nature-seasons.html","guide/p/park-buttons.html","guide/p/park-controls.html","guide/p/park-gate.html","guide/p/park-goals.html","guide/p/park-land.html","guide/p/park-money.html","guide/p/park-new-map.html","guide/p/park-one-hand.html","guide/p/park-rating.html","guide/p/park-ride-numbers.html","guide/p/park-sandbox.html","guide/p/park-trains.html","guide/p/park-view.html","guide/p/path.html","guide/p/plant-birdblind.html","guide/p/plant-birdfeeder.html","guide/p/plant-birdhouse.html","guide/p/plant-bughotel.html","guide/p/plant-bush.html","guide/p/plant-bushbird.html","guide/p/plant-bushheart.html","guide/p/plant-bushrabbit.html","guide/p/plant-buttercups.html","guide/p/plant-cactus.html","guide/p/plant-cattails.html","guide/p/plant-dogwood.html","guide/p/plant-feedingstation.html","guide/p/plant-ferns.html","guide/p/plant-flowersblue.html","guide/p/plant-flowerspink.html","guide/p/plant-flowersred.html","guide/p/plant-flowersviolet.html","guide/p/plant-flowerswhite.html","guide/p/plant-flowersyellow.html","guide/p/plant-gardenfountain.html","guide/p/plant-hayrack.html","guide/p/plant-hutch.html","guide/p/plant-lilypads.html","guide/p/plant-log.html","guide/p/plant-lupines.html","guide/p/plant-marshmarigold.html","guide/p/plant-milkweed.html","guide/p/plant-mossyboulder.html","guide/p/plant-poppies.html","guide/p/plant-rockcascade.html","guide/p/plant-speckledalder.html","guide/p/plant-staghornsumac.html","guide/p/plant-sunflowers.html","guide/p/plant-tallgrass.html","guide/p/plant-treeblossom.html","guide/p/plant-treecypress.html","guide/p/plant-treeoak.html","guide/p/plant-treepalm.html","guide/p/plant-treepine.html","guide/p/plant-treepoplar.html","guide/p/plant-treeround.html","guide/p/plant-treesmall.html","guide/p/plant-treesycamore.html","guide/p/plant-treewillow.html","guide/p/plant-trough.html","guide/p/plant-tulips.html","guide/p/plant-tussocksedge.html","guide/p/plant-winterberry.html","guide/p/queue-tv.html","guide/p/queue.html","guide/p/ride-boathire.html","guide/p/ride-bumpercars.html","guide/p/ride-carousel.html","guide/p/ride-droptower.html","guide/p/ride-ferriswheel.html","guide/p/ride-flyingsaucers.html","guide/p/ride-magiccarpet.html","guide/p/ride-maze.html","guide/p/ride-pirateship.html","guide/p/ride-teacups.html","guide/p/ride-topspin.html","guide/p/ride-trampoline.html","guide/p/sign.html","guide/p/staff-entertainer.html","guide/p/staff-handyman.html","guide/p/staff-mechanic.html","guide/p/staff-naturalist.html","guide/p/stall-animalfood.html","guide/p/stall-balloon.html","guide/p/stall-burger.html","guide/p/stall-cashmachine.html","guide/p/stall-coffee.html","guide/p/stall-cottoncandy.html","guide/p/stall-doughnut.html","guide/p/stall-drinks.html","guide/p/stall-friedchicken.html","guide/p/stall-fries.html","guide/p/stall-funnelcake.html","guide/p/stall-hats.html","guide/p/stall-hotdog.html","guide/p/stall-icecream.html","guide/p/stall-infobooth.html","guide/p/stall-lemonade.html","guide/p/stall-pizza.html","guide/p/stall-popcorn.html","guide/p/stall-pretzel.html","guide/p/stall-toffeeapple.html","guide/p/stall-toilets.html","guide/p/table.html","guide/p/wild-asters.html","guide/p/wild-clover.html","guide/p/wild-violets.html"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    // The page and the game must all arrive or the install fails and the old version stays; the rest are best effort.
    // cache: "reload" skips the browser's HTTP cache (Pages lets it keep a file 10 minutes), so an older index or wasm
    // never lands in the new version's cache.
    var fresh = function (u) { return new Request(u, { cache: "reload" }); };
    return cache.addAll(CORE.map(fresh)).then(function () {
      return Promise.all(OPTIONAL.concat(GUIDE).map(function (url) {
        return cache.add(fresh(url)).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }
  if (/\/art-[0-9]+x\//.test(url.pathname)) { return; }
  // The deploy stamps ?v=<build> on the page's scripts and the wasm; the cache holds each file once, so ignore it.
  var later = ON_DEMAND.indexOf(url.pathname.slice(url.pathname.lastIndexOf("/") + 1)) >= 0;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) { return hit; }
    return fetch(req).then(function (res) {
      // An on-demand file is saved the first time it comes, under this version's cache; a failed fetch saves nothing.
      if (later && res.ok) {
        var copy = res.clone();
        event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(req, copy); }).catch(function () {}));
      }
      return res;
    }, function () {
      // Offline and not saved: a page open falls back to the saved game page.
      if (req.mode === "navigate") {
        return caches.match(url.pathname.indexOf("/guide/") >= 0 ? "guide/index.html" : "index.html");
      }
      return Response.error();
    });
  }));
});
