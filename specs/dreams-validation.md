# PRD: DREAMS Review Loop in Ad Generation

**Status:** Draft
**Date:** 2026-07-10

## Introduction

The `generate-ad` workflow drafts per-platform land ads, self-critiques against headline-craft rules and `skills/anti-slop.md`, and writes final files for operator review. It has no structured check that the ad actually *sells* — emotional hook, buyer visualization, trust signals — which is what the DREAMS Framework (Scott Todd) audits.

This feature adds an inline DREAMS review loop to the `generate-ad` workflow: after drafting and the existing critique passes, the worker audits **every platform variant** against the `dreams-ad-review` skill's six DREAMS categories, revises the variants based on that coaching, and repeats until every category passes or 3 cycles are exhausted — all inside the same worker session, before output files are written. The DREAMS scorecard is surfaced to the operator alongside the ads.

Decisions locked with the operator:
- **Placement:** inline in the `generate-ad` workflow, before output is written. No dashboard, API, or worker-script changes.
- **Scope:** every platform variant — headline and description both.
- **Iterations:** loop until clean, max 3 review→revise cycles.
- **Precedence:** when DREAMS feedback conflicts with anti-slop/voice rules (or headline-craft style rules), **DREAMS wins**. Hard constraints still always hold: platform character caps, never inventing property facts, and the nickname tag (which stays exempt from all review passes).

## Goals

- Every generated ad variant is audited against all six DREAMS categories before it reaches `needs_review`.
- Variants with a Weak or Missing category are revised (max 3 cycles) using the skill's coaching, applied in the operator's voice — the generator revises its own copy; the skill is used as an audit rubric, not a ghostwriter.
- The operator can see, per platform, the final DREAMS verdict and any unresolved weaknesses without opening the notes file.
- No regression on hard constraints: char caps (including the nickname-tag budget), factual grounding, nickname registry rules.

## User Stories

### US-001: DREAMS audit step in the generate-ad workflow
**Description:** As the operator, I want each drafted ad variant audited against the DREAMS Framework so weaknesses in emotional hook, buyer fit, and trust are caught before I review.

Edit `~/.claude/commands/generate-ad.md`:

**Acceptance Criteria:**
- [x] Inputs list gains item 9: the DREAMS rubric at `/home/mazer/claude/command-center/.claude/skills/dreams-ad-review/SKILL.md`, read as a rubric file (headless worker — no Skill-tool invocation), with instruction to read it in full before step 6
- [x] New **Step 6 — DREAMS audit** added after Step 5 (voice check) and before Output: audit every platform variant's headline + description **sales-copy portion** (nickname tag excluded, per the existing tag-exemption rules) against all six DREAMS categories from the rubric
- [x] Audit output format is specified: per platform, per category, a verdict of `Pass | Weak | Missing`, plus a 1–2 sentence coaching note (what's weak and what direction to take) for every non-Pass verdict
- [x] Each cycle's full audit is appended to `notes.md` (cycle number, per-platform scorecard, coaching notes)
- [x] Typecheck passes (`npx tsc --noEmit` from `dashboard/` — guards against accidental repo damage)

### US-002: Revise-and-repeat loop with termination and precedence rules
**Description:** As the operator, I want the worker to act on the DREAMS coaching and re-check its work so ads improve automatically instead of just being graded.

Edit `~/.claude/commands/generate-ad.md`, extending Step 6:

**Acceptance Criteria:**
- [x] Revision pass defined: rewrite only variants that have ≥1 non-Pass category, addressing each coaching note; revisions are written in the operator's voice (pattern-matched from `voice/clean/`), consistent with the skill's coach-don't-ghostwrite principle
- [x] Loop defined: audit → revise → re-audit; terminate when every category is Pass on every platform, or after 3 total audit cycles, whichever comes first
- [x] After 3 cycles with remaining non-Pass verdicts: keep the latest revision and log each unresolved category + why it couldn't be resolved in `notes.md`
- [x] Precedence stated explicitly in the workflow: DREAMS coaching overrides anti-slop, voice-check, and headline-craft **style** rules when they conflict; platform caps, the 90–100% length window, no-invented-facts, and all nickname-tag rules are absolute and never overridden — a DREAMS fix may never introduce a fact not in the task metadata
- [x] Char budgets re-verified after every revision (headline vs `headline_max`, sales copy vs `content_budget` from Step 3); nickname tag is still appended only once, after the final cycle
- [x] Existing "exactly once" anti-slop language in step 4b updated so it doesn't contradict the new loop (anti-slop still runs once; DREAMS cycles are a separate later loop)
- [x] Typecheck passes

### US-003: DREAMS scorecard in the output deliverables
**Description:** As the operator, I want the final DREAMS verdicts visible in the deliverables so I can judge ad quality at a glance during review.

Edit `~/.claude/commands/generate-ad.md` Output section:

**Acceptance Criteria:**
- [ ] Output section requires a new `dreams-review.md` file in `OUTPUT_DIR`: final per-platform scorecard table (platform × six DREAMS categories), number of cycles used, and a list of unresolved weaknesses (empty if clean)
- [ ] `README.md` Variants table spec gains a `DREAMS` column (e.g. `Pass` or `2 weak`)
- [ ] Per-platform file template gains a one-line `## DREAMS` section stating that platform's final verdict summary
- [ ] `notes.md` requirements updated to include the per-cycle audit logs from US-001/US-002
- [ ] Typecheck passes

### US-004: Ship docs per the spec process
**Description:** As a developer, I want the project docs to reflect the DREAMS loop so future features build on accurate context.

**Acceptance Criteria:**
- [ ] `specs/specs.md` gains a feature-log entry (shape per existing entries: what it does, files touched, invariants/gotchas, how to extend)
- [ ] `specs/readme.md` §5.5 (Ad generation) updated to describe the DREAMS review loop (inline, all variants, max 3 cycles, DREAMS-wins precedence, `dreams-review.md` artifact)
- [ ] This PRD's header updated to `**Status:** Implemented (<date>)` (operator moves the file to `specs/dreams-ad-review.md` on ship)
- [ ] Typecheck passes

## Non-Goals

- No changes to `workers/run-worker.sh`, the dashboard, the API, or the posting pipeline — this is entirely a workflow-prompt change.
- No standalone DREAMS-review task type or dashboard surface; the review is invisible except through the output artifacts.
- No changes to the `dreams-ad-review` skill itself (`.claude/skills/dreams-ad-review/SKILL.md` is read-only for this feature).
- No numeric scoring — verdicts are `Pass | Weak | Missing` only.
- No Ralph-run end-to-end ad generation for verification (a live opus generation takes ~20+ min); structural verification of the workflow file is enough per-story, and the operator validates with a real Ad Builder run after ship.

## Technical Considerations

- **The workflow file lives outside the repo** at `~/.claude/commands/generate-ad.md` (documented in `specs/readme.md` §5.5) — edits there are not git-tracked. Take a timestamped backup copy into the output/notes area before the first edit, and note the edit in `progress.txt`.
- **Headless skill use:** the worker runs `claude -p` with the workflow injected as prompt text; the DREAMS skill must be consumed by *reading its `SKILL.md` by absolute path*, never by Skill-tool invocation (project-skill discovery depends on cwd, which the worker doesn't guarantee).
- **Timeout budget:** worker tasks time out at 30 min. Each cycle must audit all platforms in one pass (one scorecard per cycle), not per-variant sub-loops, to keep 3 cycles affordable.
- **The skill is a coaching skill** ("do NOT rewrite") — the workflow uses it as an audit rubric and the generator revises its own copy in the operator's voice, which honors the skill's intent.
- **Nickname tag** remains exempt from every review pass (existing rule) and is appended only after the final DREAMS cycle, so `content_budget` math is unchanged.
- Verification per story: grep/read `~/.claude/commands/generate-ad.md` for the required sections and rules; `npx tsc --noEmit` from `dashboard/` as the standard harness check.
