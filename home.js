// Builds the data for the student home page (schedule, live scores, results) and the points tables.
// The result is cached for 3 seconds, so thousands of students cost one rebuild, not thousands.
const { buildStandings, competitionOf, POINTS } = require("./standings");

function createHome({ pool, getState, getEngine }) {
  const TTL = 3000;
  let cache = { at: 0, promise: null };

  async function build() {
    const r = await pool.query(
      `SELECT m.id, m.name, m.sport, m.team_a, m.team_b, m.competition, m.stage, m.venue, m.start_time,
              EXISTS (SELECT 1 FROM events e WHERE e.match_id = m.id) AS started
       FROM matches m
       ORDER BY m.start_time ASC NULLS LAST, m.created_at ASC, m.id ASC
       LIMIT 500`
    );

    const forStandings = [];
    const matches = await Promise.all(
      r.rows.map(async (m) => {
        const hasTeams = m.team_a.trim() !== "" && m.team_b.trim() !== "";
        const names = { A: m.team_a.trim() || "Team A", B: m.team_b.trim() || "Team B" };
        const engine = getEngine(m.sport);
        const competition = competitionOf(m);

        let status = "upcoming";
        let headline = "";
        let resultText = "";
        let result = null;

        if (m.started) {
          status = "live";
          let state = null;
          try { state = await getState(m.id); } catch (e) { console.error("home: state failed for", m.id, e.message); }
          if (state && engine) {
            result = engine.result ? engine.result(state) : null;
            headline = engine.headline ? engine.headline(state, names) : "";
            if (state.status === "finished") {
              status = "finished";
              if (state.resultText) resultText = state.resultText;
              else if (result && (result.winner === "A" || result.winner === "B")) resultText = names[result.winner] + " won";
              else if (result && result.winner === "draw") resultText = "Draw";
              else resultText = "No result";
            }
          }
        }

        forStandings.push({ competition: m.competition, sport: m.sport, stage: m.stage, teamA: m.team_a, teamB: m.team_b, result });

        return {
          id: m.id,
          name: m.name,
          sport: m.sport,
          competition,
          stage: m.stage,
          venue: m.venue,
          startTime: m.start_time ? new Date(m.start_time).toISOString() : null,
          hasTeams,
          teamA: names.A,
          teamB: names.B,
          status,
          headline,
          resultText,
        };
      })
    );

    const competitions = [...new Set(matches.map((m) => m.competition))].sort((a, b) => a.localeCompare(b));
    const home = { generatedAt: new Date().toISOString(), matches, competitions };
    const standings = { points: POINTS, competitions: buildStandings(forStandings) };
    // the JSON text is made once here, so thousands of requests only send it
    return { home, standings, homeJson: JSON.stringify(home), standingsJson: JSON.stringify(standings) };
  }

  function get() {
    const now = Date.now();
    if (cache.promise && now - cache.at < TTL) return cache.promise;
    const promise = build();
    cache = { at: now, promise };
    promise.catch(() => { if (cache.promise === promise) cache = { at: 0, promise: null }; });
    return promise;
  }

  function invalidate() {
    cache = { at: 0, promise: null };
  }

  return { get, invalidate };
}

module.exports = { createHome };
