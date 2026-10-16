# The local poster agent

The agent runs on **your machine** (residential IP — this is what gets past
land_com's Akamai block), polls the dashboard for queued publish jobs, and for
each job posts the ad with a real Chromium browser on your desktop. When your
saved login session is stale, a browser window pops up; you log in, and posting
continues automatically. The laptop is outbound-only — no inbound port, no VNC.

## Prerequisites

- Node.js 20+
- This repo cloned (`git pull` is the whole update story — no installer)

```bash
cd workers/posting
npm install
npx playwright install chromium
```

## Configuration

Three environment variables. The agent reads the environment first, then falls
back to the **project-root** `.env.local` (not `dashboard/.env.local`).

| Variable | Required | Meaning |
|---|---|---|
| `DASHBOARD_URL` | yes | Base URL of the dashboard server, no trailing slash |
| `AGENT_TOKEN` | yes | Must match the `AGENT_TOKEN` in the server's `.env.local` |
| `AGENT_POLL_SECONDS` | no | Poll interval, default `15` |
| `POSTER_EXTENSIONS` | no | Extensions to load into the login window, e.g. `proton-pass` (see below) |

Example `.env.local` at the repo root on your machine:

```bash
DASHBOARD_URL=http://server-tailscale-name:3000
AGENT_TOKEN=<paste the value from the server's root .env.local>
# AGENT_POLL_SECONDS=15
```

```bash
chmod 600 .env.local
```

**Pointing `DASHBOARD_URL` at the server:**

- **Tailscale (recommended):** with both machines on the tailnet, use the
  server's Tailscale hostname or 100.x address, port 3000
  (e.g. `http://100.101.102.103:3000`). Nothing else to configure.
- **Cloudflare tunnel:** `https://dashboard.ownaloha.land` also works, but that
  hostname is gated by Cloudflare Access — the agent's requests must be allowed
  at the edge (e.g. an Access service token / bypass policy for the `/api/`
  paths the agent uses). If you don't want to touch Access policy, use
  Tailscale.
- **Same machine (dev only):** `http://localhost:3000`.

## Run it

```bash
cd workers/posting
npm run agent
```

You should see `agent started — polling <url> every 15s`, then a job count on
every poll. One job runs at a time (never two browsers). `Ctrl-C` exits
cleanly; press it twice to force-quit.

## Password manager in the login window

The login popup is Playwright's own Chromium with a throwaway profile, so by
default none of your Chrome extensions are in it. Set `POSTER_EXTENSIONS` to
load some:

```bash
POSTER_EXTENSIONS=proton-pass
```

Accepted entries, comma separated: the alias `proton-pass`, a Chrome Web
Store extension id, or the path of an unpacked extension directory. An id is
found in your own Chrome/Chromium/Brave profiles (`Extensions/<id>/<version>`),
so install Proton Pass in your normal browser first; the newest version is
copied to `.agent-cache/extensions/` without the `_metadata` folder Chrome
rejects in unpacked extensions. A bad entry stops the agent at startup.

With extensions set, the login window runs in a persistent profile at
`.agent-cache/profile/` (Chromium loads extensions nowhere else). The first
time, Proton Pass opens its own tab asking you to sign in to Proton; do that
once and the profile keeps it. On its first run the profile is seeded from the
saved `auth/*.json` sessions, so you are not asked to log in to every
marketplace again. Each captured login is still written to
`auth/<platform>.json` for the headless `npm run post` runs. Delete
`.agent-cache/profile/` to start the profile over (then sign in to Proton Pass
again).

`npm run post -- <platform> <task> --login` honours the same variable from
the environment.

## Where sessions live

Marketplace login sessions are minted and stored **only on this machine**, at
`workers/posting/auth/<platform>.json` (written `chmod 600` by the agent).
There are no passwords anywhere — only saved browser state.

To wipe a bad session (e.g. the site logged you out but the probe disagrees):

```bash
rm workers/posting/auth/<platform>.json
```

The next job for that platform will pop the login window again.

Downloaded ad copy and photos are cached under `workers/posting/.agent-cache/`
— safe to delete anytime.

## Security notes

- `AGENT_TOKEN` and `auth/*.json` are **secrets**: the token drives the
  publish API, the session files grant marketplace account access. Keep both
  `chmod 600`, never commit them, never paste them into logs or chat.
- The repo's `.gitignore` already covers `workers/posting/auth/` and
  `workers/posting/.agent-cache/` — `git status` staying quiet about them is
  expected, not an accident.
- The agent never logs cookie values (names and expiry timestamps only).

## First publish — walkthrough

1. Start the agent (`npm run agent`) and leave it running.
2. On the dashboard, expand an approved ad task and click **Publish** for a
   platform. The chip goes gray **Queued**.
3. Within one poll interval (~15 s) the agent claims the job and downloads the
   ad copy + photos. The chip goes blue **Posting…**.
4. If the saved session is stale (or there is none), a Chromium window pops up
   on this machine at the platform's login page and the chip goes amber
   **Waiting for login…** (`awaiting_auth`). Log in as yourself — you have up
   to 15 minutes. Closing the window instead marks the job failed with
   `login cancelled`.
5. On login the agent saves the fresh session, the chip flips back to
   **Posting…**, and the ad is filled and submitted in that same browser.
6. Chip goes green **Posted**, linking to the live listing; the proof
   screenshot is uploaded to the server and available from the chip popover.
   On failure the chip goes red with a one-line error and a screenshot of what
   the browser was looking at — fix the cause and click **Publish** again
   (there is no auto-retry).
