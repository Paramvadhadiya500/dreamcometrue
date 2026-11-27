// Cricket toss through the REAL server and database (no page): the server refuses balls before the toss,
// stores the toss (migration 006 allows the event type), and the toss decides who bats first.
const { test, expect } = require("@playwright/test");
const { BASE_URL, RUN, SCORER, openDb, scorerSocket } = require("./helpers");

let n = 0;
const send = (socket, msg) =>
  socket.timeout(10000).emitWithAck("score:action", { id: "e2e-toss-" + RUN + "-" + ++n, ...msg });

test("server: no ball before the toss; the toss is saved and decides who bats; no second toss", async () => {
  const pool = openDb();
  const id = "e2e-toss-" + RUN;
  try {
    await pool.query(
      `INSERT INTO matches (id, name, sport, config, team_a, team_b, category)
       VALUES ($1, 'E2E toss', 'cricket', $2, 'Red', 'Blue', 'boys')`,
      [id, JSON.stringify({ overs: 12, players: 11, firstBatting: "A", freeHit: true })]
    );
    await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2)", [SCORER, id]);

    const socket = await scorerSocket(BASE_URL);
    try {
      const ball = { matchId: id, type: "ball", data: { runs: 4, extra: null } };
      let ack = await send(socket, ball);
      expect(ack).toEqual({ ok: false, error: "record the toss first" });

      ack = await send(socket, { matchId: id, type: "toss", data: { winner: "A", choice: "bowl", extra: "x" } });
      expect(ack.ok).toBe(true);
      expect(ack.state.needsToss).toBe(false);
      expect(ack.state.toss).toEqual({ winner: "A", choice: "bowl" });

      ack = await send(socket, ball);
      expect(ack.ok).toBe(true);
      expect(ack.state.innings[0].battingTeam).toBe("B");           // Red (A) won and bowls: Blue (B) bats
      expect(ack.state.innings[0].runs).toBe(4);

      ack = await send(socket, { matchId: id, type: "toss", data: { winner: "B", choice: "bat" } });
      expect(ack).toEqual({ ok: false, error: "toss already recorded" });

      // the database keeps only the cleaned toss (no extra fields from the phone)
      const rows = await pool.query("SELECT type, data FROM events WHERE match_id = $1 ORDER BY seq", [id]);
      expect(rows.rows).toEqual([
        { type: "toss", data: { winner: "A", choice: "bowl" } },
        { type: "ball", data: { runs: 4, extra: null, wicket: null } },
      ]);

      // the match details for the student page still work (category from the previous change)
      const meta = await (await fetch(BASE_URL + "/api/match/" + id)).json();
      expect(meta.competition).toBe("Cricket (Boys)");
    } finally {
      socket.close();
    }
  } finally {
    await pool.query("DELETE FROM events WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM match_scorers WHERE match_id = $1", [id]);
    await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    await pool.end();
  }
});
