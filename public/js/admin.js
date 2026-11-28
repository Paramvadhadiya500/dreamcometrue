// Admin page logic (was the inline <script> in admin.html; moved out so a CSP can forbid inline code).
// A plain script, not a module: its functions stay global, as before. Loaded at the end of <body>.
const $ = (id) => document.getElementById(id);
const SKEY = "admin-session";
let session = JSON.parse(localStorage.getItem(SKEY) || "null");
let overview = { matches: [], users: [], teams: [], competitions: [] };
let editingId = null;

const SPORT_NAMES = { cricket: "Cricket", table_tennis: "Table Tennis", volleyball: "Volleyball", basketball: "Basketball", kabaddi: "Kabaddi", simple: "Other sport" };

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

// ---------- talking to the server ----------
async function api(method, path, body) {
  const r = await fetch("/api/admin" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch (e) { /* no body */ }
  if (r.status === 401 || r.status === 403) { logout("Session expired. Please log in again."); throw new Error("login required"); }
  if (!r.ok) throw new Error(data.error || "request failed");
  return data;
}

// ---------- login ----------
async function login() {
  $("loginErr").textContent = "";
  try {
    const r = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("u").value.trim(), password: $("p").value }),
    });
    const data = await r.json();
    if (!r.ok) { $("loginErr").textContent = data.error || "login failed"; return; }
    if (data.role !== "admin") { $("loginErr").textContent = "This page is for admins only."; return; }
    session = { token: data.token, username: data.username };
    localStorage.setItem(SKEY, JSON.stringify(session));
    $("p").value = "";
    start();
  } catch (e) {
    $("loginErr").textContent = "Cannot reach the server";
  }
}

function logout(message) {
  localStorage.removeItem(SKEY);
  session = null;
  closeHistory();
  $("app").style.display = "none";
  $("loginBox").style.display = "block";
  $("loginErr").textContent = typeof message === "string" ? message : "";
}

function start() {
  $("loginBox").style.display = "none";
  $("app").style.display = "block";
  $("who").textContent = session.username;
  showTab("matches");
  load();
}

async function load() {
  try {
    overview = await api("GET", "/overview");
    $("pageErr").textContent = "";
    renderAll();
  } catch (e) {
    if (session) $("pageErr").textContent = "Could not load: " + e.message;
  }
}

function showTab(t) {
  $("matchesTab").style.display = t === "matches" ? "block" : "none";
  $("scorersTab").style.display = t === "scorers" ? "block" : "none";
  $("tabMatches").className = t === "matches" ? "on" : "";
  $("tabScorers").className = t === "scorers" ? "on" : "";
}

// ---------- showing the data ----------
const timeFmt = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function renderAll() {
  renderMatches();
  renderScorers();
  fillList("teamList", overview.teams);
  fillList("compList", overview.competitions);
}

function fillList(id, values) {
  const box = $(id);
  box.innerHTML = "";
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    box.appendChild(o);
  }
}

function renderMatches() {
  const box = $("matchList");
  box.textContent = "";
  if (overview.matches.length === 0) box.appendChild(el("p", "No matches yet. Press + New match.", "small"));
  for (const m of overview.matches) {
    const row = el("div", undefined, "row");
    row.appendChild(el("div", m.name, "title"));
    const bits = [SPORT_NAMES[m.sport] || m.sport];
    if (m.category && overview.categories) bits.push(overview.categories[m.category] || m.category);
    if (m.competition) bits.push(m.competition);
    if (m.stage !== "group") bits.push((overview.stages && overview.stages[m.stage]) || m.stage);
    if (m.sport === "cricket" && m.config) bits.push(m.config.overs + " overs");
    if (m.sport === "basketball" && m.config) bits.push("4 x " + m.config.quarterMinutes + " min");
    if (m.sport === "kabaddi" && m.config) bits.push("2 x " + m.config.halfMinutes + " min");
    if (m.teamA) bits.push(m.teamA + " vs " + m.teamB);
    if (m.startTime) bits.push(new Date(m.startTime).toLocaleString([], timeFmt));
    if (m.venue) bits.push(m.venue);
    row.appendChild(el("div", bits.join(" \u00b7 "), "small"));
    if (m.scorers.length) row.appendChild(el("div", "Scorers: " + m.scorers.join(", "), "small"));
    else row.appendChild(el("div", "No scorer assigned", "small warn"));
    row.appendChild(el("div", m.events === 0 ? "Not started" : m.events + " scoring actions", "small"));

    const actions = el("div", undefined, "actions");
    const edit = el("button", "Edit");
    edit.onclick = () => openForm(m);
    const del = el("button", "Delete", "danger");
    del.onclick = () => deleteMatch(m);
    actions.appendChild(edit);
    if (m.events > 0) {
      const hist = el("button", "History");
      hist.onclick = () => openHistory(m);
      actions.appendChild(hist);
    }
    actions.appendChild(del);
    row.appendChild(actions);
    box.appendChild(row);
  }
}

function renderScorers() {
  const box = $("scorerList");
  box.textContent = "";
  const scorers = overview.users.filter((u) => u.role === "scorer");
  if (scorers.length === 0) box.appendChild(el("p", "No scorers yet.", "small"));
  for (const u of scorers) {
    const row = el("div", undefined, "row");
    row.appendChild(el("div", u.username, "title"));
    row.appendChild(el("div", (u.active ? "Active" : "Disabled") + " \u00b7 " + u.matches + " matches", u.active ? "small" : "small warn"));
    const actions = el("div", undefined, "actions");
    const reset = el("button", "New password");
    reset.onclick = () => resetPassword(u.username);
    const toggle = el("button", u.active ? "Disable" : "Enable", u.active ? "danger" : "");
    toggle.onclick = () => setActive(u.username, !u.active);
    const del = el("button", "Delete", "danger");
    del.onclick = () => deleteScorer(u);
    actions.appendChild(reset);
    actions.appendChild(toggle);
    actions.appendChild(del);
    row.appendChild(actions);
    box.appendChild(row);
  }
}

// ---------- the match form ----------
const pad = (n) => String(n).padStart(2, "0");
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function sportChanged() {
  const s = $("fSport").value;
  $("crGroup").style.display = s === "cricket" ? "block" : "none";
  $("ttGroup").style.display = s === "table_tennis" ? "block" : "none";
  $("vbGroup").style.display = s === "volleyball" ? "block" : "none";
  $("bbGroup").style.display = s === "basketball" ? "block" : "none";
  $("kbGroup").style.display = s === "kabaddi" ? "block" : "none";
}

// Basketball: quarter length from the stage (college rule, the table comes from the server; not editable).
function showBasketballHint() {
  const cat = $("fCat").value;
  const minutes = (overview.basketballMinutes || {})[$("fStage").value];
  let hint = minutes ? "College rule: 4 quarters of " + minutes + " minutes (set from the stage)" : "";
  let warn = false;
  if (cat && cat !== "boys" && cat !== "girls") { hint = "Basketball is only for Student Boys and Student Girls"; warn = true; }
  $("bbHint").textContent = hint;
  $("bbHint").className = warn ? "small warn" : "small";
}

// Kabaddi: half length from the category and the stage (college rule, the table comes from the server; not editable).
function showKabaddiHint() {
  const cat = $("fCat").value;
  const table = overview.kabaddiMinutes || {};
  const minutes = table[cat] ? table[cat][$("fStage").value] : null;
  let hint = minutes ? "College rule: 2 halves of " + minutes + " minutes (set from the category and stage)" : "";
  let warn = false;
  if (cat && cat !== "boys" && cat !== "girls") { hint = "Kabaddi is only for Student Boys and Student Girls"; warn = true; }
  $("kbHint").textContent = hint;
  $("kbHint").className = warn ? "small warn" : "small";
}

// College rule: the overs come from the category and the stage (the table comes from the server).
// Only fills the box when the admin changes sport, category or stage; the admin can still type another number.
function collegeRule() {
  const table = overview.collegeOvers || {};
  const cat = $("fCat").value;
  return table[cat] ? table[cat][$("fStage").value] || null : null;
}

function showOversHint() {
  const cat = $("fCat").value;
  const rule = collegeRule();
  let hint = "";
  if ($("fSport").value === "cricket") {
    if (rule) hint = "College rule: " + rule + " overs";
    else if (cat) hint = "Cricket is only for Student Boys, Student Girls and Male Faculty";
  }
  $("oversHint").textContent = hint;
  $("oversHint").className = rule || !cat ? "small" : "small warn";
  showBasketballHint();
  showKabaddiHint();
}

function fillCollegeOvers() {
  const rule = collegeRule();
  if (rule && $("fSport").value === "cricket" && !$("fOvers").disabled) $("fOvers").value = rule;
  showOversHint();
}

function openForm(m) {
  editingId = m ? m.id : null;
  $("formTitle").textContent = m ? "Edit match" : "New match";
  $("fErr").textContent = "";
  $("fSport").value = m ? m.sport : "cricket";
  $("fComp").value = m ? m.competition : "";
  $("fTeamA").value = m ? m.teamA : "";
  $("fTeamB").value = m ? m.teamB : "";
  $("fTime").value = m ? toLocalInput(m.startTime) : "";
  $("fVenue").value = m ? m.venue : "";
  $("fCat").value = m ? m.category || "" : "";
  // an old match can have stage "knockout", which the list no longer offers: add it so saving keeps it
  const stage = m ? m.stage : "group";
  if (![...$("fStage").options].some((o) => o.value === stage)) {
    const o = document.createElement("option");
    o.value = stage;
    o.textContent = (overview.stages && overview.stages[stage]) || stage;
    $("fStage").appendChild(o);
  }
  $("fStage").value = stage;
  $("fName").value = m ? m.name : "";
  const c = m && m.sport === "cricket" ? m.config : { overs: 12, players: 11, firstBatting: "A", freeHit: true };
  $("fOvers").value = c.overs;
  $("fPlayers").value = c.players;
  $("fFree").value = String(c.freeHit);
  $("fBest").value = String(m ? m.bestOf : 3);
  $("fVbBest").value = String(m && m.sport === "volleyball" ? m.config.bestOf : 3);
  sportChanged();

  const locked = !!(m && m.events > 0);
  $("lockNote").style.display = locked ? "block" : "none";
  for (const id of ["fSport", "fOvers", "fPlayers", "fFree", "fBest", "fVbBest"]) $(id).disabled = locked;
  showOversHint();                     // an existing match keeps its saved overs; only the hint is shown

  const box = $("fScorers");
  box.textContent = "";
  const scorers = overview.users.filter((u) => u.role === "scorer");
  if (scorers.length === 0) box.appendChild(el("span", "No scorers yet. Create them in the Scorers tab.", "small"));
  for (const u of scorers) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = u.username;
    cb.checked = !!(m && m.scorers.includes(u.username));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + u.username + (u.active ? "" : " (disabled)")));
    box.appendChild(label);
  }
  $("formBox").style.display = "block";
  $("formBox").scrollIntoView && $("formBox").scrollIntoView({ block: "start" });
}

function closeForm() {
  $("formBox").style.display = "none";
  editingId = null;
}

function readForm() {
  const sport = $("fSport").value;
  const body = {
    sport,
    competition: $("fComp").value,
    category: $("fCat").value,
    stage: $("fStage").value,
    teamA: $("fTeamA").value,
    teamB: $("fTeamB").value,
    venue: $("fVenue").value,
    name: $("fName").value,
    startTime: $("fTime").value ? new Date($("fTime").value).toISOString() : null,
    scorers: [...document.querySelectorAll("#fScorers input:checked")].map((c) => c.value),
  };
  if (sport === "cricket") {
    body.config = {
      overs: parseInt($("fOvers").value, 10),
      players: parseInt($("fPlayers").value, 10),
      // who bats first comes from the toss (recorded by the scorer); "A" is only the fallback for old matches.
      // An existing match keeps its saved value, so editing it never changes its settings.
      firstBatting: editingId ? (overview.matches.find((x) => x.id === editingId) || { config: {} }).config.firstBatting || "A" : "A",
      freeHit: $("fFree").value === "true",
    };
  }
  if (sport === "table_tennis") body.bestOf = parseInt($("fBest").value, 10);
  if (sport === "volleyball") body.config = { bestOf: parseInt($("fVbBest").value, 10) };
  return body;
}

async function saveForm() {
  $("fErr").textContent = "";
  $("fSave").disabled = true;
  try {
    const body = readForm();
    // a new match must have a category (old matches without one can still be edited)
    if (!editingId && !body.category) throw new Error("Choose a category");
    if (editingId) await api("PUT", "/matches/" + encodeURIComponent(editingId), body);
    else await api("POST", "/matches", body);
    closeForm();
    await load();
  } catch (e) {
    $("fErr").textContent = e.message;
  } finally {
    $("fSave").disabled = false;
  }
}

async function deleteMatch(m) {
  if (!confirm('Delete "' + m.name + '"?')) return;
  let body;
  if (m.events > 0) {
    const word = prompt("This match has " + m.events + " scoring actions. They will be deleted too.\nType DELETE to continue.");
    if (word !== "DELETE") return;
    body = { confirm: "DELETE" };
  }
  try {
    await api("DELETE", "/matches/" + encodeURIComponent(m.id), body);
    if (editingId === m.id) closeForm();
    if (historyMatch && historyMatch.id === m.id) closeHistory();
    await load();
  } catch (e) {
    $("pageErr").textContent = e.message;
  }
}

// ---------- score history of one match (read-only) ----------
let historyMatch = null;
const histFmt = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" };
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function openHistory(m) {
  historyMatch = { id: m.id, name: m.name };
  $("historyTitle").textContent = "History: " + m.name;
  $("historySummary").textContent = "Loading...";
  $("historyList").textContent = "";
  $("historyErr").textContent = "";
  $("historyBox").style.display = "block";
  $("historyBox").scrollIntoView && $("historyBox").scrollIntoView({ block: "start" });
  loadHistory();
}

function closeHistory() {
  $("historyBox").style.display = "none";
  $("historyList").textContent = "";
  historyMatch = null;
}

async function loadHistory() {
  if (!historyMatch) return;
  const asked = historyMatch.id;
  $("historyErr").textContent = "";
  $("historyRefresh").disabled = true;
  try {
    const h = await api("GET", "/matches/" + encodeURIComponent(asked) + "/history");
    if (!historyMatch || historyMatch.id !== asked) return;       // closed or another match opened meanwhile
    renderHistory(h);
    load();                                                        // keep the "N scoring actions" counts on the cards in step
  } catch (e) {
    $("historyErr").textContent = "Could not load the history: " + e.message;
  } finally {
    $("historyRefresh").disabled = false;
  }
}

function renderHistory(h) {
  const perScorer = {};
  let undone = 0;
  for (const r of h.rows) {
    perScorer[r.by] = (perScorer[r.by] || 0) + 1;
    if (r.undone) undone++;
  }
  const who = Object.entries(perScorer).sort((a, b) => b[1] - a[1]).map(([u, n]) => u + " " + n).join(", ");
  let summary = h.total + (h.total === 1 ? " action" : " actions");
  if (who) summary += " · " + who;
  summary += " · " + undone + " undone";
  if (h.truncated) summary += " · showing only the first " + h.rows.length;
  $("historySummary").textContent = summary;

  const bySeq = {};
  for (const r of h.rows) bySeq[r.seq] = r;
  const box = $("historyList");
  box.textContent = "";
  if (h.rows.length === 0) box.appendChild(el("p", "No scoring actions yet.", "small"));
  for (const r of h.rows) {
    const row = el("div", undefined, "hrow" + (r.undone ? " undone" : "") + (r.type === "undo" ? " undo" : ""));
    row.appendChild(el("div", new Date(r.at).toLocaleString([], histFmt) + " · " + r.by, "small"));
    const what = el("div", r.text, "what");
    if (r.undone) {
      const by = bySeq[r.undoneBySeq];
      what.appendChild(el("span", "undone" + (by ? " at " + clock(by.at) : ""), "tag"));
    }
    if (r.type === "undo" && bySeq[r.undoesSeq]) what.appendChild(el("span", "action from " + clock(bySeq[r.undoesSeq].at), "tag"));
    row.appendChild(what);
    if (r.after) row.appendChild(el("div", "Score after: " + r.after, "small"));
    box.appendChild(row);
  }
}

// ---------- scorers ----------
function showSecret(who, password) {
  const box = $("secret");
  box.textContent = "";
  const d = el("div", undefined, "good");
  d.appendChild(el("div", "Password for " + who + ":"));
  d.appendChild(el("b", password));
  d.appendChild(el("div", "Copy it now. It is shown only once.", "small"));
  box.appendChild(d);
}

async function createScorer() {
  $("newErr").textContent = "";
  try {
    const r = await api("POST", "/users", { username: $("newUser").value.trim() });
    $("newUser").value = "";
    showSecret(r.username, r.password);
    await load();
  } catch (e) {
    $("newErr").textContent = e.message;
  }
}

async function resetPassword(username) {
  if (!confirm("Make a new password for " + username + "? The old one stops working.")) return;
  try {
    const r = await api("POST", "/users/" + encodeURIComponent(username) + "/reset");
    showSecret(r.username, r.password);
    await load();
  } catch (e) {
    $("newErr").textContent = e.message;
  }
}

// The server refuses while the scorer is assigned to a live match (the message says which one).
async function deleteScorer(u) {
  const assigned = u.matches > 0
    ? " They are assigned to " + u.matches + (u.matches === 1 ? " match" : " matches") + " (they will be removed from " + (u.matches === 1 ? "it" : "them") + ")."
    : "";
  if (!confirm("Delete scorer " + u.username + "?" + assigned + "\nScores they entered stay in the history. This cannot be undone.")) return;
  $("newErr").textContent = "";
  try {
    await api("DELETE", "/users/" + encodeURIComponent(u.username));
    // a password still shown for THIS scorer is useless now (one shown for another scorer stays)
    if ($("secret").textContent.includes("Password for " + u.username + ":")) $("secret").textContent = "";
    await load();
  } catch (e) {
    $("newErr").textContent = e.message;
  }
}

async function setActive(username, active) {
  try {
    await api("POST", "/users/" + encodeURIComponent(username) + "/active", { active });
    await load();
  } catch (e) {
    $("newErr").textContent = e.message;
  }
}

// ---------- buttons (were onclick="..." / onchange="..." attributes in admin.html; a CSP blocks those) ----------
// Wrapped in () => ... so each function gets the same arguments as before, not the click event.
$("loginBtn").addEventListener("click", () => login());
$("logoutBtn").addEventListener("click", () => logout());
$("tabMatches").addEventListener("click", () => showTab("matches"));
$("tabScorers").addEventListener("click", () => showTab("scorers"));
$("newBtn").addEventListener("click", () => openForm(null));
$("fSport").addEventListener("change", () => { sportChanged(); fillCollegeOvers(); });
$("fCat").addEventListener("change", () => fillCollegeOvers());
$("fStage").addEventListener("change", () => fillCollegeOvers());
$("fSave").addEventListener("click", () => saveForm());
$("formCancel").addEventListener("click", () => closeForm());
$("historyRefresh").addEventListener("click", () => loadHistory());
$("historyClose").addEventListener("click", () => closeHistory());
$("createBtn").addEventListener("click", () => createScorer());

if (session) start(); else $("loginBox").style.display = "block";
