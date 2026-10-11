// Creates a match (and optionally gives a scorer access to it).
//
// Examples:
//   node add-match.js --id cr-1 --name "Cricket: A vs B" --sport cricket --overs 5 --players 6 --first A --scorer rahul
//   node add-match.js --id kb-2 --name "Kabaddi: G vs H" --sport simple --scorer rahul
//   node add-match.js --id tt-3 --name "Table Tennis: E vs F" --sport table_tennis --bestof 5 --scorer neha
//
// Cricket options: --overs (1-50, default 10)  --players (2-11, default 11)
//                  --first A|B (who bats first, default A)  --freehit true|false (default true)
const pool = require("./db");
const { getEngine } = require("./engines");
const cricket = require("./engines/cricket");

function readArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith("--")) throw new Error("unexpected text: " + list[i]);
    const key = list[i].slice(2);
    const val = list[i + 1];
    if (val === undefined || val.startsWith("--")) throw new Error("missing value for --" + key);
    out[key] = val;
    i++;
  }
  return out;
}

function toInt(text, name) {
  if (!/^\d+$/.test(text)) throw new Error(name + " must be a whole number");
  return Number(text);
}

async function main() {
  const a = readArgs(process.argv.slice(2));
  const known = ["id", "name", "sport", "scorer", "overs", "players", "first", "freehit", "bestof"];
  for (const k of Object.keys(a)) if (!known.includes(k)) throw new Error("unknown option --" + k);

  if (!a.id || !/^[a-z0-9-]{1,30}$/.test(a.id)) throw new Error("--id is required: lowercase letters, digits and dashes, up to 30 characters");
  if (!a.name || a.name.length > 80) throw new Error("--name is required (up to 80 characters)");
  if (!a.sport || !getEngine(a.sport)) throw new Error("--sport must be one of: table_tennis, simple, cricket");

  let config = {};
  let bestOf = 3;
  if (a.sport === "cricket") {
    config = {
      overs: a.overs === undefined ? 10 : toInt(a.overs, "--overs"),
      players: a.players === undefined ? 11 : toInt(a.players, "--players"),
      firstBatting: a.first === undefined ? "A" : a.first,
      freeHit: a.freehit === undefined ? true : a.freehit === "true" ? true : a.freehit === "false" ? false : "invalid",
    };
    const problem = cricket.checkConfig(config);
    if (problem) throw new Error(problem);
  } else if (a.sport === "table_tennis") {
    if (a.bestof !== undefined) {
      bestOf = toInt(a.bestof, "--bestof");
      if (![1, 3, 5, 7].includes(bestOf)) throw new Error("--bestof must be 1, 3, 5 or 7");
    }
  }

  if (a.scorer) {
    const u = await pool.query("SELECT 1 FROM users WHERE username = $1", [a.scorer]);
    if (u.rowCount === 0) throw new Error("scorer '" + a.scorer + "' does not exist (create it with add-user.js first)");
  }

  const ins = await pool.query(
    "INSERT INTO matches (id, name, sport, best_of, config) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
    [a.id, a.name, a.sport, bestOf, JSON.stringify(config)]
  );
  if (ins.rowCount === 0) throw new Error("a match with id '" + a.id + "' already exists (nothing was changed)");

  if (a.scorer) {
    await pool.query("INSERT INTO match_scorers (username, match_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a.scorer, a.id]);
  }
  console.log("Created match", a.id, "(" + a.sport + ")" + (a.scorer ? ", scorer: " + a.scorer : ""));
  if (a.sport === "cricket") console.log("Settings:", JSON.stringify(config));
  await pool.end();
}

main().catch(async (e) => {
  console.error("Error:", e.message);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
