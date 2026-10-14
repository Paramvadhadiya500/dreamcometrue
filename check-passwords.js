// Finds accounts that still use a known or easy password.
// Prints usernames only, never passwords. Exit code 1 if an ACTIVE account is weak.
//   Server:  docker compose run --rm app node check-passwords.js
//   Laptop:  node check-passwords.js
const bcrypt = require("bcryptjs");
const pool = require("./db");

// the demo passwords, the placeholder texts used in the lessons, and very common choices
const KNOWN = [
  "admin123", "rahul123", "neha123",
  "YOUR-REAL-PASSWORD-1", "YOUR-REAL-PASSWORD-2", "CHOOSE-A-PASSWORD1", "CHOOSE-ANOTHER-PASSWORD2",
  "password", "password123", "Password123", "12345678", "123456789", "1234567890",
  "qwerty123", "letmein123", "welcome123", "admin", "admin1234", "scorer123", "sports123",
];

async function main() {
  const r = await pool.query("SELECT username, password_hash, role, active FROM users ORDER BY role, username");
  let weakActive = 0;
  for (const u of r.rows) {
    const guesses = [...KNOWN, u.username, u.username + "123", u.username + "1234", u.username + "@123"];
    let weak = false;
    for (const g of guesses) {
      if (await bcrypt.compare(g, u.password_hash)) { weak = true; break; }
    }
    const label = u.username + " (" + u.role + (u.active ? "" : ", disabled") + ")";
    if (weak) {
      console.log("WEAK  " + label + "  uses a known or easy password. Set a new one.");
      if (u.active) weakActive++;
    } else {
      console.log("ok    " + label);
    }
  }
  console.log(weakActive === 0 ? "No active account uses a known password." : weakActive + " active account(s) must get a new password.");
  await pool.end();
  process.exit(weakActive === 0 ? 0 : 1);
}

main().catch((e) => { console.error("check failed:", e.message); process.exit(2); });
