// Pure logic of the match page (public/match.html). No page, no socket: test.js tests it in Node,
// the page loads it with <script src="/js/match-logic.js">.
(function (root) {
  "use strict";

  function teamName(s, t) { return (t === "A" ? s.teamA : s.teamB) || "Team " + t; }

  // One short sentence a screen reader reads out when the score changes.
  function scoreSentence(s) {
    var A = teamName(s, "A"), B = teamName(s, "B");
    var text;
    if (s.sport === "cricket" && s.needsToss) {
      text = A + " against " + B + ". Waiting for the toss.";
    } else if (s.sport === "cricket") {
      var ci = s.innings[s.inning - 1];
      text = teamName(s, ci.battingTeam) + " " + ci.runs + " for " + ci.wickets + " after " + ci.overs + " overs.";
      if (s.toss && s.inning === 1 && ci.recent.length === 0) text = tossLine(s) + ". " + text;   // before the first ball
      if (s.inning === 2 && s.status !== "finished") text += " Need " + s.need + " from " + s.ballsLeft + " balls.";
      if (s.freeHit) text += " Free hit.";
    } else if (s.sport === "table_tennis") {
      text = "Games: " + A + " " + s.gamesA + ", " + B + " " + s.gamesB + ". Current game: " + s.pointsA + " to " + s.pointsB + ".";
    } else if (s.sport === "volleyball") {
      text = "Sets: " + A + " " + s.setsA + ", " + B + " " + s.setsB + ". " +
        (s.isDeciding ? "Deciding set" : "Set " + s.currentSet) + ": " + s.pointsA + " to " + s.pointsB + ".";
    } else if (s.sport === "basketball") {
      text = A + " " + s.scoreA + ", " + B + " " + s.scoreB + "." + (s.status === "finished" ? "" : " " + s.periodName + ".");
    } else if (s.sport === "kabaddi") {
      var banner = kabaddiBanner(s);
      text = A + " " + s.scoreA + ", " + B + " " + s.scoreB + "." + (s.status === "finished" ? "" : " " + (banner || s.halfName) + ".");
    } else {
      text = A + " " + s.scoreA + ", " + B + " " + s.scoreB + ".";
    }
    if (s.status === "finished") {
      var result = s.resultText || (s.winner === "draw" ? "Draw" : teamName(s, s.winner) + " won");
      text = "Match finished. " + result + ". " + text;
    }
    return text;
  }

  // Throttle for the screen-reader announcements: at most ONE sentence per minGapMs, and the NEWEST wins.
  //   - the first sentence (or one after a quiet time) is said at once;
  //   - sentences that come sooner wait; when the gap is over, only the last of them is said ("trailing");
  //   - a sentence equal to the one said last is not said again.
  // Clock and timer are passed in, so test.js can drive them.
  function createAnnouncer(opts) {
    var minGap = opts.minGapMs, now = opts.now, setTimer = opts.setTimer, say = opts.say;
    var lastAt = -Infinity, lastText = null, pending = null, timer = null;

    function sayNow(text) {
      if (text === lastText) return;                              // same as said last: say nothing, start no new gap
      lastAt = now();
      lastText = text;
      say(text);
    }
    function flush() {
      timer = null;
      var text = pending;
      pending = null;
      if (text !== null) sayNow(text);
    }
    return function announce(text) {
      if (timer === null && text === lastText) return;            // nothing new to say
      if (timer === null && now() - lastAt >= minGap) { sayNow(text); return; }
      pending = text;                                             // wait; the newest text wins
      if (timer === null) timer = setTimer(flush, Math.max(0, lastAt + minGap - now()));
    };
  }

  // Text of the connection bar at the top ("" = no bar).
  //   offline:   the phone says it has no network (window "offline" event)
  //   problem:   the live connection is down or could not be made (socket "disconnect" / "connect_error")
  //   lastScore: time of the last score shown, e.g. "14:05:12" (null = no score yet)
  function connectionText(offline, problem, lastScore) {
    var age = lastScore ? " The score below is from " + lastScore + "." : "";
    if (offline) return "No internet connection." + age;
    if (!problem) return "";
    if (!lastScore) return "Cannot reach the server. Trying again...";
    return "Reconnecting..." + age;
  }

  // Cricket toss line: "Waiting for the toss", "ECE won the toss and chose to bowl", or "" (old match without a toss).
  function tossLine(s) {
    if (s.needsToss) return "Waiting for the toss";
    if (!s.toss) return "";
    return teamName(s, s.toss.winner) + " won the toss and chose to " + s.toss.choice;
  }

  // Basketball board lines: the quarter being played now ("Quarter 2 (7 min)", null when finished)
  // and the points scored in each finished quarter / overtime ("Q1 12-10, Q2 8-9, OT1 4-2").
  function basketballLines(s) {
    var parts = (s.periods || []).map(function (p, i) { return (i < 4 ? "Q" + (i + 1) : "OT" + (i - 3)) + " " + p[0] + "-" + p[1]; });
    return {
      current: s.status === "finished" ? null : s.periodName + " (" + s.periodMinutes + " min)",
      history: parts.join(", "),
    };
  }

  // Kabaddi: the banner over the score ("HALF TIME", "TIMEOUT: CSE", "BREAK: Rain delay", the tie-break; "" = none)
  function kabaddiBanner(s) {
    var b = s.breakNow;
    if (s.needsTiebreak) return "Level after 2 halves: tie-break";
    if (!b) return "";
    if (b.kind === "half_time") return "HALF TIME";
    if (b.kind === "timeout") return "TIMEOUT: " + teamName(s, b.team);
    if (b.kind === "other") return "BREAK: " + b.text;
    return "";
  }

  var KB_MOMENTS = { super_raid: "SUPER RAID", super_tackle: "SUPER TACKLE", all_out: "ALL OUT", technical: "Technical point" };
  function dots(n, max) {
    var t = "";
    for (var i = 0; i < max; i++) t += i < n ? "●" : "○";
    return t;
  }

  // "CSE +3 (2 out + bonus)"; an old saved state without points: just "CSE"
  function momentWho(s, h) {
    var t = teamName(s, h.team);
    if (typeof h.points !== "number") return t;
    t += " +" + h.points;
    if (h.kind === "super_raid" && typeof h.out === "number") {
      var how = [];
      if (h.out > 0) how.push(h.out + " out");
      if (h.bonus) how.push("bonus");
      t += " (" + how.join(" + ") + ")";
    }
    return t;
  }

  // "ECE: 3 on court - SUPER TACKLE on!": a tackle by a team with 3 or fewer is worth 2; 1 left = close to ALL OUT
  function dangerLines(s) {
    if (s.status === "finished" || s.needsTiebreak) return [];
    var out = [];
    ["A", "B"].forEach(function (t) {
      var n = t === "A" ? s.onCourtA : s.onCourtB;
      if (n === 1) out.push(teamName(s, t) + ": last player on court - ALL OUT danger, SUPER TACKLE on!");
      else if (n >= 2 && n <= 3) out.push(teamName(s, t) + ": " + n + " on court - SUPER TACKLE on!");
    });
    return out;
  }

  // points by type: [label, A, B] rows; "Corrections" only when there is one; none before the first point
  function pointsTable(s) {
    var b = s.pointsBy;
    if (!b || !b.A || !b.B || s.scoreA + s.scoreB === 0) return [];
    var rows = [["Raid", b.A.raid, b.B.raid], ["Tackle", b.A.tackle, b.B.tackle], ["All out", b.A.allOut, b.B.allOut],
      ["Technical", b.A.technical, b.B.technical]];
    if (b.A.correction || b.B.correction) rows.push(["Corrections", b.A.correction, b.B.correction]);
    return rows;
  }

  // Kabaddi board: the half now ("Half 1 (15 min)", null when finished or at the tie-break), finished halves
  // ("H1 12-9"), the banner, players on court (number + dots), the danger line, points by type,
  // the big moments with their points (newest first, at most 6).
  function kabaddiLines(s) {
    var max = s.players || 7;
    var moments = (s.highlights || []).slice(0, 6).map(function (h) {
      return (KB_MOMENTS[h.kind] || h.kind) + " · " + momentWho(s, h) + " · H" + h.half + " · " + h.scoreA + "-" + h.scoreB;
    });
    return {
      current: s.status === "finished" || s.needsTiebreak ? null : s.halfName + " (" + s.halfMinutes + " min)",
      history: (s.halves || []).map(function (h, i) { return "H" + (i + 1) + " " + h[0] + "-" + h[1]; }).join(", "),
      banner: kabaddiBanner(s),
      courtA: s.onCourtA, courtB: s.onCourtB,
      dotsA: dots(s.onCourtA, max), dotsB: dots(s.onCourtB, max),
      danger: dangerLines(s),
      table: pointsTable(s),
      moments: moments,
    };
  }

  // The big pop-up over the score: the moments that are NEW in "next" compared with "prev", e.g.
  // "SUPER RAID + ALL OUT! CSE +7". null = nothing to show: the page just opened (prev null), the same state
  // came again (reconnect), an UNDO took a moment away, or a normal raid.
  var KB_POP = { super_raid: "SUPER RAID", super_tackle: "SUPER TACKLE", all_out: "ALL OUT", technical: "TECHNICAL POINT" };
  function momentKey(h) { return [h.kind, h.team, h.half, h.scoreA, h.scoreB].join("|"); }
  function kabaddiPop(prev, next) {
    if (!prev || !next || next.sport !== "kabaddi") return null;
    var seen = {};
    (prev.highlights || []).forEach(function (h) { seen[momentKey(h)] = true; });
    var fresh = [];
    var list = next.highlights || [];
    for (var i = 0; i < list.length && !seen[momentKey(list[i])]; i++) fresh.unshift(list[i]);   // oldest first
    if (fresh.length === 0) return null;
    var points = 0;
    fresh.forEach(function (h) { points += typeof h.points === "number" ? h.points : 0; });
    var last = fresh[fresh.length - 1];
    return fresh.map(function (h) { return KB_POP[h.kind] || h.kind; }).join(" + ") + "! " + teamName(next, last.team) + (points ? " +" + points : "");
  }

  var api = { scoreSentence: scoreSentence, createAnnouncer: createAnnouncer, connectionText: connectionText, tossLine: tossLine,
    basketballLines: basketballLines, kabaddiLines: kabaddiLines, kabaddiPop: kabaddiPop };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatchLogic = api;
})(this);
