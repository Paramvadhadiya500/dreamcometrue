// Points table logic. Pure functions (no database), so they are easy to test.
//
// Rules used:  win = 2 points, draw / tie / no result = 1 point, loss = 0.
// Only GROUP-stage matches that are finished and have two different team names count.
// Order: points, then wins, then net run rate (cricket) or score difference (other sports), then name.
// Net run rate = runs scored per over - runs conceded per over. A team that was all out is
// counted as having faced its full quota of overs.

const POINTS = { win: 2, draw: 1, loss: 0 };
const SPORT_LABELS = { cricket: "Cricket", table_tennis: "Table Tennis", simple: "Other" };

const norm = (name) => String(name === undefined || name === null ? "" : name).trim().replace(/\s+/g, " ");
const keyOf = (name) => norm(name).toLowerCase();
const num = (x) => (Number.isFinite(x) ? x : 0);
const rate = (runs, balls) => (balls > 0 ? (runs * 6) / balls : 0);
const round3 = (x) => Math.round(x * 1000) / 1000;

// The competition (group of matches) a match belongs to: what the admin typed, or the sport's name.
function competitionOf(m) {
  return norm(m.competition) || SPORT_LABELS[m.sport] || "Other";
}

// matches: [{ competition, sport, stage, teamA, teamB, result }]
//   result = null (not started) or what engine.result(state) returns:
//   { finished, winner: "A"|"B"|"draw"|null, noResult?, forA, forB, ballsA?, ballsB? }
function buildStandings(matches) {
  const groups = new Map();                          // competition -> Map(team key -> row)

  for (const m of matches) {
    const r = m.result;
    if (m.stage !== "group" || !r || !r.finished) continue;
    const nameA = norm(m.teamA);
    const nameB = norm(m.teamB);
    if (!nameA || !nameB || keyOf(nameA) === keyOf(nameB)) continue;

    const comp = competitionOf(m);
    if (!groups.has(comp)) groups.set(comp, new Map());
    const teams = groups.get(comp);

    const sides = [
      { side: "A", name: nameA, forScore: num(r.forA), against: num(r.forB), balls: num(r.ballsA), oppBalls: num(r.ballsB) },
      { side: "B", name: nameB, forScore: num(r.forB), against: num(r.forA), balls: num(r.ballsB), oppBalls: num(r.ballsA) },
    ];

    for (const s of sides) {
      const k = keyOf(s.name);
      if (!teams.has(k)) {
        teams.set(k, { team: s.name, played: 0, won: 0, drawn: 0, lost: 0, points: 0,
                       forTotal: 0, againstTotal: 0, cricket: false, runsFor: 0, ballsFaced: 0, runsAgainst: 0, ballsBowled: 0 });
      }
      const row = teams.get(k);
      row.played += 1;

      if (r.noResult || (r.winner !== "A" && r.winner !== "B")) {
        row.drawn += 1;
        row.points += POINTS.draw;
      } else if (r.winner === s.side) {
        row.won += 1;
        row.points += POINTS.win;
      } else {
        row.lost += 1;
        row.points += POINTS.loss;
      }

      row.forTotal += s.forScore;
      row.againstTotal += s.against;

      if (m.sport === "cricket") {
        row.cricket = true;
        if (!r.noResult) {                           // an abandoned match does not change the run rate
          row.runsFor += s.forScore;
          row.ballsFaced += s.balls;
          row.runsAgainst += s.against;
          row.ballsBowled += s.oppBalls;
        }
      }
    }
  }

  const out = [];
  for (const [name, teams] of groups) {
    const rows = [...teams.values()].map((row) => ({
      team: row.team,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      points: row.points,
      diff: row.forTotal - row.againstTotal,
      nrr: row.cricket ? round3(rate(row.runsFor, row.ballsFaced) - rate(row.runsAgainst, row.ballsBowled)) : null,
    }));
    const hasNrr = rows.some((x) => x.nrr !== null);
    rows.sort((x, y) =>
      y.points - x.points ||
      y.won - x.won ||
      (hasNrr ? (y.nrr || 0) - (x.nrr || 0) : 0) ||
      y.diff - x.diff ||
      x.team.localeCompare(y.team));
    out.push({ name, hasNrr, rows });
  }
  out.sort((x, y) => x.name.localeCompare(y.name));
  return out;
}

module.exports = { POINTS, competitionOf, buildStandings };
