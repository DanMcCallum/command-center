# Operator input drop-offs

This directory receives the two human-prerequisite artifacts for the land.com
access spike (`specs/land-com-connect.md`). Everything in here except this README
is **gitignored** — raw cookie exports are session secrets and must never reach
git, the report, logs, or chat.

## OT-A — home network probes

From a home/residential connection, run the probe script at `../home-probe.sh`
and save its output here as:

```
home-probes.txt
```

The report's Block Scope table incorporates it as the "home" column.

## OT-B — land.com cookie export

Log in to land.com in your own browser and export your session cookies following
the step-by-step instructions that US-004 will add to this README (exact browser,
which cookies, exact filename). Until those instructions land, hold off.

Safety rules that always apply:

- The export is saved **only** in this directory (gitignored).
- It is deleted immediately after conversion to `workers/posting/auth/land_com.json`.
- Cookie values are never pasted into the report, logs, or chat.
