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

  var api = { scoreSentence: scoreSentence, createAnnouncer: createAnnouncer, connectionText: connectionText, tossLine: tossLine,
    basketballLines: basketballLines };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MatchLogic = api;
})(this);
