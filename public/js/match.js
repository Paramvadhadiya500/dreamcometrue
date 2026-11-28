const $ = (id) => document.getElementById(id);
const matchId = new URLSearchParams(location.search).get("id");
if (!matchId) location.replace("/");

const socket = io();
let latest = 0;                          // newest version seen for this match

const teamName = (s, t) => (t === "A" ? s.teamA : s.teamB) || "Team " + t;

// ---------- connection bar ----------
// Text from MatchLogic.connectionText (tested in test.js). The bar has role="status": screen readers
// read it out. Empty = no problem: it takes no space but stays in the page (so the next message is read).
let offline = false;                     // the phone says it has no network ("offline" event)
let problem = false;                     // the live connection is down or could not be made
let lastScore = null;                    // time the last score arrived, e.g. "14:05:12"
const timeOfDay = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
function showConn() {
  $("conn").textContent = MatchLogic.connectionText(offline, problem, lastScore);
}

function join() { if (matchId) socket.emit("join-match", matchId); }
socket.on("connect", () => { problem = false; showConn(); join(); });
socket.on("disconnect", () => { problem = true; showConn(); });
// The server cannot be reached. This also happens when the page OPENS while the server is down:
// without this the page said "Loading..." forever. Socket.IO keeps trying again by itself.
socket.on("connect_error", () => { problem = true; showConn(); });

// Reconnect at once when it can work again, instead of waiting for Socket.IO's next try (up to ~5 s), and
// also when Socket.IO gave up on its own (a connection closed while the phone slept). connect() does
// nothing harmful when a connection is already being made.
function reconnectNow() { if (!socket.connected) socket.connect(); }
// The phone's network: "offline" says so at once (the live connection notices only after its heartbeat
// runs out, up to ~45 s); "online" tries again at once. navigator.onLine can say "online" on Wi-Fi
// without internet, so it is only a hint: the bar for that case comes from the socket itself.
window.addEventListener("offline", () => { offline = true; showConn(); });
window.addEventListener("online", () => { offline = false; showConn(); reconnectNow(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnectNow(); });

// Put a score number on the page. If it really changed (and it is not the first score after opening),
// it flashes once. Same number again (a repeated or newer update with the same score): nothing happens.
let firstScore = true;
function setNum(id, value) {
  const e = $(id);
  const text = String(value);
  if (e.textContent === text) return;
  e.textContent = text;
  if (firstScore) return;
  e.classList.remove("bump");
  void e.offsetWidth;                    // the browser must see the class gone, or the animation would not play again
  e.classList.add("bump");
}
// When the flash ends (or is stopped), take the class away again. But the "stopped" event of an OLD flash
// arrives a moment AFTER a new flash has started (a number that changed twice quickly): so only remove the
// class when no animation is running on the element any more.
function endFlash(x) {
  if (x.target.getAnimations().length === 0) x.target.classList.remove("bump");
}
for (const id of ["sA", "sB", "pA", "pB", "crBig"]) {
  $(id).addEventListener("animationend", endFlash);
  $(id).addEventListener("animationcancel", endFlash);
}

// Screen readers: "CSE 3, ECE 1." when the score changes, at most one sentence per 8 s, the newest wins
// (MatchLogic in public/js/match-logic.js, tested in test.js). Nothing for the first score after opening
// (the page itself is read then) and nothing when the score did not change (e.g. resent after a reconnect).
const announce = MatchLogic.createAnnouncer({
  minGapMs: 8000,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  say: (text) => { $("announcer").textContent = text; },
});
let lastSentence = null;

// "CSE won", "Draw", or the engine's own text (cricket: "CSE won by 5 runs")
function resultText(s) {
  if (s.resultText) return s.resultText;
  if (s.winner === "draw") return "Draw";
  return teamName(s, s.winner) + " won";
}

function showCricket(s) {
  const ci = s.innings[s.inning - 1];
  const first = s.innings[0];
  setNum("crBig", teamName(s, ci.battingTeam) + " " + ci.runs + "/" + ci.wickets);
  $("crOvers").textContent = ci.overs + " / " + s.maxOvers + " overs · Run rate " + ci.runRate.toFixed(2);

  let chase = "";
  if (s.inning === 2 && s.status !== "finished") {
    chase = "Target " + s.target + ". Need " + s.need + " from " + s.ballsLeft + " balls";
    if (s.requiredRate !== null) chase += " (required rate " + s.requiredRate.toFixed(2) + ")";
  }
  $("crChase").textContent = chase;

  $("crFirst").textContent = s.inning === 2
    ? teamName(s, first.battingTeam) + " batted: " + first.runs + "/" + first.wickets + " (" + first.overs + " overs)"
    : "";

  $("crOver").textContent = ci.recent.join("  ");
  $("crFree").hidden = !s.freeHit;
  $("crExtras").textContent = "Extras: " + ci.extras.total +
    " (wides " + ci.extras.wides + ", no balls " + ci.extras.noBalls +
    ", byes " + ci.extras.byes + ", leg byes " + ci.extras.legByes + ")";

  // the toss: "Waiting for the toss" before it, then who won it and what they chose
  $("crToss").textContent = MatchLogic.tossLine(s);
  if (s.needsToss) {
    setNum("crBig", teamName(s, "A") + " vs " + teamName(s, "B"));
    $("crOvers").textContent = s.maxOvers + " overs per innings";
    $("crExtras").textContent = "";
  }
}

socket.on("score:update", (s) => {
  if (s.matchId !== matchId) return;
  if (s.version < latest) return;        // old news, ignore
  latest = s.version;
  lastScore = timeOfDay.format(new Date());

  $("name").textContent = s.name;
  document.title = s.name;
  $("board").hidden = false;
  const finished = s.status === "finished";
  $("status").textContent = finished ? "FINISHED" : "LIVE";
  $("status").className = "pill " + (finished ? "finished" : "live");
  $("result").textContent = finished ? resultText(s) : "";
  $("result").hidden = !finished;

  const isTT = s.sport === "table_tennis";
  const isVB = s.sport === "volleyball";
  const isCR = s.sport === "cricket";
  const isBB = s.sport === "basketball";
  const isKB = s.sport === "kabaddi";
  const isFB = s.sport === "football";
  $("duel").hidden = isCR;
  $("current").hidden = !(isTT || isVB || (isBB && !finished) || (isKB && !finished && !s.needsTiebreak));
  $("history").hidden = !(isTT || isVB || isBB || isKB || isFB);
  $("cricket").hidden = !isCR;
  $("kabaddi").hidden = !isKB;
  $("football").hidden = !isFB;
  if (!isKB && !isFB) $("kbPop").hidden = true;          // the pop-up box is shared by kabaddi and football
  if (!isKB) $("kbRaiding").hidden = true;
  if (!isFB) $("fbPenalty").hidden = true;

  if (isCR) {
    showCricket(s);
  } else if (isBB) {
    showBasketball(s);
  } else if (isKB) {
    showKabaddi(s);
  } else if (isFB) {
    showFootball(s);
  } else {
    showDuel(s, isTT, isVB);
  }
  const sentence = MatchLogic.scoreSentence(s);
  if (!firstScore && sentence !== lastSentence) announce(sentence);
  lastSentence = sentence;
  firstScore = false;
});

function showDuel(s, isTT, isVB) {
  $("nameA").textContent = teamName(s, "A");
  $("nameB").textContent = teamName(s, "B");
  if (isTT || isVB) {
    setNum("sA", isVB ? s.setsA : s.gamesA);
    setNum("sB", isVB ? s.setsB : s.gamesB);
    $("unit").textContent = isVB ? "sets" : "games";
    $("curLabel").textContent = isVB
      ? (s.isDeciding ? "Deciding set, to " + s.target : "Set " + s.currentSet + ", to " + s.target)
      : "Current game";
    setNum("pA", s.pointsA);
    setNum("pB", s.pointsB);
    const done = isVB ? s.finishedSets : s.finishedGames;
    $("history").textContent = done.length ? (isVB ? "Sets: " : "Games: ") + done.map((g) => g.join("-")).join(", ") : "";
  } else {
    setNum("sA", s.scoreA);
    setNum("sB", s.scoreB);
    $("unit").textContent = "";
  }
}

// basketball: total score big, the quarter being played now below it, then the points of each finished quarter
function showBasketball(s) {
  $("nameA").textContent = teamName(s, "A");
  $("nameB").textContent = teamName(s, "B");
  setNum("sA", s.scoreA);
  setNum("sB", s.scoreB);
  $("unit").textContent = "";
  const lines = MatchLogic.basketballLines(s);
  $("curLabel").textContent = lines.current || "";
  setNum("pA", s.currentA);
  setNum("pB", s.currentB);
  $("history").textContent = lines.history;
}

// kabaddi: total score big, the half now (with its points), finished halves, a break banner,
// the players on court of each team, a danger line, points by type, and the big moments
// (super raid, super tackle, all out, technical point) with a big pop-up when one happens
let lastKabaddi = null;                  // the state shown before, to find moments that are NEW
let popTimer = null;
function showPop(text) {
  const e = $("kbPop");
  e.textContent = text;
  e.hidden = false;
  e.classList.remove("kb-pop-in");
  void e.offsetWidth;                    // play the animation again for the next moment
  e.classList.add("kb-pop-in");
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { e.hidden = true; }, 6000);
}

// "●●●○○○○" -> 7 round marks drawn by CSS (the two text symbols have different sizes in many phone fonts)
function showDots(box, text) {
  box.textContent = "";
  for (const ch of text) {
    const d = document.createElement("span");
    d.className = "kb-dot" + (ch === "●" ? " on" : "");
    box.appendChild(d);
  }
}

function showKabaddi(s) {
  // no pop-up for moments that were already there when the page opened
  const pop = firstScore ? null : MatchLogic.kabaddiPop(lastKabaddi, s);
  lastKabaddi = s;
  if (pop) showPop(pop);
  $("nameA").textContent = teamName(s, "A");
  $("nameB").textContent = teamName(s, "B");
  setNum("sA", s.scoreA);
  setNum("sB", s.scoreB);
  $("unit").textContent = "";
  const lines = MatchLogic.kabaddiLines(s);
  $("curLabel").textContent = lines.current || "";
  setNum("pA", s.currentA);
  setNum("pB", s.currentB);
  $("history").textContent = lines.history;
  $("kbBanner").textContent = lines.banner;
  $("kbBanner").hidden = !lines.banner;
  $("kbCourtA").textContent = lines.courtA;
  $("kbCourtB").textContent = lines.courtB;
  showDots($("kbDotsA"), lines.dotsA);
  showDots($("kbDotsB"), lines.dotsB);
  const list = $("kbMoments");
  list.textContent = "";
  for (const m of lines.moments) {
    const li = document.createElement("li");
    li.textContent = m;                    // text only: names typed by the admin can never become HTML
    list.appendChild(li);
  }
  $("kbMomentsTitle").hidden = lines.moments.length === 0;

  const raiding = lines.raiding;
  $("kbRaiding").hidden = !raiding;
  $("kbRaidingTitle").textContent = raiding ? raiding.title : "";
  const badges = $("kbRaidingBadges");
  badges.textContent = "";
  for (const b of raiding ? raiding.badges : []) {
    const span = document.createElement("span");
    span.className = "kb-badge";
    span.textContent = b;
    badges.appendChild(span);
  }

  const danger = $("kbDanger");
  danger.textContent = "";
  for (const d of lines.danger) {
    const p = document.createElement("p");
    p.textContent = d;
    danger.appendChild(p);
  }

  $("kbTable").hidden = lines.table.length === 0;
  $("kbTableA").textContent = teamName(s, "A");
  $("kbTableB").textContent = teamName(s, "B");
  const body = $("kbTableBody");
  body.textContent = "";
  for (const [label, a, b] of lines.table) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    tr.appendChild(th);
    for (const v of [a, b]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

// football: total goals big, the scorers under each team, the half, a banner, "PENALTY TO CSE!" while a penalty
// waits, the shootout kick by kick, every goal / penalty / card (newest first), and a big pop-up for a NEW moment
let lastFootball = null;                 // the state shown before, to find moments that are NEW
function fillList(box, items) {
  box.textContent = "";
  for (const t of items) {
    const li = document.createElement("li");
    li.textContent = t;                  // text only: names typed by the scorer can never become HTML
    box.appendChild(li);
  }
}

function showFootball(s) {
  const pop = firstScore ? null : MatchLogic.footballPop(lastFootball, s);
  lastFootball = s;
  if (pop) showPop(pop);
  const lines = MatchLogic.footballLines(s);
  $("nameA").textContent = teamName(s, "A");
  $("nameB").textContent = teamName(s, "B");
  setNum("sA", s.scoreA);
  setNum("sB", s.scoreB);
  $("unit").textContent = "";
  $("history").textContent = lines.history;
  fillList($("fbGoalsA"), lines.goalsA);
  fillList($("fbGoalsB"), lines.goalsB);
  $("fbGoalsA").setAttribute("aria-label", "Goals " + teamName(s, "A"));
  $("fbGoalsB").setAttribute("aria-label", "Goals " + teamName(s, "B"));
  $("fbPeriod").textContent = lines.period || "";
  $("fbPeriod").hidden = !lines.period;
  $("fbBanner").textContent = lines.banner;
  $("fbBanner").hidden = !lines.banner;
  $("fbPenaltyTitle").textContent = lines.penalty;
  $("fbPenalty").hidden = !lines.penalty;

  const so = lines.shootout;
  $("fbShootout").hidden = !so;
  const rows = $("fbShootRows");
  rows.textContent = "";
  if (so) {
    $("fbShootScore").textContent = so.score;
    $("fbShootNote").textContent = so.note;
    for (const r of so.rows) {
      const row = document.createElement("div");
      row.className = "fb-shoot-row";
      const name = document.createElement("span");
      name.className = "fb-shoot-name";
      name.textContent = r.team;
      const marks = document.createElement("span");
      marks.className = "fb-marks";
      marks.setAttribute("role", "img");
      marks.setAttribute("aria-label", r.label);
      for (const m of r.marks) {
        const d = document.createElement("span");
        d.className = "fb-mark " + (m === "scored" ? "scored" : m === "todo" ? "todo" : "missed");
        marks.appendChild(d);
      }
      row.appendChild(name);
      row.appendChild(marks);
      rows.appendChild(row);
    }
  }

  const list = $("fbEvents");
  list.textContent = "";
  for (const e of lines.events) {
    const li = document.createElement("li");
    if (e.card) {
      const c = document.createElement("span");
      c.className = "fb-card " + e.card;
      c.setAttribute("aria-hidden", "true");
      li.appendChild(c);
    }
    li.appendChild(document.createTextNode(e.text));
    list.appendChild(li);
  }
  $("fbEventsTitle").hidden = lines.events.length === 0;
}

// place, time and competition
async function loadMeta() {
  if (!matchId) return;
  try {
    const r = await fetch("/api/match/" + encodeURIComponent(matchId));
    if (r.status === 404) { $("name").textContent = "Match not found"; return; }
    const m = await r.json();
    const parts = [m.competition];
    if (m.stageLabel) parts.push(m.stageLabel);
    if (m.venue) parts.push(m.venue);
    if (m.startTime) parts.push(new Date(m.startTime).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
    $("meta").textContent = parts.join(" · ");
  } catch (e) { /* the score still works without this line */ }
}
loadMeta();
