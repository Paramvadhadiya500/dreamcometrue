// Startup checks for settings. Pure functions: no I/O, so test.js can test them.

const DEV_SECRET = "dev-only-change-me";   // laptop only; production refuses it
const MIN_SECRET_LENGTH = 32;

// Decides which JWT secret to use and whether the server may start.
//   secret:  the value to sign tokens with
//   problem: a message (never contains the secret) or null
//   fatal:   true = refuse to start (only when NODE_ENV is "production")
function checkJwtSecret(env) {
  const raw = env.JWT_SECRET || "";
  let problem = null;
  if (!raw) problem = "JWT_SECRET is not set";
  else if (raw === DEV_SECRET) problem = "JWT_SECRET is the public default value";
  else if (raw.length < MIN_SECRET_LENGTH) problem = "JWT_SECRET is shorter than " + MIN_SECRET_LENGTH + " characters";
  return {
    secret: raw || DEV_SECRET,
    problem,
    fatal: problem !== null && env.NODE_ENV === "production",
  };
}

module.exports = { checkJwtSecret, DEV_SECRET, MIN_SECRET_LENGTH };
