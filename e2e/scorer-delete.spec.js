// Deleting a scorer through the REAL server and database (admin API, no page):
// refused while the scorer has a LIVE match; then allowed; their scores stay; their phone is cut off at once.
const { test, expect } = require("@playwright/test");
const { io } = require("socket.io-client");
const { BASE_URL, RUN, ADMIN, PASSWORD, openDb } = require("./helpers");

async function login(username, password) {
  const r = await fetch(BASE_URL + "/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const connect = (token) => new Promise((resolve, reject) => {
  const s = io(BASE_URL, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  s.once("connect", () => resolve(s));
  s.once("connect_error", reject);
});

let n = 0;
const act = (socket, msg) => socket.timeout(10000).emitWithAck("score:action", { id: "e2e-del-" + RUN + "-" + ++n, ...msg });

test("delete a scorer: refused during a live match, then allowed; scores stay; phone cut off", async () => {
  const pool = openDb();
  const name = ("del_" + RUN).slice(0, 20);              // a-z, 0-9, _ ; at most 20 characters
  const live = "e2e-del-live-" + RUN, later = "e2e-del-later-" + RUN;
  const admin = (await login(ADMIN, PASSWORD)).body.token;
  const api = (method, path, body) => fetch(BASE_URL + "/api/admin" + path, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + admin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let socket;
  try {
    // a new scorer, assigned to a match that will go live and to one that never starts
    const created = await (await api("POST", "/users", { username: name })).json();
    expect(created.ok).toBe(true);
    for (const id of [live, later]) {
      await pool.query("INSERT INTO matches (id, name, sport, team_a, team_b) VALUES ($1, $2, 'simple', 'Red', 'Blue')", [id, "Match " + id]);
      await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [name, id]);
    }
    const token = (await login(name, created.password)).body.token;
    socket = await connect(token);
    expect((await act(socket, { matchId: live, type: "point", team: "A", value: 2 })).ok).toBe(true);

    // live match: refused, nothing deleted
    let r = await api("DELETE", "/users/" + name);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe(name + " is scoring a live match (Match " + live + "). Finish it first, or assign another scorer to it.");
    expect((await pool.query("SELECT 1 FROM users WHERE username = $1", [name])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM match_scorers WHERE username = $1", [name])).rowCount).toBe(2);

    // the match is finished: delete works
    expect((await act(socket, { matchId: live, type: "finish" })).ok).toBe(true);
    r = await api("DELETE", "/users/" + name);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, username: name, removedFrom: [later, live].sort() });

    // gone, assignments gone, but the scores and the name in the history stay
    expect((await pool.query("SELECT 1 FROM users WHERE username = $1", [name])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM match_scorers WHERE username = $1", [name])).rowCount).toBe(0);
    const ev = await pool.query("SELECT type, value, by_user FROM events WHERE match_id = $1 ORDER BY seq", [live]);
    expect(ev.rows).toEqual([{ type: "point", value: 2, by_user: name }, { type: "finish", value: null, by_user: name }]);
    const hist = await (await api("GET", "/matches/" + live + "/history")).json();
    expect(hist.rows.map((x) => x.by)).toEqual([name, name]);

    // their phone: the open socket is refused at once, a new login too, and the old token too
    expect(await act(socket, { matchId: later, type: "point", team: "A", value: 1 })).toEqual({ ok: false, error: "not allowed" });
    expect((await login(name, created.password)).status).toBe(401);
    await expect(connect(token)).rejects.toThrow("invalid token");

    // a second delete, an admin account, a bad name: 404 / 400, nothing happens
    expect((await api("DELETE", "/users/" + name)).status).toBe(404);
    expect((await api("DELETE", "/users/" + ADMIN)).status).toBe(404);
    expect((await pool.query("SELECT 1 FROM users WHERE username = $1", [ADMIN])).rowCount).toBe(1);
    expect((await api("DELETE", "/users/Bad%20Name")).status).toBe(400);
  } finally {
    if (socket) socket.close();
    for (const id of [live, later]) {
      await pool.query("DELETE FROM events WHERE match_id = $1", [id]);
      await pool.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
      await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    }
    await pool.query("DELETE FROM users WHERE username = $1", [name]);
    await pool.end();
  }
});
