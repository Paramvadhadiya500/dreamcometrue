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

  var api = { nextDelay: nextDelay };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HomeLogic = api;
})(this);
