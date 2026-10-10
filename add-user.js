// Usage: node add-user.js <username> <admin|scorer> <password>
// Creates the user, or resets the password and re-activates an existing one.
const bcrypt = require("bcryptjs");
const pool = require("./db");

const [username, role, password] = process.argv.slice(2);
if (!username || !["admin", "scorer"].includes(role) || !password || password.length < 10) {
    console.log("Usage: node add-user.js <username> <admin|scorer> <password of 10+ characters>");
    process.exit(1);
}

pool
    .query(
        `INSERT INTO users (username, password_hash, role, active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = TRUE`,
        [username, bcrypt.hashSync(password, 10), role]
    )
    .then(() => { console.log("Saved user:", username, "(" + role + ")"); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });