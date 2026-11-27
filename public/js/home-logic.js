// Pure logic of the student home page (public/index.html). No page, no network, no timers:
// test.js tests it in Node, the page loads it with <script src="/js/home-logic.js">.
(function (root) {
  "use strict";

  var LIVE_MS = 10000;    // a match is live: scores change, ask every 10 s
  var QUIET_MS = 60000;   // nothing is live: the list rarely changes, ask every 60 s
  var MAX_MS = 60000;     // longest wait after errors
  var JITTER = 0.2;       // every wait is spread by +-20 %

  // How long to wait (ms) before the next /api/home request.
  //   failures: errors in a row (0 = the last request worked)
  //   anyLive:  is at least one match live right now?
  //   random:   a number from 0 to 1 (Math.random() in the page; fixed values in tests)
  // After errors: 10, 20, 40, then 60 s at most (exponential backoff), so a server in trouble
  // is not hammered by every phone every 10 s. The +-20 % (jitter) stops thousands of phones
  // from all asking in the same second, for example right after the server comes back.
  function nextDelay(failures, anyLive, random) {
    var base;
    if (failures > 0) base = Math.min(MAX_MS, LIVE_MS * Math.pow(2, failures - 1));
    else base = anyLive ? LIVE_MS : QUIET_MS;
    return Math.round(base * (1 - JITTER + 2 * JITTER * random));
  }

  // Every field of a match that its card on the home page SHOWS (see card() in index.html).
  // test.js checks that card() reads no other field: a field missing here would mean a card that
  // never updates when that field changes.
  var CARD_FIELDS = ["status", "competition", "stage", "stageLabel", "startTime", "hasTeams", "teamA", "teamB",
                     "name", "venue", "headline", "resultText"];

  // One string for "what this card shows". Same string as last time = the card on screen is still right:
  // the page keeps the same element (keyboard focus and screen-reader position stay). Different = rebuild.
  function cardSignature(m) {
    return JSON.stringify(CARD_FIELDS.map(function (f) { return m[f] === undefined ? null : m[f]; }));
  }

  // "Updated ..." line under the tabs, from the age of the shown data in ms. Rough on purpose
  // (10 s steps, then minutes): the line is redrawn every 5 s, more detail would only flicker.
  function agoText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));      // a clock that jumped back counts as "just now"
    if (s < 10) return "Updated just now";
    if (s < 60) return "Updated " + Math.floor(s / 10) * 10 + " s ago";
    var min = Math.floor(s / 60);
    if (min < 60) return "Updated " + min + " min ago";
    return "Updated over an hour ago";
  }

  var api = { nextDelay: nextDelay, cardSignature: cardSignature, CARD_FIELDS: CARD_FIELDS, agoText: agoText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HomeLogic = api;
})(this);
