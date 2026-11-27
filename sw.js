// The game's service worker (small fixes Task 82; Blaine, 2026-11-10: "playing on the plane thursday would be great").
// On install it saves every file the deploy publishes under a cache named for the version, serves them cache-first,
// and on activate deletes the caches of other versions. The deploy (scripts/deploy-web.sh) replaces the two
// placeholders below: the version, and the guide's file list. scripts/sw-test.mjs holds that every file the deploy
// copies into the build is listed here.
var VERSION = "0.6.15817";
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
var GUIDE = ["guide/", "guide/i/1244.png","guide/i/1422.png","guide/i/1504.png","guide/i/1576.png","guide/i/1785.png","guide/i/1873.png","guide/i/19064.png","guide/i/19136.png","guide/i/19296.png","guide/i/19341.png","guide/i/1945.png","guide/i/1999.png","guide/i/20638.png","guide/i/2091.png","guide/i/2223.png","guide/i/2783.png","guide/i/2895.png","guide/i/306.png","guide/i/307.png","guide/i/308.png","guide/i/309.png","guide/i/310.png","guide/i/311.png","guide/i/31131.png","guide/i/31136.png","guide/i/31141.png","guide/i/31146.png","guide/i/31151.png","guide/i/31156.png","guide/i/31161.png","guide/i/31176.png","guide/i/31181.png","guide/i/31186.png","guide/i/312.png","guide/i/313.png","guide/i/315.png","guide/i/320.png","guide/i/321.png","guide/i/322.png","guide/i/325.png","guide/i/326.png","guide/i/329.png","guide/i/360.png","guide/i/39126.png","guide/i/39198.png","guide/i/39270.png","guide/i/39382.png","guide/i/39672.png","guide/i/40248.png","guide/i/403.png","guide/i/404.png","guide/i/405.png","guide/i/40521.png","guide/i/40601.png","guide/i/40767.png","guide/i/409.png","guide/i/40975.png","guide/i/410.png","guide/i/411.png","guide/i/412.png","guide/i/413.png","guide/i/416.png","guide/i/417.png","guide/i/419.png","guide/i/424.png","guide/i/439.png","guide/i/440.png","guide/i/441.png","guide/i/442.png","guide/i/443.png","guide/i/444.png","guide/i/445.png","guide/i/446.png","guide/i/447.png","guide/i/448.png","guide/i/449.png","guide/i/450.png","guide/i/452.png","guide/i/453.png","guide/i/454.png","guide/i/455.png","guide/i/456.png","guide/i/457.png","guide/i/458.png","guide/i/459.png","guide/i/460.png","guide/i/461.png","guide/i/462.png","guide/i/463.png","guide/i/464.png","guide/i/472.png","guide/i/473.png","guide/i/474.png","guide/i/475.png","guide/i/476.png","guide/i/477.png","guide/i/478.png","guide/i/479.png","guide/i/480.png","guide/i/481.png","guide/i/482.png","guide/i/483.png","guide/i/484.png","guide/i/485.png","guide/i/486.png","guide/i/487.png","guide/i/488.png","guide/i/489.png","guide/i/490.png","guide/i/491.png","guide/i/492.png","guide/i/493.png","guide/i/494.png","guide/i/495.png","guide/i/496.png","guide/i/497.png","guide/i/498.png","guide/i/499.png","guide/i/500.png","guide/i/501.png","guide/i/502.png","guide/i/503.png","guide/i/504.png","guide/i/505.png","guide/i/506.png","guide/i/507.png","guide/i/508.png","guide/i/509.png","guide/i/510.png","guide/i/511.png","guide/i/512.png","guide/i/513.png","guide/i/514.png","guide/i/515.png","guide/i/516.png","guide/i/517.png","guide/i/518.png","guide/i/519.png","guide/i/520.png","guide/i/521.png","guide/i/522.png","guide/i/646.png","guide/i/647.png","guide/i/653.png","guide/i/668.png","guide/i/669.png","guide/i/670.png","guide/i/671.png","guide/i/705.png","guide/i/706.png","guide/i/707.png","guide/i/708.png","guide/i/709.png","guide/i/710.png","guide/i/711.png","guide/i/714.png","guide/i/715.png","guide/i/716.png","guide/i/718.png","guide/i/724.png","guide/i/725.png","guide/i/726.png","guide/i/727.png","guide/i/728.png","guide/i/731.png","guide/i/732.png","guide/i/733.png","guide/i/871.png","guide/i/887.png","guide/i/925.png","guide/i/953.png","guide/i/981.png","guide/index.html","guide/p/animal-barn-swallow.html","guide/p/animal-blue-jay.html","guide/p/animal-bluegill.html","guide/p/animal-butterfly.html","guide/p/animal-cardinal.html","guide/p/animal-cedar-waxwing.html","guide/p/animal-channel-catfish.html","guide/p/animal-crossbill.html","guide/p/animal-duck.html","guide/p/animal-frog.html","guide/p/animal-gray-squirrel.html","guide/p/animal-green-darner.html","guide/p/animal-heron.html","guide/p/animal-hummingbird.html","guide/p/animal-kingfisher.html","guide/p/animal-largemouth-bass.html","guide/p/animal-monarch.html","guide/p/animal-owl.html","guide/p/animal-painted-turtle.html","guide/p/animal-parakeet.html","guide/p/animal-rabbit.html","guide/p/animal-river-otter.html","guide/p/animal-robin.html","guide/p/animal-screech-owl.html","guide/p/animal-songbird.html","guide/p/animal-swallowtail.html","guide/p/animal-trumpeter-swan.html","guide/p/animal-white-tailed-deer.html","guide/p/animal-wood-duck.html","guide/p/animal-woodpecker.html","guide/p/bench.html","guide/p/bin.html","guide/p/climber-creeper.html","guide/p/climber-honeysuckle.html","guide/p/climber-rose.html","guide/p/coaster-bobsled.html","guide/p/coaster-boomerang.html","guide/p/coaster-chairlift.html","guide/p/coaster-family.html","guide/p/coaster-inverted.html","guide/p/coaster-invertedimpulse.html","guide/p/coaster-logflume.html","guide/p/coaster-looper.html","guide/p/coaster-mine.html","guide/p/coaster-monorail.html","guide/p/coaster-mouse.html","guide/p/coaster-rocketcoaster.html","guide/p/coaster-steamtrain.html","guide/p/coaster-swinging.html","guide/p/coaster-wooden.html","guide/p/fence-hedge.html","guide/p/fence-picket.html","guide/p/fence-stone.html","guide/p/fence-wooden.html","guide/p/fountain.html","guide/p/gu-credits.html","guide/p/gu-decisions.html","guide/p/gu-differs.html","guide/p/gu-glossary.html","guide/p/gu-numbers.html","guide/p/gu-pictures.html","guide/p/gu-references.html","guide/p/gu-rules.html","guide/p/gu-whats.html","guide/p/guest-crowds.html","guide/p/guest-energy.html","guide/p/guest-hunger.html","guide/p/guest-mood.html","guide/p/guest-nausea.html","guide/p/guest-say.html","guide/p/guest-thirst.html","guide/p/guest-toilet.html","guide/p/house-fun.html","guide/p/house-haunted.html","guide/p/howto-banks.html","guide/p/howto-block-brakes.html","guide/p/howto-breakdowns.html","guide/p/howto-coaster.html","guide/p/howto-crowds.html","guide/p/howto-doors.html","guide/p/howto-everything-in-one-spot.html","guide/p/howto-expert.html","guide/p/howto-flat-ride.html","guide/p/howto-food-court.html","guide/p/howto-lift.html","guide/p/howto-litter.html","guide/p/howto-money-rides.html","guide/p/howto-path.html","guide/p/howto-plants.html","guide/p/howto-queue.html","guide/p/howto-ratings.html","guide/p/howto-second.html","guide/p/howto-test.html","guide/p/howto-track-edit.html","guide/p/howto-tunnel.html","guide/p/howto-walk-as-eddy.html","guide/p/lamp.html","guide/p/maze-year.html","guide/p/music-calypso.html","guide/p/music-chiptune.html","guide/p/music-gamelan.html","guide/p/music-hoedown.html","guide/p/music-jazz.html","guide/p/music-jig.html","guide/p/music-organ.html","guide/p/music-park.html","guide/p/music-shanty.html","guide/p/music-songs.html","guide/p/music-stars.html","guide/p/music-waltz.html","guide/p/nature-animals.html","guide/p/nature-habitats.html","guide/p/nature-loop.html","guide/p/nature-seasons.html","guide/p/park-buttons.html","guide/p/park-controls.html","guide/p/park-gate.html","guide/p/park-goals.html","guide/p/park-land.html","guide/p/park-money.html","guide/p/park-new-map.html","guide/p/park-one-hand.html","guide/p/park-rating.html","guide/p/park-ride-numbers.html","guide/p/park-sandbox.html","guide/p/park-trains.html","guide/p/park-view.html","guide/p/path.html","guide/p/plant-birdbath.html","guide/p/plant-birdblind.html","guide/p/plant-birdfeeder.html","guide/p/plant-birdhouse.html","guide/p/plant-bughotel.html","guide/p/plant-bush.html","guide/p/plant-bushbird.html","guide/p/plant-bushheart.html","guide/p/plant-bushrabbit.html","guide/p/plant-buttercups.html","guide/p/plant-cactus.html","guide/p/plant-cattails.html","guide/p/plant-dogwood.html","guide/p/plant-feedingstation.html","guide/p/plant-ferns.html","guide/p/plant-flowersblue.html","guide/p/plant-flowerspink.html","guide/p/plant-flowersred.html","guide/p/plant-flowersviolet.html","guide/p/plant-flowerswhite.html","guide/p/plant-flowersyellow.html","guide/p/plant-gardenfountain.html","guide/p/plant-hayrack.html","guide/p/plant-hutch.html","guide/p/plant-jumpingjets.html","guide/p/plant-lilypads.html","guide/p/plant-log.html","guide/p/plant-lupines.html","guide/p/plant-marshmarigold.html","guide/p/plant-milkweed.html","guide/p/plant-mossyboulder.html","guide/p/plant-owlbox.html","guide/p/plant-paperbirch.html","guide/p/plant-poppies.html","guide/p/plant-rockcascade.html","guide/p/plant-speckledalder.html","guide/p/plant-splashrock.html","guide/p/plant-staghornsumac.html","guide/p/plant-sunflowers.html","guide/p/plant-tallgrass.html","guide/p/plant-tieredfountain.html","guide/p/plant-treeblossom.html","guide/p/plant-treecypress.html","guide/p/plant-treeoak.html","guide/p/plant-treepalm.html","guide/p/plant-treepine.html","guide/p/plant-treepoplar.html","guide/p/plant-treeround.html","guide/p/plant-treesmall.html","guide/p/plant-treesycamore.html","guide/p/plant-treewillow.html","guide/p/plant-trough.html","guide/p/plant-tulips.html","guide/p/plant-tussocksedge.html","guide/p/plant-winterberry.html","guide/p/queue-tv.html","guide/p/queue.html","guide/p/ride-boathire.html","guide/p/ride-bumpercars.html","guide/p/ride-carousel.html","guide/p/ride-cinema.html","guide/p/ride-circus.html","guide/p/ride-coaster-carride-.html","guide/p/ride-coaster-ghosttrain-.html","guide/p/ride-coaster-gokarts-.html","guide/p/ride-coaster-pedalcars-.html","guide/p/ride-droptower.html","guide/p/ride-elevator.html","guide/p/ride-ferriswheel.html","guide/p/ride-flyingsaucers.html","guide/p/ride-invertership.html","guide/p/ride-magiccarpet.html","guide/p/ride-maze.html","guide/p/ride-observationtower.html","guide/p/ride-pirateship.html","guide/p/ride-simulator.html","guide/p/ride-spacerings.html","guide/p/ride-spiralslide.html","guide/p/ride-teacups.html","guide/p/ride-tiltwheel.html","guide/p/ride-topspin.html","guide/p/ride-trampoline.html","guide/p/ride-waveswinger.html","guide/p/sign.html","guide/p/staff-entertainer.html","guide/p/staff-handyman.html","guide/p/staff-mechanic.html","guide/p/staff-naturalist.html","guide/p/stall-animalfood.html","guide/p/stall-balloon.html","guide/p/stall-burger.html","guide/p/stall-cashmachine.html","guide/p/stall-coffee.html","guide/p/stall-cottoncandy.html","guide/p/stall-doughnut.html","guide/p/stall-drinks.html","guide/p/stall-friedchicken.html","guide/p/stall-fries.html","guide/p/stall-funnelcake.html","guide/p/stall-hats.html","guide/p/stall-hotdog.html","guide/p/stall-icecream.html","guide/p/stall-infobooth.html","guide/p/stall-lemonade.html","guide/p/stall-pizza.html","guide/p/stall-popcorn.html","guide/p/stall-pretzel.html","guide/p/stall-toffeeapple.html","guide/p/stall-toilets.html","guide/p/table.html","guide/p/wild-asters.html","guide/p/wild-clover.html","guide/p/wild-violets.html"];

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
