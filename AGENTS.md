# Agent Notes

Reusable patterns for working in this repo.

- **Config files can't be imported by dashboard code.** The Next.js app lives in `dashboard/` and uses Turbopack, which refuses to bundle imports from outside that directory — `import x from '../../config/foo.json'` is a build error even though `tsc` accepts it. Server API routes read `config/` via `fs` from `path.resolve(process.cwd(), '..')`; client components fetch those routes (e.g. `GET /api/posting-platforms`).
- **Typecheck:** `cd dashboard && npx tsc --noEmit` (no npm script). Posting scripts: `cd workers/posting && npm run typecheck && npm test`.
- **Port 3000 is production** (`npm start` via @reboot cron, serves stale compiled code). Never test against it or restart it. Verify with a temp `npx next dev -p 3001` — start it with `DASHBOARD_URL=http://localhost:3001` so spawned worker/poster scripts call back to the dev server, then kill it and clean up temp tasks/logs.
- **All task writes go through the API** (`/api/tasks`), never direct edits to `dashboard/data/tasks.json`, to preserve the write mutex. `POST /api/tasks` drops unknown fields (e.g. `postings`) — attach those via PATCH after create.
- **Browser verification:** Playwright is installed under `workers/posting/node_modules` with headless chromium — `require('<root>/workers/posting/node_modules/playwright')` from any Node script. Against `next dev`, first hit of a route compiles for ~10s; poll the API for expected state rather than waiting on DOM changes.
- **Secrets:** `workers/posting/auth/*.json` are marketplace sessions (gitignored) — never expose via the files API or logs.
