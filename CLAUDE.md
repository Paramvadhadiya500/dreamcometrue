# College Live Score
Read PROJECT_CONTEXT.md before big tasks (not for small ones).
Plain HTML + Node/Express + Socket.IO + Postgres + Redis, Docker Compose.

Rules
- Simple English. Say where each command runs (PowerShell or Ubuntu bash).
- Read a file before editing it. Do not invent files, functions, packages or
  settings. If unsure, search the code or ask me. Say what you did not test.
- Never print or commit secrets. Never run `docker compose down -v`.
  Never touch production.
- Never edit an applied migration; add a new numbered one.
- Small changes. Run `node test.js` after changing engines or server code
  and show me the result.
- After EVERY change (a commit, or something done by hand on the server/AWS),
  add an entry at the top of docs/CHANGELOG.md: What / Why / Checked / Undo.
  No secrets there (the repo is public).
- Never `git push` without asking me first.
When compacting, keep: test output, changed files, open questions.