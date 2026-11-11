// Scorer phone queue: every tap becomes an entry; entries are sent one by one, in order.
// Pure logic (no network, no page): storage and clock are passed in, so test.js can test it in Node.
// Rules:
//  - an entry keeps the SAME id on every retry (the server ignores a repeat, so nothing counts twice)
//  - no answer / "retry" answer -> try again after 2, 4, 8, 16, 30, 30... s
//  - only a clear { ok:false } (without retry) stops an entry; it moves to the "rejected" list,
//    which stays on screen until the scorer taps "OK, I saw it"
//  - nothing is ever thrown away to make room: at maxSize new taps are refused instead
//  - 20 server "retry" answers in a row for the first entry = "stuck": the scorer may skip it (it is listed)
//  - entries remember who made them; another scorer's entries are not sent under this login
// Storage keys: "scorer-queue" (same key and item shape as the older page, so a rollback keeps entries)
// and "scorer-rejected".
(function (root) {
  "use strict";

  var QUEUE_KEY = "scorer-queue";
  var REJECTED_KEY = "scorer-rejected";
  var REJECTED_KEEP = 20;

  function createQueue(opts) {
    var storage = opts.storage;
    var now = opts.now || Date.now;
    var random = opts.random || Math.random;
    var warnAt = opts.warnAt || 50;
    var maxSize = opts.maxSize || 500;
    var stuckAfter = opts.stuckAfter || 20;
    var storageOk = true;

    function read(key) {
      try {
        var v = JSON.parse(storage.getItem(key) || "[]");
        return Array.isArray(v) ? v : [];
      } catch (e) { storageOk = false; return []; }
    }
    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); storageOk = true; }
      catch (e) { storageOk = false; }          // keep working in memory; the page warns the scorer
    }

    var items = read(QUEUE_KEY);
    var rejectedList = read(REJECTED_KEY);
    for (var i = 0; i < items.length; i++) {      // entries saved by the older page have no time
      if (!items[i].firstAt) items[i].firstAt = now();
    }

    function save() { write(QUEUE_KEY, items); }
    function saveRejected() {
      if (rejectedList.length > REJECTED_KEEP) rejectedList = rejectedList.slice(-REJECTED_KEEP);
      write(REJECTED_KEY, rejectedList);
    }
    // entries without a user (older page) belong to whoever is logged in
    function mine(item, user) { return !item.user || item.user === user; }
    function indexOfHead(user) {
      for (var i = 0; i < items.length; i++) if (mine(items[i], user)) return i;
      return -1;
    }
    function reject(item, error) {
      rejectedList.push({
        id: item.id, matchId: item.matchId, type: item.type, team: item.team, value: item.value,
        data: item.data, user: item.user, error: String(error || "rejected"), at: now(),
      });
      saveRejected();
    }

    return {
      // returns { ok:true } or { ok:false, reason:"full" }
      add: function (entry, user) {
        if (items.length >= maxSize) return { ok: false, reason: "full" };
        items.push({
          id: entry.id, matchId: entry.matchId, type: entry.type, team: entry.team, value: entry.value,
          data: entry.data, user: user, firstAt: now(), tries: 0, serverRetries: 0,
        });
        save();
        return { ok: true };
      },

      // the next entry this user should send, or null
      head: function (user) {
        var i = indexOfHead(user);
        return i < 0 ? null : items[i];
      },

      // what goes over the network: only the fields the server knows
      payload: function (item) {
        return { id: item.id, matchId: item.matchId, type: item.type, team: item.team, value: item.value, data: item.data };
      },

      // handle the server's answer for `item`. res = the ack, or null when there was no answer.
      // returns { action: "sent" | "rejected" | "retry" | "ignored", delay?, error? }
      result: function (item, res) {
        var i = -1;
        for (var k = 0; k < items.length; k++) if (items[k].id === item.id) { i = k; break; }
        if (i < 0 || indexOfHead(item.user) !== i) return { action: "ignored" };
        var cur = items[i];

        if (res && res.ok === true) {
          items.splice(i, 1);
          save();
          return { action: "sent", duplicate: !!res.duplicate };
        }
        if (res && res.ok === false && !res.retry) {
          items.splice(i, 1);
          save();
          reject(cur, res.error);
          return { action: "rejected", error: String(res.error || "rejected") };
        }
        // no answer, an unclear answer, or the server asked to try again later
        cur.tries = (cur.tries || 0) + 1;
        if (res && res.retry) cur.serverRetries = (cur.serverRetries || 0) + 1;
        save();
        var base = Math.min(30000, 2000 * Math.pow(2, cur.tries - 1));
        return { action: "retry", delay: Math.round(base * (1 + 0.2 * random())) };
      },

      status: function (user) {
        var waiting = 0, oldest = null, others = {};
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (mine(it, user)) {
            waiting++;
            if (oldest === null || it.firstAt < oldest) oldest = it.firstAt;
          } else {
            others[it.user] = (others[it.user] || 0) + 1;
          }
        }
        var h = this.head(user);
        return {
          waiting: waiting,
          oldestMs: oldest === null ? 0 : now() - oldest,
          tries: h ? h.tries || 0 : 0,
          stuck: !!h && (h.serverRetries || 0) >= stuckAfter,
          warn: waiting >= warnAt,
          full: items.length >= maxSize,
          others: others,
          storageOk: storageOk,
        };
      },

      // the scorer chose to skip a stuck entry: it is NOT counted, and it is listed as such
      skipHead: function (user) {
        var i = indexOfHead(user);
        if (i < 0) return;
        var it = items.splice(i, 1)[0];
        save();
        reject(it, "skipped by the scorer (it could not be sent)");
      },

      rejected: function () { return rejectedList.slice(); },
      ackRejected: function () { rejectedList = []; saveRejected(); },

      // entries of other scorers on this phone: send them under this login, or discard (listed)
      adoptOthers: function (user) {
        for (var i = 0; i < items.length; i++) if (!mine(items[i], user)) items[i].user = user;
        save();
      },
      discardOthers: function (user) {
        var keep = [];
        for (var i = 0; i < items.length; i++) {
          if (mine(items[i], user)) keep.push(items[i]);
          else reject(items[i], "discarded on this phone by " + user + " (not sent)");
        }
        items = keep;
        save();
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { createQueue: createQueue };
  else root.ScorerQueue = { createQueue: createQueue };
})(this);
