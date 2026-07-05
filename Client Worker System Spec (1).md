# Autonomous Claude Worker System — Implementation Spec

> A complete blueprint for building a cron-triggered Claude worker that picks tasks from a dashboard, executes them autonomously, and routes output through human review.

**Version:** 1.0
**Date:** 2026-03-27

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Core Concepts](#2-core-concepts)
3. [Task Data Model](#3-task-data-model)
4. [Task Lifecycle](#4-task-lifecycle)
5. [Dashboard API](#5-dashboard-api)
6. [Worker Script (run-worker.sh)](#6-worker-script)
7. [System Prompt](#7-system-prompt)
8. [Cron Integration](#8-cron-integration)
9. [Lockfile & Concurrency](#9-lockfile--concurrency)
10. [Task Chaining (Parent-Child Dependencies)](#10-task-chaining)
11. [Slash Commands (Workflow Injection)](#11-slash-commands)
12. [Revision Loop](#12-revision-loop)
13. [Auto-Complete Rules](#13-auto-complete-rules)
14. [Workspace Layout](#14-workspace-layout)
15. [Logging](#15-logging)
16. [Dashboard UI Requirements](#16-dashboard-ui-requirements)
17. [Cron Config Management](#17-cron-config-management)
18. [How to Test](#18-how-to-test)
19. [Extension Points](#19-extension-points)
20. [Checklist](#20-implementation-checklist)

---

## 1. Architecture Overview

```
Human Operator              Dashboard (Web UI)              Claude Worker (Cron)
    |                            |                               |
    +-- Reviews "needs_review"   +-- Task list + status           +-- Picks highest-priority pending task
    +-- Approves or requests     +-- Create / edit tasks          +-- Claims it (in_progress)
        revision                 +-- View output files            +-- Spawns Claude to execute
    +-- Marks "completed"        +-- Cron settings                +-- Updates task when done (needs_review)
    +-- Adds notes / feedback    +-- http://localhost:{PORT}      +-- Falls back to pending on failure
```

**The core loop:**

1. Cron fires every N minutes
2. Worker script fetches all tasks from the dashboard API
3. Picks the highest-priority `pending` task (respecting dependency chains)
4. Claims it by setting `status = in_progress`
5. Spawns a Claude CLI process with a system prompt + task details
6. Claude does the work, writes output to a workspace directory
7. On success: script sets `status = needs_review` and records the output file path
8. On failure: script sets `status = pending` with an error note (auto-retry on next cron)
9. Human reviews at their own pace, then marks `completed` or requests revision

**Key principle:** The human never has to be present when work happens. Claude proposes, human disposes.

---

## 2. Core Concepts

### Status States

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `pending` | Ready to be picked up by the worker | Human (on create) or Worker (on failure/revision) |
| `in_progress` | Currently being worked on by Claude | Worker script (at claim time) |
| `needs_review` | Claude finished — waiting for human review | Worker script (on success) |
| `completed` | Human approved the output | Human (via dashboard) |

### Priority

Integer from 1-5. **1 = highest priority.** The worker always picks the lowest number first. Ties are broken by `createdAt` (oldest first).

### Nothing Ships Without Review

By default, every completed task lands in `needs_review`. The human must explicitly move it to `completed`. This is the fundamental safety mechanism — Claude does 80% of the work, the human provides quality control and taste.

---

## 3. Task Data Model

```typescript
interface Task {
  // Identity
  id: string;                     // "task-{timestamp}-{random}" — generated server-side
  title: string;                  // Short human-readable name
  description: string;            // Full task details (supports markdown)

  // Classification
  type: string;                   // Your task categories (e.g., "Research", "Content", "Building", "Admin")
  tags: string[];                 // Freeform tags for filtering

  // Execution
  status: 'pending' | 'in_progress' | 'completed' | 'needs_review';
  priority: 1 | 2 | 3 | 4 | 5;  // 1 = highest
  model: 'sonnet' | 'opus' | 'haiku';  // Which Claude model to use (default: "sonnet")
  acceptanceCriteria: string[];   // Checklist of conditions for "done" — injected into Claude's prompt
  slashCommand: string | null;    // Workflow template to inject (e.g., "worker/my-workflow")

  // Output
  claudeNotes: string;            // Claude's summary of what it did (or error details)
  completionFile: string | null;  // Relative path to the primary deliverable file
  workspacePath: string | null;   // Path to the task's output directory

  // Dependency Chaining
  parentTaskId: string | null;    // If set, this task won't run until the parent is done

  // Session Resumption
  claudeSessionId: string | null; // Claude CLI session ID — enables --resume on revision

  // Human Feedback
  captainNotes: string | null;    // Human's notes/feedback (used for revision requests)

  // Timestamps
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
  startedAt: string | null;       // When worker claimed it
  completedAt: string | null;     // When human approved it
  estimatedMinutes: number | null;

  // Extensible
  metadata: Record<string, unknown> | null;  // Arbitrary structured data for your use case
}
```

### Cron Config Model

```typescript
interface CronConfig {
  enabled: boolean;
  intervalMinutes: number;   // 5, 10, 15, 30, 60, 120, or 240
  lastRun: string | null;    // ISO 8601 timestamp of last worker run
  lastTaskId: string | null; // ID of last task the worker touched
}
```

### ID Generation

Use a timestamp + random suffix to guarantee uniqueness without a database:

```typescript
function generateId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `task-${ts}-${rand}`;
}
```

---

## 4. Task Lifecycle

```
                    +-----------+
        create ---->|  pending   |<-------+
                    +-----------+         |
                         |                |
                    worker picks     failure/timeout
                         |           (auto-retry)
                         v                |
                    +-----------+         |
                    |in_progress|---------+
                    +-----------+
                         |
                    success
                         |
                         v
                    +-----------+
                    |needs_review|
                    +-----------+
                         |
              +----------+----------+
              |                     |
         human approves      human requests
              |               revision
              v                     |
        +-----------+               |
        | completed  |              |
        +-----------+               v
                              +-----------+
                              |  pending   | (with revision notes in claudeNotes)
                              +-----------+
```

### Revision Flow

When the human isn't satisfied with the output:

1. Human writes feedback in `captainNotes` (or `claudeNotes` prefixed with `[REVISION REQUESTED]`)
2. Human sets status back to `pending`
3. Worker picks it up again on the next cron run
4. Worker detects the revision marker and injects the feedback into Claude's prompt
5. Claude revises the existing output (doesn't start from scratch)
6. If the task has a `claudeSessionId`, the worker resumes the Claude session for continuity

---

## 5. Dashboard API

The dashboard is a lightweight web app that serves as both the UI for the human and the API backend for the worker. Technology choice is yours (Next.js, Express, Flask, etc.) — the worker only needs a REST API.

### Required Endpoints

#### `GET /api/tasks`

Returns all tasks as a JSON array, sorted by priority ascending then createdAt descending.

**Response:** `Task[]`

#### `POST /api/tasks`

Creates a new task. Server generates `id`, `createdAt`, `updatedAt`. All other fields use the request body values or defaults.

**Request body:** `Partial<Task>`
**Response:** `Task` (201 Created)

#### `GET /api/tasks/:id`

Returns a single task by ID.

**Response:** `Task` or `404`

#### `PATCH /api/tasks/:id`

Partial update. Merges request body into existing task. Server prevents overwriting `id` and `createdAt`. Updates `updatedAt` automatically.

**Request body:** `Partial<Task>`
**Response:** `Task` or `404`

#### `DELETE /api/tasks/:id`

Deletes a task.

**Response:** `{ success: true }` or `404`

#### `GET /api/cron-config`

Returns the current cron configuration.

**Response:** `CronConfig`

#### `PUT /api/cron-config`

Updates cron configuration. Used by both the dashboard UI (to enable/disable, change interval) and the worker script (to update `lastRun` and `lastTaskId`).

**Request body:** `Partial<CronConfig>`
**Response:** `CronConfig`

### Storage

The simplest approach: JSON files on disk. No database needed.

```
data/
  tasks.json       -- Task[] array
  cron-config.json -- CronConfig object
```

Read the file, parse JSON, modify, write back. This works well for single-worker systems (the lockfile ensures only one writer at a time for the worker, and the dashboard handles its own serialization).

---

## 6. Worker Script

The worker script is a bash script that runs via cron. Here is the complete algorithm:

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Configuration (customize these) ----------------------------------------
DASHBOARD_URL="http://localhost:YOUR_PORT"
WORKERS_DIR="/path/to/your/project/workers"
LOCKFILE="/tmp/your-project-worker.lock"
TIMEOUT_SECONDS=1800       # 30 minutes max per task
STALE_LOCK_SECONDS=2100    # 35 minutes — stale lock threshold
```

### Step-by-Step Algorithm

#### Step 1: Acquire Lockfile

```bash
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  # Check if lock is stale (holder crashed)
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || echo 0) ))
  if [[ $LOCK_AGE -gt $STALE_LOCK_SECONDS ]]; then
    fuser -k "$LOCKFILE" 2>/dev/null || true
    sleep 2
    exec 200>"$LOCKFILE"
    flock -n 200 || { echo "Cannot reclaim lock. Exiting."; exit 1; }
  else
    exit 0  # Another worker is running normally — exit silently
  fi
fi
touch "$LOCKFILE"
```

- Uses `flock` (non-blocking) to prevent concurrent workers
- Detects stale locks (holder crashed/hung) by checking file modification time
- Kills the stale holder via `fuser -k` and retries

#### Step 2: Set Up Logging

```bash
mkdir -p "$WORKERS_DIR/logs"
LOG_FILE="$WORKERS_DIR/logs/worker-$(date +%Y%m%d-%H%M%S).log"
exec &> >(tee -a "$LOG_FILE")
```

Every run gets its own timestamped log file. Output is both printed (for cron log) and saved.

#### Step 3: Fetch Pending Tasks

```bash
TASKS_RESPONSE=$(curl -s --fail --max-time 15 "${DASHBOARD_URL}/api/tasks")
```

If the dashboard is down, log the error, update cron config with `lastRun`, and exit.

#### Step 4: Select Highest-Priority Task (Respecting Dependencies)

```bash
# Find IDs of all tasks that are still pending or in_progress (unfinished)
BLOCKED_PARENTS=$(echo "$TASKS_RESPONSE" | jq -r '
  [.[] | select(.status == "pending" or .status == "in_progress") | .id]
')

# Select the best pending task whose parent (if any) is NOT in the blocked list
TASK_JSON=$(echo "$TASKS_RESPONSE" | jq -r --argjson blocked "$BLOCKED_PARENTS" '
  [.[] | select(.status == "pending")
       | select(.parentTaskId == null or .parentTaskId == ""
                or ([.parentTaskId] | inside($blocked) | not))]
  | sort_by(.priority, .createdAt)
  | first
  // empty
')
```

This is the dependency chain logic: a task with `parentTaskId` pointing to a task that is still `pending` or `in_progress` will be skipped. Once the parent reaches `needs_review` or `completed`, the child becomes eligible.

#### Step 5: Claim the Task

```bash
curl -s -X PATCH "${DASHBOARD_URL}/api/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "startedAt": "'$(date -Iseconds)'"}'
```

#### Step 6: Create Workspace

```bash
OUTPUT_DIR="$WORKERS_DIR/workspace/outputs/${TASK_ID}"
NOTES_FILE="$WORKERS_DIR/workspace/notes/${TASK_ID}.md"
mkdir -p "$OUTPUT_DIR" "$(dirname "$NOTES_FILE")"
```

#### Step 7: Build Prompt & Spawn Claude

```bash
SYSTEM_PROMPT=$(cat "${WORKERS_DIR}/system-prompt.md")

# Build the task prompt with title, description, acceptance criteria, and output paths
PROMPT="# ${TASK_TITLE}
${TASK_DESCRIPTION}

## Acceptance Criteria
${TASK_CRITERIA}

## Output
- Deliverables: ${OUTPUT_DIR}
- Notes: ${NOTES_FILE}
- When done, update status:
  curl -s -X PATCH ${DASHBOARD_URL}/api/tasks/${TASK_ID} \\
    -H 'Content-Type: application/json' \\
    -d '{\"status\":\"needs_review\",\"claudeNotes\":\"<summary>\",\"completionFile\":\"<path>\"}'"

# If there's a slash command, inject its content between description and output
# If there's a revision request, inject the feedback before the workflow

CLAUDE_ARGS=(-p --dangerously-skip-permissions --output-format json --model "$TASK_MODEL" --system-prompt "$SYSTEM_PROMPT")

# Resume previous session if available (for revisions)
if [[ -n "$TASK_SESSION_ID" ]]; then
  CLAUDE_ARGS+=(--resume "$TASK_SESSION_ID")
fi

CLAUDE_OUTPUT=$(timeout "$TIMEOUT_SECONDS" claude "${CLAUDE_ARGS[@]}" "$PROMPT" 2>&1) || CLAUDE_EXIT=$?
```

Key flags:
- `-p` — print mode (non-interactive, takes prompt as argument)
- `--dangerously-skip-permissions` — no interactive permission prompts (required for headless operation)
- `--output-format json` — structured output so we can capture `session_id`
- `--model` — from the task's `model` field
- `--system-prompt` — worker instructions
- `--resume` — continue a previous Claude session (for revisions)

#### Step 8: Capture Session ID

```bash
NEW_SESSION_ID=$(echo "$CLAUDE_OUTPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
if [[ -n "$NEW_SESSION_ID" ]]; then
  curl -s -X PATCH "${DASHBOARD_URL}/api/tasks/${TASK_ID}" \
    -H "Content-Type: application/json" \
    -d "{\"claudeSessionId\": \"$NEW_SESSION_ID\"}"
fi
```

Store the session ID on the task so future revision runs can resume the conversation.

#### Step 9: Handle Success

```bash
# Find the primary output file
COMPLETION_FILE=""
for candidate in "$OUTPUT_DIR"/README.md "$OUTPUT_DIR"/index.* "$OUTPUT_DIR"/report.* "$OUTPUT_DIR"/output.*; do
  [[ -f "$candidate" ]] && { COMPLETION_FILE="workers/workspace/outputs/${TASK_ID}/$(basename "$candidate")"; break; }
done
# Fallback: first file in output dir
[[ -z "$COMPLETION_FILE" ]] && COMPLETION_FILE=$(find "$OUTPUT_DIR" -maxdepth 1 -type f | head -1)

# Read Claude's notes
CLAUDE_NOTES="Task completed. Check outputs directory."
[[ -f "$NOTES_FILE" ]] && CLAUDE_NOTES=$(head -c 500 "$NOTES_FILE")

# Check if Claude already updated the task (preserve its values if better)
EXISTING=$(curl -s "${DASHBOARD_URL}/api/tasks/${TASK_ID}")
EXISTING_COMPLETION=$(echo "$EXISTING" | jq -r '.completionFile // ""')
EXISTING_NOTES=$(echo "$EXISTING" | jq -r '.claudeNotes // ""')

FINAL_COMPLETION="${EXISTING_COMPLETION:-$COMPLETION_FILE}"
FINAL_NOTES="${EXISTING_NOTES:-$CLAUDE_NOTES}"

# Update task — script always ensures all three fields are set
curl -s -X PATCH "${DASHBOARD_URL}/api/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"needs_review\", \"completionFile\": \"$FINAL_COMPLETION\", \"claudeNotes\": \"$FINAL_NOTES\"}"
```

**Important:** The script deterministically sets the final status — it doesn't rely solely on Claude having called the API itself. Claude *may* update the task during execution (and those values are preserved if present), but the script always ensures a consistent final state. This is **determinism over probabilism**.

#### Step 10: Handle Failure

```bash
ERROR_NOTE="Worker failed with exit code $CLAUDE_EXIT."
[[ $CLAUDE_EXIT -eq 124 ]] && ERROR_NOTE="Worker timed out after ${TIMEOUT_SECONDS} seconds."

curl -s -X PATCH "${DASHBOARD_URL}/api/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"pending\", \"claudeNotes\": \"$ERROR_NOTE\"}"
```

The task goes back to `pending` with the error recorded. On the next cron run, it will be picked up again automatically. This gives you free retry behavior.

#### Step 11: Update Cron Config

```bash
curl -s -X PUT "${DASHBOARD_URL}/api/cron-config" \
  -H "Content-Type: application/json" \
  -d "{\"lastRun\": \"$(date -Iseconds)\", \"lastTaskId\": \"$TASK_ID\"}"
```

Always runs — even if no task was found. This lets the dashboard show "last checked" time.

---

## 7. System Prompt

The system prompt is a markdown file loaded by the worker script and passed to every Claude instance via `--system-prompt`. It defines how Claude behaves as a worker.

### Template

```markdown
# Worker — System Prompt

You are an autonomous worker. You execute tasks and produce deliverables.
The human operator reviews everything before it goes live.

## Workspace Rules

- Put deliverables in the **output directory** given in the task prompt
- Write working notes to the **notes file** given in the task prompt
- Never modify files outside your assigned directories unless the workflow
  explicitly instructs you to
- Never delete or overwrite files you did not create

## Workflow Templates

If the task includes a **Workflow** section, follow it precisely.
The workflow is the HOW. The task description is the WHAT.

## Task Completion

- Always update the task via the API when finished (see Output section in prompt)
- Set status to `needs_review` — never `completed` (the human decides that)
- Write a concise `claudeNotes` summary the human can act on
- Address ALL acceptance criteria; if you can't fully complete one,
  explain what remains in claudeNotes

## Quality

- Ground work in real data. Don't generate from nothing.
- Quality over quantity. One good deliverable beats five mediocre ones.
- If something is ambiguous, make a reasonable choice and note it.

## Error Handling

- Document errors in your notes file with full context
- Always update task status, even on failure
- If the API is unreachable, write status to your notes file for manual reconciliation
```

Customize this for your domain. Add task-type-specific guidance, brand voice rules, or tool usage instructions as needed.

---

## 8. Cron Integration

### Crontab Entry

```
*/10 * * * * cd /path/to/your/project && bash workers/run-worker.sh >> workers/logs/cron.log 2>&1 # YOUR-PROJECT-WORKER
```

- `*/10` — every 10 minutes (adjust as needed)
- `cd` ensures the script runs from the project root
- Output appends to a persistent cron log
- The `# YOUR-PROJECT-WORKER` marker lets you programmatically find and replace this entry

### Supported Intervals

| Minutes | Cron Expression | Use Case |
|---------|----------------|----------|
| 5 | `*/5 * * * *` | High-throughput, many small tasks |
| 10 | `*/10 * * * *` | Good default for most systems |
| 15 | `*/15 * * * *` | Moderate workload |
| 30 | `*/30 * * * *` | Light workload |
| 60 | `0 * * * *` | Hourly check-ins |
| 120 | `0 */2 * * *` | Low priority background work |
| 240 | `0 */4 * * *` | Batch processing |

### Install/Remove via Dashboard

If you want the dashboard to manage the crontab entry:

```typescript
const MARKER = '# YOUR-PROJECT-WORKER';

async function installCron(intervalMinutes: number): Promise<void> {
  const current = await readCrontab();
  const lines = current.split('\n').filter(line => !line.includes(MARKER));
  const expression = intervalMinutes < 60
    ? `*/${intervalMinutes} * * * *`
    : `0 */${intervalMinutes / 60} * * *`;
  lines.push(`${expression} cd /path/to/project && bash workers/run-worker.sh >> workers/logs/cron.log 2>&1 ${MARKER}`);
  await writeCrontab(lines.join('\n'));
}

async function removeCron(): Promise<void> {
  const current = await readCrontab();
  const lines = current.split('\n').filter(line => !line.includes(MARKER));
  await writeCrontab(lines.join('\n'));
}
```

---

## 9. Lockfile & Concurrency

### Why

Cron may fire a new run while the previous one is still executing (especially with 5-minute intervals and a 30-minute timeout). The lockfile ensures only one worker runs at a time.

### Mechanism

| Behavior | Detail |
|----------|--------|
| **Lock type** | `flock` (file descriptor lock) — kernel-level, process-scoped |
| **Mode** | Non-blocking (`flock -n`). If lock is held, exit immediately. |
| **Lock path** | `/tmp/your-project-worker.lock` |
| **Auto-release** | Lock is released when the script exits (normal or crash) |
| **Stale detection** | If lockfile mtime is older than `STALE_LOCK_SECONDS` (35 min), assume the holder crashed |
| **Stale recovery** | Kill the stale holder via `fuser -k`, wait 2 seconds, retry lock |

### Why 35 Minutes?

The task timeout is 30 minutes. The stale threshold is 35 minutes (30 min task + 5 min buffer for script overhead). If a lock is older than that, the holder is definitely dead or hung.

---

## 10. Task Chaining

Tasks can be linked via `parentTaskId` to create execution chains. A child task won't be picked up by the worker until its parent is no longer `pending` or `in_progress`.

### How It Works

```
Parent Task (pending) --> Worker picks it up --> (needs_review or completed)
                                                        |
                                              Child task becomes eligible
                                                        |
                                              Worker picks it up next run
```

### Selection Logic

```
blocked_parents = [task.id for task in all_tasks if task.status in ("pending", "in_progress")]

eligible = [
  task for task in all_tasks
  if task.status == "pending"
  and (task.parentTaskId is null OR task.parentTaskId NOT IN blocked_parents)
]

selected = min(eligible, key=lambda t: (t.priority, t.createdAt))
```

### Example: Post-Event Pipeline

Create 3 chained tasks after an event:

```
Task A: "Update database"         (parentTaskId: null)     -- runs first
Task B: "Generate report"         (parentTaskId: A.id)     -- runs after A finishes
Task C: "Send notification"       (parentTaskId: B.id)     -- runs after B finishes
```

You can also fan out — multiple children with the same parent:

```
Task A: "Process data"            (parentTaskId: null)     -- runs first
Task B: "Generate charts"         (parentTaskId: A.id)     -- runs after A
Task C: "Generate summary"        (parentTaskId: A.id)     -- also runs after A (next cron cycle)
```

---

## 11. Slash Commands

Slash commands are reusable workflow templates stored as markdown files. When a task has a `slashCommand` field, the worker loads the corresponding file and injects its content into Claude's prompt.

### File Location

```
~/.claude/commands/{slash-command-path}.md
```

Example: a task with `slashCommand: "worker/generate-report"` loads `~/.claude/commands/worker/generate-report.md`.

### Prompt Structure

```
# {Task Title}

{Task Description}

## REVISION REQUESTED           <-- only if revision notes present
{Revision feedback}

## Workflow                     <-- only if slashCommand is set
{Content of the slash command file}

---

## Output
- Deliverables: {output_dir}
- Notes: {notes_file}
- API update command...
```

### Writing a Slash Command

A slash command is a markdown file with instructions for Claude. It can reference variables from the task (description, tags, etc.) but typically provides the *method* while the task provides the *specifics*.

Example `~/.claude/commands/worker/generate-report.md`:

```markdown
Follow these steps to generate the report:

1. Read the source data referenced in the task description
2. Analyze for key trends and outliers
3. Write a structured report with:
   - Executive summary (3 sentences max)
   - Key findings (bulleted)
   - Data tables
   - Recommendations
4. Save as `report.md` in the output directory
5. Write your analysis notes to the notes file
```

---

## 12. Revision Loop

When the human reviews output and wants changes:

### How to Request a Revision

1. On the dashboard, set the task's `claudeNotes` to a value prefixed with `[REVISION REQUESTED]` followed by the feedback
2. Set the task's status back to `pending`

### How the Worker Handles It

The worker script detects the `[REVISION REQUESTED]` prefix in `claudeNotes` and builds a revision section:

```markdown
## REVISION REQUESTED

The operator reviewed your previous output and is requesting changes.
Address this feedback:

{feedback text}

Previous output is in: {output_dir}
Revise the existing deliverable -- do not start from scratch.
```

This gets injected into Claude's prompt before the workflow section.

### Session Resumption

If the task has a `claudeSessionId` (captured from the previous run), the worker passes `--resume {sessionId}` to the Claude CLI. This means Claude picks up with full context from the previous run — it knows what it already did and can make targeted changes.

---

## 13. Auto-Complete Rules

By default, every successful task goes to `needs_review`. But some task types may have their own review surface or need to unblock downstream tasks immediately. For these, the worker can set `status = completed` directly.

### Configuration

In the worker script, define which slash commands (or task types) auto-complete:

```bash
FINAL_STATUS="needs_review"  # default

# Auto-complete tasks that have separate review flows or unblock chains
if [[ "$TASK_SLASH_COMMAND" == "worker/update-database" ||
      "$TASK_SLASH_COMMAND" == "worker/extract-data" ]]; then
  FINAL_STATUS="completed"
fi
```

### When to Auto-Complete

Auto-complete a task type when:
- It has its own review surface (e.g., extracted data that gets reviewed separately)
- It's a dependency that must complete to unblock children (and the children have their own review)
- Its output is deterministic and doesn't need human judgment

When in doubt, default to `needs_review`.

---

## 14. Workspace Layout

```
workers/
  run-worker.sh              -- The main cron script
  system-prompt.md           -- Claude worker instructions
  workspace/
    outputs/{task-id}/       -- Deliverables per task (reports, code, content, etc.)
    notes/{task-id}.md       -- Claude's working notes per task (reasoning, issues, decisions)
  logs/
    cron.log                 -- Aggregated cron output (appended)
    worker-{timestamp}.log   -- Individual per-run logs
```

### Completion File Resolution

The worker script scans the output directory to find the "primary" deliverable and stores its path in `completionFile`. Priority order:

1. `README.md`
2. `index.*`
3. `report.*`
4. `output.*`
5. First file found (fallback)

This path is what the dashboard displays as the review link. Customize the priority order for your use case.

---

## 15. Logging

### Per-Run Logs

Every worker invocation creates `workers/logs/worker-{YYYYMMDD-HHMMSS}.log` containing:

- Timestamp of start/end
- Which task was selected (ID, title, priority, model)
- Claude's full output
- Exit code
- Status update result

### Cron Log

All stdout/stderr from cron runs appends to `workers/logs/cron.log`. Useful for seeing the overall pattern of worker activity.

### Log Rotation

Logs accumulate. Add a periodic cleanup (e.g., delete logs older than 30 days) or use `logrotate`.

---

## 16. Dashboard UI Requirements

### Minimum Viable Dashboard

At minimum, your dashboard needs:

#### Task List Page
- Display all tasks sorted by priority
- Show: title, status (color-coded), priority, type, tags, created date
- Filter by status (pending, in_progress, needs_review, completed)
- Click to view task detail

#### Task Detail / Edit
- Edit all task fields
- Buttons: "Mark Completed", "Request Revision" (sets `[REVISION REQUESTED]` + back to pending)
- Display `claudeNotes` and link to `completionFile`
- Display `captainNotes` field for human feedback

#### Task Create Form
- Title, description, type, priority, model, tags, acceptance criteria
- Optional: slash command, parent task ID

#### Settings / Cron Page
- Toggle cron on/off
- Set interval
- Show last run time and last task ID

#### File Viewer (Optional but Recommended)
- API route to serve files from the workspace directory
- Lets the human review output files directly in the browser without leaving the dashboard

---

## 17. Cron Config Management

### Data Model

```json
{
  "enabled": true,
  "intervalMinutes": 10,
  "lastRun": "2026-03-27T14:30:00-04:00",
  "lastTaskId": "task-1711561800-a3b2c1"
}
```

### Dashboard Controls

- **Enable/Disable toggle** — installs or removes the crontab entry
- **Interval dropdown** — changes the cron schedule
- **Last Run display** — shows when the worker last checked for tasks
- **Last Task display** — links to the last task the worker touched

### Worker Updates

The worker script calls `PUT /api/cron-config` at the end of every run (even if no task was found) to update `lastRun`. If a task was processed, it also updates `lastTaskId`.

---

## 18. How to Test

### Manual Testing (No Cron Needed)

```bash
# 1. Start the dashboard
cd dashboard && npm run dev

# 2. Create a task via the UI or API
curl -X POST http://localhost:YOUR_PORT/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test task",
    "description": "Write a haiku about testing.",
    "type": "Content",
    "priority": 3,
    "acceptanceCriteria": ["Contains exactly 3 lines", "Follows 5-7-5 syllable pattern"]
  }'

# 3. Run the worker manually
bash workers/run-worker.sh

# 4. Check the output
ls workers/workspace/outputs/
cat workers/workspace/notes/*.md

# 5. Check the task status on the dashboard
#    It should be "needs_review" with a completionFile and claudeNotes
```

### Verifying the Lifecycle

1. Create a task -> verify status is `pending`
2. Run worker -> verify status is `in_progress` (briefly) then `needs_review`
3. Check `completionFile` points to a real file
4. Check `claudeNotes` has a useful summary
5. Mark as completed via dashboard -> verify status is `completed`

### Testing Task Chaining

1. Create Task A (no parent)
2. Create Task B with `parentTaskId: A.id`
3. Run worker -> should pick Task A (B is blocked)
4. Run worker again -> should pick Task B (A is now done)

### Testing Revision

1. Run a task to `needs_review`
2. Set `claudeNotes` to `[REVISION REQUESTED] Make it funnier`
3. Set status to `pending`
4. Run worker -> Claude should address the revision feedback

### Testing Failure Recovery

1. Create a task that will fail (e.g., impossible instructions)
2. Run worker -> task should revert to `pending` with error in `claudeNotes`
3. Run worker again -> task retries

---

## 19. Extension Points

These are optional features you can add on top of the base system:

### Pipeline Stages

Link tasks into multi-stage pipelines where completing one stage automatically creates the next. Requires:
- `pipelineId` — shared across all tasks in a pipeline
- `pipelineStage` — current stage name
- A stage progression map in the worker script
- Auto-create logic after auto-complete tasks finish

### Scheduled Task Creation

Run additional cron scripts that check external sources (calendars, APIs, webhooks) and create tasks automatically. The worker picks them up on its next run.

### Model Escalation

Start tasks on a cheaper model (haiku/sonnet). If the task fails or the output doesn't meet acceptance criteria, retry with a more capable model (opus). Implement as a retry counter on the task with model escalation logic in the worker.

### Parallel Workers

For high-throughput systems, you could run multiple workers by using per-task locking instead of a global lockfile. Each worker claims a task atomically via the API. Requires adding optimistic locking or a claim endpoint to the API.

### Webhook Notifications

Hit a webhook (Slack, Discord, email) when a task moves to `needs_review` so the human gets notified without watching the dashboard.

---

## 20. Implementation Checklist

### Phase 1: Foundation
- [ ] Set up project directory structure (workers/, data/, etc.)
- [ ] Create `Task` and `CronConfig` data models
- [ ] Build JSON file read/write utilities
- [ ] Build dashboard API: `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id`
- [ ] Build dashboard API: `GET/PUT /api/cron-config`
- [ ] Verify API works with curl

### Phase 2: Worker Script
- [ ] Write `run-worker.sh` with lockfile, fetch, claim, spawn, and result handling
- [ ] Write `system-prompt.md`
- [ ] Test manually: create task -> run worker -> verify needs_review
- [ ] Test failure: verify task reverts to pending with error

### Phase 3: Dashboard UI
- [ ] Task list page with status filters
- [ ] Task create/edit form
- [ ] Task detail view (claudeNotes, completionFile link)
- [ ] "Mark Completed" and "Request Revision" buttons
- [ ] Cron settings page (enable/disable, interval, last run)

### Phase 4: Cron & Polish
- [ ] Install crontab entry (manually or via dashboard)
- [ ] Test full cycle: cron fires -> worker runs -> task goes to needs_review -> human approves
- [ ] Add task chaining support (parentTaskId logic)
- [ ] Add slash command injection
- [ ] Add revision loop
- [ ] Add file viewer API for reviewing output in-browser

### Phase 5: Extensions (Optional)
- [ ] Pipeline stages with auto-progression
- [ ] Scheduled task creation from external triggers
- [ ] Webhook notifications on needs_review
- [ ] Log rotation

---

## Dependencies

| Tool | Purpose | Required |
|------|---------|----------|
| `claude` CLI | Executing tasks | Yes |
| `curl` | API communication | Yes |
| `jq` | JSON parsing in bash | Yes |
| `flock` | Lockfile (part of `util-linux`) | Yes |
| `timeout` | Task timeout (part of `coreutils`) | Yes |
| `fuser` | Stale lock recovery (part of `psmisc`) | Yes |
| Node.js / Python / etc. | Dashboard runtime | Yes (your choice) |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **JSON files, not a database** | Simplicity. One worker at a time + file locks = safe enough. No deployment overhead. |
| **Script updates status, not just Claude** | Determinism over probabilism. Claude *may* update the task, but the script always ensures a consistent final state. |
| **needs_review as default end state** | Nothing ships without human approval. The human is the quality gate. |
| **Pending on failure = auto-retry** | No manual intervention needed for transient failures. The next cron run picks it up. |
| **Global lockfile, not per-task** | One worker at a time keeps the system simple and prevents resource contention. Scale with longer timeouts, not more workers. |
| **Slash commands as file injection** | Reusable workflows without code changes. Add a markdown file, reference it on a task. |
| **Session resumption on revision** | Claude keeps context from the previous run. Produces better revisions than starting fresh. |
