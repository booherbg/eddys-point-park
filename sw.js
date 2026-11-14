// The game's service worker (small fixes Task 82; Blaine, 2026-11-10: "playing on the plane thursday would be great").
// On install it saves every file the deploy publishes under a cache named for the version, serves them cache-first,
// and on activate deletes the caches of other versions. The deploy (scripts/deploy-web.sh) replaces the two
// placeholders below: the version, and the guide's file list. scripts/sw-test.mjs holds that every file the deploy
// copies into the build is listed here.
var VERSION = "0.6.10356";
var CACHE = "loopy-" + VERSION;

// Every file the deploy copies from web/, plus app.wasm. loading-rides.js is copied only once the forge writes it, and
// a cache.add of a missing file would fail the whole install, so it is fetched on its own below and may be absent.
var CORE = [
  "./",
  "index.html",
  "mq_js_bundle.js",
  "storage.js",
  "loading.js",
  "loading-coaster.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "app.wasm"
];
var OPTIONAL = ["loading-rides.js"];
// The manual beside the game: guide/index.html and its pictures, written by the deploy.
var GUIDE = ["guide/", "guide/i/1098.png","guide/i/1244.png","guide/i/1326.png","guide/i/13280.png","guide/i/13352.png","guide/i/13424.png","guide/i/13504.png","guide/i/1382.png","guide/i/1559.png","guide/i/262.png","guide/i/263.png","guide/i/264.png","guide/i/265.png","guide/i/266.png","guide/i/267.png","guide/i/268.png","guide/i/269.png","guide/i/271.png","guide/i/276.png","guide/i/277.png","guide/i/278.png","guide/i/281.png","guide/i/282.png","guide/i/284.png","guide/i/315.png","guide/i/331.png","guide/i/332.png","guide/i/333.png","guide/i/337.png","guide/i/338.png","guide/i/339.png","guide/i/340.png","guide/i/341.png","guide/i/344.png","guide/i/345.png","guide/i/347.png","guide/i/352.png","guide/i/366.png","guide/i/367.png","guide/i/368.png","guide/i/369.png","guide/i/370.png","guide/i/371.png","guide/i/372.png","guide/i/373.png","guide/i/374.png","guide/i/375.png","guide/i/377.png","guide/i/378.png","guide/i/379.png","guide/i/380.png","guide/i/381.png","guide/i/389.png","guide/i/390.png","guide/i/391.png","guide/i/392.png","guide/i/393.png","guide/i/394.png","guide/i/395.png","guide/i/396.png","guide/i/397.png","guide/i/398.png","guide/i/399.png","guide/i/400.png","guide/i/401.png","guide/i/402.png","guide/i/403.png","guide/i/404.png","guide/i/405.png","guide/i/406.png","guide/i/407.png","guide/i/408.png","guide/i/409.png","guide/i/410.png","guide/i/411.png","guide/i/412.png","guide/i/413.png","guide/i/414.png","guide/i/415.png","guide/i/416.png","guide/i/417.png","guide/i/418.png","guide/i/419.png","guide/i/420.png","guide/i/421.png","guide/i/422.png","guide/i/423.png","guide/i/543.png","guide/i/544.png","guide/i/550.png","guide/i/563.png","guide/i/564.png","guide/i/565.png","guide/i/566.png","guide/i/599.png","guide/i/600.png","guide/i/601.png","guide/i/602.png","guide/i/603.png","guide/i/604.png","guide/i/605.png","guide/i/608.png","guide/i/609.png","guide/i/610.png","guide/i/612.png","guide/i/7356.png","guide/i/7361.png","guide/i/7366.png","guide/i/7371.png","guide/i/7376.png","guide/i/7381.png","guide/i/7386.png","guide/i/7401.png","guide/i/7406.png","guide/i/7411.png","guide/i/751.png","guide/i/767.png","guide/i/805.png","guide/i/833.png","guide/i/861.png","guide/index.html","guide/p/animal-bluegill.html","guide/p/animal-butterfly.html","guide/p/animal-cardinal.html","guide/p/animal-crossbill.html","guide/p/animal-duck.html","guide/p/animal-frog.html","guide/p/animal-green-darner.html","guide/p/animal-heron.html","guide/p/animal-kingfisher.html","guide/p/animal-painted-turtle.html","guide/p/animal-parakeet.html","guide/p/animal-rabbit.html","guide/p/animal-robin.html","guide/p/animal-songbird.html","guide/p/animal-trumpeter-swan.html","guide/p/bench.html","guide/p/bin.html","guide/p/climber-creeper.html","guide/p/climber-honeysuckle.html","guide/p/climber-rose.html","guide/p/coaster-bobsled.html","guide/p/coaster-boomerang.html","guide/p/coaster-family.html","guide/p/coaster-inverted.html","guide/p/coaster-invertedimpulse.html","guide/p/coaster-logflume.html","guide/p/coaster-looper.html","guide/p/coaster-mine.html","guide/p/coaster-mouse.html","guide/p/coaster-swinging.html","guide/p/coaster-wooden.html","guide/p/fence-hedge.html","guide/p/fence-picket.html","guide/p/fence-stone.html","guide/p/fence-wooden.html","guide/p/fountain.html","guide/p/gu-credits.html","guide/p/gu-decisions.html","guide/p/gu-differs.html","guide/p/gu-glossary.html","guide/p/gu-numbers.html","guide/p/gu-pictures.html","guide/p/gu-references.html","guide/p/gu-whats.html","guide/p/guest-crowds.html","guide/p/guest-energy.html","guide/p/guest-hunger.html","guide/p/guest-mood.html","guide/p/guest-nausea.html","guide/p/guest-say.html","guide/p/guest-thirst.html","guide/p/guest-toilet.html","guide/p/house-fun.html","guide/p/house-haunted.html","guide/p/howto-banks.html","guide/p/howto-block-brakes.html","guide/p/howto-breakdowns.html","guide/p/howto-coaster.html","guide/p/howto-crowds.html","guide/p/howto-doors.html","guide/p/howto-flat-ride.html","guide/p/howto-food-court.html","guide/p/howto-lift.html","guide/p/howto-litter.html","guide/p/howto-path.html","guide/p/howto-plants.html","guide/p/howto-queue.html","guide/p/howto-ratings.html","guide/p/howto-second.html","guide/p/howto-test.html","guide/p/howto-tunnel.html","guide/p/lamp.html","guide/p/maze-year.html","guide/p/music-calypso.html","guide/p/music-chiptune.html","guide/p/music-gamelan.html","guide/p/music-hoedown.html","guide/p/music-jazz.html","guide/p/music-jig.html","guide/p/music-organ.html","guide/p/music-park.html","guide/p/music-shanty.html","guide/p/music-songs.html","guide/p/music-stars.html","guide/p/music-waltz.html","guide/p/nature-animals.html","guide/p/nature-habitats.html","guide/p/nature-seasons.html","guide/p/park-buttons.html","guide/p/park-gate.html","guide/p/park-goals.html","guide/p/park-land.html","guide/p/park-money.html","guide/p/park-new-map.html","guide/p/park-one-hand.html","guide/p/park-rating.html","guide/p/park-ride-numbers.html","guide/p/park-sandbox.html","guide/p/park-trains.html","guide/p/park-view.html","guide/p/path.html","guide/p/plant-birdblind.html","guide/p/plant-birdfeeder.html","guide/p/plant-birdhouse.html","guide/p/plant-bughotel.html","guide/p/plant-bush.html","guide/p/plant-bushbird.html","guide/p/plant-bushheart.html","guide/p/plant-bushrabbit.html","guide/p/plant-buttercups.html","guide/p/plant-cactus.html","guide/p/plant-cattails.html","guide/p/plant-dogwood.html","guide/p/plant-feedingstation.html","guide/p/plant-ferns.html","guide/p/plant-flowersblue.html","guide/p/plant-flowerspink.html","guide/p/plant-flowersred.html","guide/p/plant-flowersviolet.html","guide/p/plant-flowerswhite.html","guide/p/plant-flowersyellow.html","guide/p/plant-gardenfountain.html","guide/p/plant-hutch.html","guide/p/plant-lilypads.html","guide/p/plant-log.html","guide/p/plant-lupines.html","guide/p/plant-mossyboulder.html","guide/p/plant-poppies.html","guide/p/plant-rockcascade.html","guide/p/plant-sunflowers.html","guide/p/plant-tallgrass.html","guide/p/plant-treeblossom.html","guide/p/plant-treecypress.html","guide/p/plant-treepalm.html","guide/p/plant-treepine.html","guide/p/plant-treepoplar.html","guide/p/plant-treeround.html","guide/p/plant-treesmall.html","guide/p/plant-treewillow.html","guide/p/plant-tulips.html","guide/p/queue-tv.html","guide/p/queue.html","guide/p/ride-bumpercars.html","guide/p/ride-carousel.html","guide/p/ride-droptower.html","guide/p/ride-ferriswheel.html","guide/p/ride-flyingsaucers.html","guide/p/ride-magiccarpet.html","guide/p/ride-maze.html","guide/p/ride-pirateship.html","guide/p/ride-teacups.html","guide/p/ride-trampoline.html","guide/p/sign.html","guide/p/staff-entertainer.html","guide/p/staff-handyman.html","guide/p/staff-mechanic.html","guide/p/staff-naturalist.html","guide/p/stall-animalfood.html","guide/p/stall-balloon.html","guide/p/stall-burger.html","guide/p/stall-cashmachine.html","guide/p/stall-coffee.html","guide/p/stall-cottoncandy.html","guide/p/stall-doughnut.html","guide/p/stall-drinks.html","guide/p/stall-friedchicken.html","guide/p/stall-fries.html","guide/p/stall-funnelcake.html","guide/p/stall-hats.html","guide/p/stall-hotdog.html","guide/p/stall-icecream.html","guide/p/stall-lemonade.html","guide/p/stall-pizza.html","guide/p/stall-popcorn.html","guide/p/stall-pretzel.html","guide/p/stall-toffeeapple.html","guide/p/stall-toilets.html","guide/p/table.html","guide/p/wild-asters.html","guide/p/wild-clover.html","guide/p/wild-violets.html"];

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
  // The deploy stamps ?v=<build> on the page's scripts and the wasm; the cache holds each file once, so ignore it.
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) { return hit; }
    return fetch(req).catch(function () {
      // Offline and not saved: a page open falls back to the saved game page.
      if (req.mode === "navigate") {
        return caches.match(url.pathname.indexOf("/guide/") >= 0 ? "guide/index.html" : "index.html");
      }
      return Response.error();
    });
  }));
});
