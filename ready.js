// Readiness check for GET /ready: are the database and Redis answering right now?
// The real checks are passed in, so test.js can test this with fakes (no database needed).

// runs fn(); fails if it throws, rejects, or takes longer than ms
function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve()
      .then(fn)
      .then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// checks:  { name: () => promise }   e.g. { db: () => pool.query("SELECT 1"), redis: () => cache.ping() }
// returns: async () => { ok, failed: [names] }   (never throws; error details are never shown to visitors)
// cacheMs: many requests at once (or someone hammering the URL) run the real checks at most once per cacheMs
function createReadyCheck({ checks, timeoutMs = 2000, cacheMs = 2000, now = Date.now }) {
  let last = null;                                      // { at, promise }

  async function run() {
    const names = Object.keys(checks);
    const results = await Promise.allSettled(names.map((n) => withTimeout(checks[n], timeoutMs)));
    const failed = names.filter((_, i) => results[i].status === "rejected");
    return { ok: failed.length === 0, failed };
  }

  return function check() {
    if (last && now() - last.at < cacheMs) return last.promise;
    last = { at: now(), promise: run() };
    return last.promise;
  };
}

module.exports = { createReadyCheck };
