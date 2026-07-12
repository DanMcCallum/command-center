# PRD: Remove LandFeed References (Decision: No LandFeed)

## Introduction

We have made a conscious decision **not** to use the Land.com LandFeed XML API: it requires a Corporate Account with a large number of ads, which we don't have. Today LandFeed is referenced across 12 files — specs, research reports, progress logs, and one research script — and `specs/specs.md` still recommends it as the *primary* Land.com path with an open operator task (OT-C: email Land.com for a shared key).

This feature removes every LandFeed reference repo-wide and leaves exactly **one** note, in `specs/specs.md`, recording the decision and its rationale. Where LandFeed was recommended as primary, the former fallback (cookie export via extension + Tailscale exit node for egress, then run-poster-locally) is promoted to primary.

## Goals

- Exactly one LandFeed reference remains in the repo: a decision note in `specs/specs.md`.
- The decision note states: we consciously chose not to use the Land.com LandFeed XML API because it requires an account with a large number of ads.
- `specs/specs.md`'s Land.com recommendation no longer names LandFeed as primary; the former fallback chain is promoted (cookie export + Tailscale exit node → run poster locally → commercial residential proxy).
- Operator task OT-C (LandFeed shared-key email) is removed everywhere it appears as an open task.
- All edited documents still read coherently — no dangling cross-references, half-sentences, or fallback chains that start from a removed option.

## Canonical decision note (use verbatim in US-001)

> **Decision (2026-07-12): no LandFeed.** We made a conscious decision not to use the Land.com LandFeed XML API — it requires an account with a large number of ads, which we don't have. All other references to it have been removed from the repo; this note is the single remaining record.

## User Stories

### US-001: Add the decision note and rewrite the recommendation in specs/specs.md
**Description:** As the operator, I want `specs/specs.md` to record the no-LandFeed decision once and recommend the path we're actually taking, so the master spec log reflects reality.

**Acceptance Criteria:**
- [x] The canonical decision note (verbatim from this PRD) is added to the "Land.com access — research spike" entry in `specs/specs.md`
- [x] The **Recommendation** line (currently "LandFeed API primary…") is rewritten: cookie export via extension (OT-B) + Tailscale exit node for posting egress is primary; fallback chain is "cookie export + Tailscale → run poster locally → commercial residential proxy"
- [x] OT-C is removed from the open operator tasks list in the "Invariants / gotchas" section
- [x] All other LandFeed mentions in `specs/specs.md` are removed or reworded (including the Akamai-exemption bullet, the "Extending" paragraph, the auth-capture spike's "Key verified findings"/"Recommendation" bullets, and the §7 follow-up-PRD paragraph's US-101–104 LandFeed-path mention)
- [x] `grep -ci landfeed specs/specs.md` returns exactly the count of lines in the decision note (the note is the only match)
- [x] Surrounding prose still reads as complete sentences (no dangling "primary (fallback: …)" fragments)
- [x] Typecheck passes

### US-002: Scrub specs/land-com-connect.md
**Description:** As the operator, I want the Land.com connect spike spec cleaned of LandFeed references (17 matches) so no spec still treats the feed as a live option.

**Acceptance Criteria:**
- [x] LandFeed mentions removed or reworded throughout: the intro/context paragraphs, US-002's probe-URL criteria (drop the three `/LandFeed/` URLs and the block-scope conclusion about them), US-006 ("Re-anchor the LandFeed API option" — remove the story or reduce it to a one-line "removed: LandFeed rejected, see specs.md" stub), the OT-C operator task, the "what would change this decision" bullets, the sanctioned-options constraint sentence, and the source-citation pointers to LandFeed report sections
- [x] `grep -ci landfeed specs/land-com-connect.md` returns 0
- [x] Remaining checked acceptance criteria still read as complete, coherent sentences
- [x] Typecheck passes

### US-003: Scrub the four remaining spec files
**Description:** As the operator, I want the light-touch spec files cleaned so `specs/` carries no LandFeed references outside the specs.md note.

**Acceptance Criteria:**
- [x] `specs/auth-research.md`: remove/reword the 5 mentions (key-findings bullet, US-002 title + description + Docs-fetch criterion, the "what would change this decision" example)
- [x] `specs/job-model-agent-facing-api.md`: reword the non-goal "No LandFeed API integration (separate track, gated on OT-C)" to a plain "No Land.com feed/API integration" non-goal with no LandFeed or OT-C mention
- [x] `specs/live-view-browser.md`: remove the "No Land.com LandFeed XML API work" non-goal bullet or reword it without naming LandFeed
- [x] `specs/local-publish-2-local-agent.md`: reword the non-goal "No LandFeed, no CAPTCHA solving…" to drop the LandFeed word
- [x] `grep -rci landfeed specs/ | grep -v ':0'` matches only `specs/specs.md`
- [x] Typecheck passes

### US-004: Scrub research/auth-capture-spike/report.md and regenerate the PDF
**Description:** As the operator, I want the auth-capture research report (63 matches) cleaned so the shareable proposal no longer proposes LandFeed.

**Acceptance Criteria:**
- [x] The LandFeed deep-dive section (§2) is removed, replaced by a one-paragraph stub: LandFeed evaluated and rejected — requires an account with a large number of ads (no link back to removed content)
- [x] The recommendation/comparison sections promote the former fallback for land_com and drop LandFeed from all option tables and fallback chains
- [x] §7's US-101–104 (LandFeed path) stories are removed; remaining §7 stories renumber or stand alone coherently
- [x] The draft shared-key email to Land.com is removed
- [x] `grep -ci landfeed research/auth-capture-spike/report.md` returns 0
- [x] PDF regenerated via `cd workers/posting && npx tsx render-pdf.ts` and `research/auth-capture-spike/auth-capture-proposal.pdf` is updated
- [x] Typecheck passes

### US-005: Scrub the land-com-connect spike report and home-probe.sh
**Description:** As the operator, I want the Land.com connect spike report (35 matches) and the probe script (3 matches) cleaned so the research artifacts match the decision.

**Acceptance Criteria:**
- [x] `research/land-com-connect-spike/report.md`: the LandFeed API option section is reduced to a one-paragraph "evaluated and rejected (account with a large number of ads required)" stub; LandFeed rows/entries removed from the block-scope table conclusions, comparison matrix, recommendation, and "what would change this decision" list
- [x] `research/land-com-connect-spike/home-probe.sh`: the `/LandFeed/` probe URLs are removed from the URL list; script still passes `bash -n` (the untracked `home-probe.zsh` port was cleaned the same way to satisfy the directory grep)
- [x] `grep -rci landfeed research/land-com-connect-spike/ | grep -v ':0'` returns nothing
- [x] Typecheck passes

### US-006: Scrub initial-research.md and the progress logs
**Description:** As the operator, I want the remaining historical artifacts (seeded research + two progress logs) cleaned to complete the repo-wide sweep.

**Acceptance Criteria:**
- [x] `research/auth-capture-spike/initial-research.md`: 10 mentions removed or reduced to a single "rejected — see specs/specs.md" line
- [x] `progress-auth-research.txt`: 13 mentions removed or reworded (keep log entries' dates/structure; just strip the LandFeed content)
- [x] `progress-land-com-connect.txt`: 18 mentions removed or reworded the same way
- [x] `grep -ci landfeed` returns 0 for all three files
- [x] Typecheck passes

### US-007: Repo-wide verification sweep
**Description:** As the operator, I want proof that exactly one LandFeed reference remains and nothing was left dangling, so the decision is cleanly recorded.

**Acceptance Criteria:**
- [x] `grep -rli landfeed . --exclude-dir=node_modules --exclude-dir=.git --exclude=PRD.md` returns exactly one file: `specs/specs.md` (binary PDF excluded via `grep -I` or `--exclude=*.pdf`)
- [x] The only match lines in `specs/specs.md` belong to the canonical decision note
- [x] `grep -rn "OT-C" specs/ research/ progress-*.txt` returns no hits describing an open shared-key task
- [x] `grep -rni "loa_shared_key\|loa_account" --exclude-dir=node_modules --exclude-dir=.git .` returns no hits outside git history
- [x] Spot-read every edited recommendation/fallback sentence and confirm none starts from or references a removed option
- [x] Typecheck passes

*Sweep exemptions (2026-07-12):* the in-flight PRD's real filename is `specs/land-com-feed-cleanup.md` (excluded per the Non-Goals exemption; the criterion's `PRD.md` name was a placeholder), and the untracked, operator-generated `operator-input/home-probes.txt` (OT-A raw probe output, containing three feed-path URLs) is excluded because Non-Goals forbids touching `operator-input/`. Everything else in the repo greps clean.

## Non-Goals

- No git-history rewrite — past commits keep their LandFeed mentions.
- No changes to worker or dashboard runtime code (nothing in `workers/` or `dashboard/` outside `home-probe.sh` references LandFeed).
- No deletion of files — reports and progress logs are edited, not removed.
- No re-research or re-validation of the alternative paths (cookie export, Tailscale, local poster) — this is a documentation change only.
- No touching `operator-input/` or `auth/` secrets.
- This PRD file itself (`PRD.md`) is exempt from the "one reference" rule while the work is in flight.

## Technical Considerations

- The research reports are dated artifacts; when removing a section, leave a one-paragraph rejection stub rather than a silent gap so section numbering and cross-references stay resolvable.
- `specs.md` line numbers cited above drift as edits land — locate content by the quoted text, not line number.
- The auth-capture report has a PDF render; per `specs/specs.md`, regenerate with `cd workers/posting && npx tsx render-pdf.ts` after editing the markdown (US-004).
- Typecheck command: the repo's standard `npm run typecheck` in `workers/posting` (markdown-only stories will pass trivially; the criterion guards the script/PDF-render stories).
