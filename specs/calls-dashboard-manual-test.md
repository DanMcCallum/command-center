# Calls dashboard: manual integration test (operator session)

**PRD:** [calls-dashboard.md](calls-dashboard.md) · **Run by:** the operator, before the nginx cutover · **Takes:** about 45 minutes with two phones

The automated check (`workers/calls-e2e/run.sh`) proves the chain against fakes. This session proves it against the real Dialpad line, the real Investment Dominator (ID) account, the Cloudflare tunnel, and a phone browser. Fill in each "Observed" line as you go; anything that does not match "Expected" goes under "Gaps found" at the bottom and is fixed or accepted before cutover.

## Before you start

- [ ] Production Python on 8100 restarted with the `/api/v1/*` build (recipe under "Questions for Daniel" in `progress-calls-dashboard.txt`; confirm the old pid is gone with `ps -p <pid>` before relaunching, `kill -9 <pid>` if it is still there after 10 s).
- [ ] Production dashboard on 3000 rebuilt and restarted with the `/calls` build (`cd dashboard && npm run build`, then `fuser -k 3000/tcp` and relaunch `dashboard/start.sh`).
- [ ] `CALLS_API_TOKEN` is the same value in followupdominator `.credentials/dashboard.env` and the command-center root `.env.local`.
- [ ] `workers/calls-e2e/run.sh` passes on this box (it uses ports 3001 and 8101 and fakes, so it is safe to run any time).
- [ ] Tunnel latency recorded (`workers/calls-e2e/TUNNEL-LATENCY.md`).
- [ ] Test records ready: the `[API TEST]` property 5693 with nickname "Test Meadow" still exists in ID and in the nickname registry. Use only `[TEST]` contacts and property 5693 below; never log a note or a task against a real contact or property.
- [ ] A second phone that is not on any real ID record (it becomes the `[TEST] Caller` contact in step 5). If a `[TEST] Caller` contact from the July batch test still exists, step 2 can use that phone right away; otherwise run step 5 first and come back to steps 2 and 3.
- [ ] Keep `https://calls.ownaloha.land` open in another tab for step 10; it keeps working until cutover.

## Steps

### 1. Laptop and phone load
Open `https://dashboard.ownaloha.land/calls` on the laptop and on a phone, signing in through Cloudflare Access on each.

- **Expected:** both load with no password prompt beyond Access; the ops strip is green (dead letters 0, outbox queue, event backlog, last sync all ok); the stream indicator reads open; the recent calls table matches the old dashboard's list.
- **Observed:** ______________________________________________

### 2. Real inbound call pops within 2 s
From the `[TEST] Caller` phone, call the business line. Watch both screens from the moment the business line starts ringing.

- **Expected:** a `matched` pop on both devices within 2 s of the ring, naming the `[TEST] Caller` contact (and property 5693 if the contact is linked to it); the call appears at the top of the recent calls table.
- **Observed (seconds to pop, laptop / phone):** ______________________________________________

### 3. Note with follow-up lands in ID within a minute
Answer, hang up, then on the pop click "Log note". Note text: `[TEST] manual test note`, status Completed, follow-up date tomorrow. Click "Save note".

- **Expected:** the form says the note was queued, then within about a minute shows "ID task N on contact M" with a link to the record page; the recent calls row shows "note logged"; in the ID UI the task is on the `[TEST] Caller` contact with the note text, the call id line, and tomorrow's date. A second click on Save does nothing new ("Duplicate submit, already logged").
- **Observed (task id, seconds until it showed):** ______________________________________________

### 4. Ring-out creates the missed-call task
Call the business line from the `[TEST] Caller` phone again and let it ring out unanswered.

- **Expected:** behavior unchanged from before: a missed-call task is auto-created in ID on that contact by the Python loops, and the call shows in the `/calls` recent list. The command center itself writes nothing here.
- **Observed (missed-call task id):** ______________________________________________

### 5. Unknown caller plus nickname attribution
From a phone that is not on any ID record, call the business line and say "I'm calling about Test Meadow". On the `miss` pop (or from `/calls/attribute` with the number), search "Test Meadow", pick it, and enter first name `[TEST]`, last name `Caller`.

- **Expected:** the `miss` pop arrives within 2 s; the attribute page finds "Test Meadow" (property 5693); after submit it shows the new contact id and property 5693 with record links; the contact's record page loads; a repeat call from that number now pops `matched`.
- **Observed (new contact id):** ______________________________________________

### 6. Dial pre-tag
On `/calls/dial`, enter the `[TEST] Caller` number and property 5693, submit, then place the outbound call from Dialpad to that number within a few minutes.

- **Expected:** the dial page confirms the intent (and the nickname "Test Meadow" for 5693); when the call connects, an `outbound` pop appears tagged with property 5693; the call shows in recent calls.
- **Observed:** ______________________________________________

### 7. Search and record pages
On `/calls/search`, search a partial name (`Calle`), then a phone fragment (last four digits of the test phone). Open the `[TEST] Caller` contact and property 5693 from the results. Open `/calls/tasks`, `/calls/contacts`, `/calls/properties`, `/calls/agents`, and `/calls/ops`.

- **Expected:** the name search finds the test contact. The phone fragment finds nothing on both the new and the old dashboard: search matches name, address, and APN in the phone index, not the number (same query as the old `/search`); note it under "Gaps found" if you want number search added. Record pages show the fields and, after the next sync walk (every 45 min), the task history including the step 3 task; the tasks page lists open tasks with overdue rows marked; agents shows the configured agents and the DialPad user list; ops shows the strip, sync age, and no dead letters.
- **Observed:** ______________________________________________

### 8. Tab kill and reconnect
With `/calls` open, close the tab (or kill the browser on the phone), wait 30 s, reopen `/calls`, then place one more call from the test phone.

- **Expected:** the reopened page rebuilds the recent list from `/api/calls/recent` (the step 2 to 6 calls are there) and the new call pops normally.
- **Observed:** ______________________________________________

### 9. Python stopped for 30 s, then recovered
With `/calls` open on both devices, stop the production Python service (find the pid of `.venv/bin/python .../scripts/run_service.py`, `kill <pid>`; if `ps -p <pid>` still shows it after 10 s, `kill -9 <pid>`, see the graceful-shutdown question in the progress log). Wait 30 s, check `https://calls.ownaloha.land/healthz`, then relaunch with the `@reboot` line from `crontab -l | grep run_service` (without the `@reboot sleep 8 &&` prefix).

- **Expected:** within a few seconds `/calls` shows "call service unreachable" and the strip turns red (other pages show it on their next 30 s strip refresh); `/healthz` fails while it is down and returns 200 (or 503 until the first sync) after the relaunch; the page recovers on its own within about 5 s of the service coming back, with no reload, and the next call pops.
- **Observed (seconds to unreachable, seconds to recover):** ______________________________________________

### 10. Side-by-side comparison with the old dashboard
Open each old page on `https://calls.ownaloha.land` next to its new page: home (live pops, recent calls) vs `/calls`, contacts, properties, record pages, tasks, search, attribute, dial, agents, ops (badges, dead letters, health flags).

- **Expected:** every field, column, and action on the old page exists on the new one. List anything missing under "Gaps found"; cutover waits until each is fixed or accepted.
- **Observed:** ______________________________________________

## Gaps found

- ______________________________________________

## Cleanup (ID UI; there is no delete endpoint)

- [ ] Delete the step 3 note task (`[TEST] manual test note`) and any follow-up it created.
- [ ] Delete the step 4 missed-call task, and any other missed-call tasks the test calls created (steps 2, 5, 6, 8).
- [ ] Delete the `[TEST] Caller` contact created in step 5 (and the July one, if it was still there).
- [ ] Delete the test property 5693 only if no further testing is planned (it also carries the "Test Meadow" nickname; remove that registry row in the same pass), along with the older `[API TEST]` records listed in followupdominator `DEPLOY.md` section 7.
- [ ] Locally: nothing to clean. Dial intents expire on their own (intent purge loop) and the recent calls list ages out.

## Sign-off

- Result (pass, or pass with accepted gaps): ______________________________________________
- Date and initials: ______________________________________________
- Then apply the cutover: followupdominator `DEPLOY.md` section 8 (`deploy/cutover.sh`).
