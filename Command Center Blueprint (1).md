# Command Center Blueprint

> A bare-bones spec for building your own AI-powered task management system with a Next.js dashboard and autonomous Claude worker.

---

## What This System Does

You create tasks in a dashboard. A cron job fires every N minutes, picks the highest-priority pending task, hands it to Claude Code (CLI), and Claude does the work. When Claude finishes, the task moves to a "Needs Review" bin. You review the output, approve it, or send it back with revision notes. That's it.

```
You (Human)                 Dashboard (See)              Claude Worker (Do)
    |                            |                             |
    +-- Reviews output           +-- Task list + status        +-- Picks highest-priority task
    +-- Approves / revises       +-- Create new tasks          +-- Executes via Claude CLI
    +-- Makes final decisions    +-- Worker on/off + interval  +-- Writes deliverables
    |                            +-- http://localhost:3000     +-- Moves task to "Needs Review"
    |                            |                             |
    +------- nothing goes live without your approval ----------+
```

---

## Architecture Overview

### Three moving parts

1. **Dashboard** -- Next.js app with a JSON file as the database. Shows tasks, lets you create them, filter by status, review output. Also has a Settings page to enable/disable the worker and set its interval.

2. **Worker script** (`run-worker.sh`) -- A bash script triggered by cron. It calls the dashboard API to get pending tasks, picks the top one, spawns `claude -p` to execute it, then updates the task status via the API.

3. **Cron** -- System crontab entry managed by the dashboard. The Settings page installs/removes the crontab entry automatically.

### Data flow

```
Cron fires (every N minutes)
  -> run-worker.sh acquires file lock (one worker at a time)
  -> GET /api/tasks -> finds highest-priority pending task
  -> PATCH /api/tasks/{id} -> sets status to "in_progress"
  -> Spawns: claude -p --system-prompt worker-prompt.md "task details"
  -> Claude writes deliverables to workspace/outputs/{task-id}/
  -> Claude writes notes to workspace/notes/{task-id}.md
  -> Script PATCH /api/tasks/{id} -> status: "needs_review", completionFile: "path/to/output"
  -> You open dashboard, review the output, approve or revise
```

---

## Directory Structure

```
your-command-center/
  dashboard/                    -- Next.js app
    app/
      layout.tsx                -- Root layout
      tasks/page.tsx            -- Task list page (main page)
      settings/page.tsx         -- Worker settings page
      api/
        tasks/route.ts          -- GET all, POST create
        tasks/[id]/route.ts     -- GET one, PATCH update, DELETE
        cron-config/route.ts    -- GET/PUT worker schedule config
        worker-status/route.ts  -- GET last run info
        files/[...path]/route.ts -- Serve completion files
    components/
      Nav.tsx                   -- Navigation bar
      TaskCard.tsx              -- Individual task row
      TaskForm.tsx              -- Create task form
      StatusBadge.tsx           -- Colored status pill
      PriorityIndicator.tsx     -- Priority dot + label
      CronConfigPanel.tsx       -- Worker toggle + interval picker
    lib/
      types.ts                  -- TypeScript interfaces
      data.ts                   -- JSON file I/O (the "database")
      utils.ts                  -- ID generation, date formatting
      cron.ts                   -- Install/remove crontab entries
    data/
      tasks.json                -- Task database (JSON array)
      cron-config.json          -- Worker schedule state
  workers/
    run-worker.sh               -- Cron entry point (the worker)
    system-prompt.md            -- Instructions given to Claude
    workspace/
      outputs/{task-id}/        -- Where Claude puts deliverables
      notes/{task-id}.md        -- Where Claude puts working notes
    logs/
      worker-{timestamp}.log    -- Per-run execution logs
      cron.log                  -- Aggregated cron output
  config/
    paths.json                  -- External directory paths (never hardcode)
```

---

## Data Model

### Task

This is the core object. Everything revolves around it.

```typescript
interface Task {
  id: string;                    // "task-{timestamp}-{random}"
  title: string;
  description: string;
  type: string;                  // Category: "Research", "Content", "Admin", etc.
  status: 'pending' | 'in_progress' | 'completed' | 'needs_review';
  priority: 1 | 2 | 3 | 4 | 5; // 1 = highest
  model: 'sonnet' | 'opus' | 'haiku';  // Which Claude model to use
  acceptanceCriteria: string[];  // Checklist the worker must satisfy
  claudeNotes: string;          // Worker's summary of what it did
  completionFile: string | null; // Path to the output deliverable
  createdAt: string;            // ISO timestamp
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  tags: string[];
  slashCommand: string | null;  // Optional workflow template name
  parentTaskId: string | null;  // For task chains (child waits for parent)
}
```

**Customize the `type` field** to match your business categories. The reference implementation uses: Research, Content, Coaching, Building, Outreach, Admin. Pick whatever makes sense for you.

### CronConfig

```typescript
interface CronConfig {
  enabled: boolean;
  intervalMinutes: number;       // 5, 10, 15, 30, 60, etc.
  lastRun: string | null;       // ISO timestamp of last worker run
  lastTaskId: string | null;    // ID of last task the worker picked up
}
```

### Task Status Transitions

These are the only valid transitions. Don't allow arbitrary jumps.

```
pending ---------> in_progress     (worker picks it up)
in_progress -----> needs_review    (worker finishes)
needs_review ----> completed       (you approve)
needs_review ----> pending         (you revise -- notes go into claudeNotes)
completed -------> pending         (you reopen)
```

---

## Component: Dashboard

### Stack

- **Next.js** (App Router) with React, Tailwind CSS, TypeScript
- **Flat JSON files** as the database (no Postgres, no SQLite -- just files)
- All data access goes through a single `lib/data.ts` file

### API Routes

#### `GET /api/tasks`
Returns all tasks sorted by priority (ascending), then by createdAt (descending).

#### `POST /api/tasks`
Creates a new task. Accepts a partial Task object. Server fills in `id`, `createdAt`, `updatedAt`, defaults.

#### `GET /api/tasks/[id]`
Returns a single task by ID.

#### `PATCH /api/tasks/[id]`
Updates a task. Accepts partial updates. Server merges with existing, updates `updatedAt`, prevents `id` and `createdAt` from being overwritten.

#### `DELETE /api/tasks/[id]`
Deletes a task.

#### `GET /api/cron-config`
Returns the current cron configuration.

#### `PUT /api/cron-config`
Updates cron configuration. If `enabled` changes or `intervalMinutes` changes, the server installs or removes the actual system crontab entry.

#### `GET /api/worker-status`
Returns `{ lastRun, lastTaskId, enabled, intervalMinutes }` for dashboard status display.

#### `GET /api/files/[...path]`
Serves completion files from the workspace directory. Include path traversal prevention (reject `..`).

### Data Access Layer (`lib/data.ts`)

**All task I/O goes through this file.** Never import `data/tasks.json` directly.

```typescript
// Core functions you need:
getTasks(): Promise<Task[]>
getTask(id: string): Promise<Task | null>
createTask(input: Partial<Task>): Promise<Task>
updateTask(id: string, updates: Partial<Task>): Promise<Task | null>
deleteTask(id: string): Promise<boolean>
getCronConfig(): Promise<CronConfig>
saveCronConfig(config: CronConfig): Promise<void>
```

Implementation: read the JSON file, parse, manipulate, write back. The `createTask` function generates a unique ID (`task-{timestamp}-{random}`), fills in defaults, and appends to the array.

### Cron Management (`lib/cron.ts`)

Manages the system crontab programmatically. Key functions:

- `installCron(intervalMinutes)` -- Reads current crontab, removes any existing entry with a marker comment, adds a new cron line, writes it back.
- `removeCron()` -- Reads crontab, removes the marked entry, writes it back.

Use a unique marker comment (e.g., `# MY-WORKER`) to identify your cron entry safely.

```typescript
// Cron expression logic:
// < 60 min:  */N * * * *        (e.g., */5 * * * *)
// = 60 min:  0 * * * *
// > 60 min:  0 */H * * *        (e.g., 0 */2 * * *)
```

### Pages

#### `/tasks` (Main page)
- Lists all tasks with priority indicator, status badge, title, type
- Filter by status (All / Pending / In Progress / Needs Review / Completed)
- Create new task button -> shows inline form
- Each task card shows:
  - Priority dot (P1 red, P2 orange, P3 yellow, P4 blue, P5 gray)
  - Status badge (gray/blue/amber/teal pill)
  - Title, type, tags
  - Claude's notes (when available)
  - Link to completion file (when available)
  - Actions: approve, revise (with notes), delete
- Auto-refreshes every 30 seconds

#### `/settings`
- Worker enable/disable toggle
- Interval picker (5, 10, 15, 30, 60, 120, 240 minutes)
- Status display (last run time, last task ID)
- Save button that calls `PUT /api/cron-config`

### UI Design Notes

The reference is Notion-inspired minimalism on a dark background. The principle: the UI is a document, not an app. Content leads; chrome gets out of the way. When in doubt, remove a border, flatten a card, shrink a font weight. If it starts to feel like a SaaS dashboard, you've gone too far.

#### Color palette

- Background: `#191919`
- Cards / elevated surfaces: `#202020`
- Inputs / secondary fill: `#2F2F2F`
- Hover fill: `#363636` / `#373737`
- Borders (everywhere): `#373737` or `#2F2F2F` (1px, never thicker)
- Text: white (primary) / `#9B9B9B` (secondary) / `#6B6B6B` (tertiary, labels, metadata)
- Primary accent: `#4DAB9A` (teal) -- used for approve, save, active states, completion
- Status colors: pending `#6B6B6B` (gray), in_progress `#4DA3D4` (blue), needs_review `#D4A04D` (amber), completed `#4DAB9A` (teal)
- Priority dots: P1 `#FF4D4D`, P2 `#FF8C4D`, P3 `#FFD04D`, P4 `#4DA3D4`, P5 `#6B6B6B`
- Tinted pills: use `{color}20` (12% alpha) for backgrounds with the solid color for text -- this is the one and only way colored labels appear

#### Typography

- Font family: Inter (loaded via `next/font/google`), falls back to system sans. Monospace (`ui-monospace, SFMono-Regular, Menlo`) only for IDs, timestamps, file paths.
- Antialiased (`-webkit-font-smoothing: antialiased`).
- Headings: `h1` 2.25rem / 700, `h2` 1.5rem / 600, `h3` 1.125rem / 600. Tight line-height (1.2-1.4) and slight negative letter-spacing (`-0.02em` to `-0.025em`) on h1/h2.
- Body: 0.875rem (`text-sm`) is the workhorse size. Labels and metadata are 0.75rem (`text-xs`). Paragraph line-height 1.7.
- Font weights: use 400 (default), 500 (`font-medium`) for emphasis, 600 (`font-semibold`) for headings. Avoid 700+ in UI chrome; it reads as chunky.
- The nav brand is small caps: `text-sm font-semibold tracking-wide uppercase`.

#### Density and spacing

- Page container: `max-w-5xl mx-auto px-4 py-6` (or `px-6`). Don't let content sprawl edge-to-edge.
- Task rows are rows, not cards: a bottom border (`border-b border-[#2F2F2F]`), `py-3 px-3`, no background until hover. Rows use flex with `gap-4`. Expanded detail slides in below the row.
- Actual cards (settings panels, forms): `bg-[#202020] border border-[#373737] rounded-lg p-4` or `p-5`. Internal sections `space-y-4` or `space-y-6`.
- Buttons: `px-3 py-1.5 text-xs font-medium` for inline actions, `px-4 py-2 text-sm font-medium` for primary submits. Never larger.
- Inputs: `px-3 py-2 text-sm`. Labels above inputs are `text-xs font-medium text-[#9B9B9B] mb-1`.
- Pills and tags: `px-2 py-0.5 text-xs`. Keep them short.
- Gap scale: `gap-1.5`, `gap-2`, `gap-3`, `gap-4`, `gap-6`, `gap-8`. Stick to this ladder.

#### Chrome minimalism

- No drop shadows. Anywhere. Depth comes from 1-step background tint shifts (`#191919` -> `#202020` -> `#2F2F2F`), not elevation.
- No gradients (one narrow exception: a subtle fade-to-transparent overlay when truncating long text blocks).
- Border-radius ladder: `rounded` (4px, the default for buttons/inputs/tags), `rounded-lg` (8px, for card containers), `rounded-full` (pills, toggles, status dots). **Never `rounded-xl` or `rounded-2xl`.**
- Borders are always 1px and always in the grayscale palette. Colored borders appear only for rare emphasis (e.g., a `border-l-2` accent on a callout).
- No dividers beyond what rows and card borders already provide. Empty space is the separator.
- Scrollbars are hidden (`scrollbar-width: none`). The page scrolls; the chrome doesn't advertise it.

#### Icons

- Inline SVG from the Heroicons outline family, sized `w-3 h-3` to `w-4 h-4`, `strokeWidth={1.5}` or `{2}`, `fill="none"`, `stroke="currentColor"`.
- Used sparingly: chevrons for expand/collapse, an X for remove, a chat bubble for a reply action. No icon on every button. No icon-only navigation.
- Icons inherit text color via `currentColor` -- don't hardcode colors on them.

#### Interaction

- Hover: swap a background (`hover:bg-[#202020]`, `hover:bg-[#373737]`) or bump text from `#6B6B6B` to white. Always with `transition-colors` (no transform, no scale, no shadow-on-hover).
- Focus on inputs: replace the border color with `#4DAB9A` and remove the default outline (`focus:outline-none focus:border-[#4DAB9A]`). No focus rings.
- Active nav item: text goes from `#6B6B6B` to white + `font-medium`. No underline, no pill, no background.
- Toggles and checkboxes: custom-styled to match (teal fill when on, gray border when off). The native appearance is always turned off.
- Buttons: subtle -- secondary actions are `bg-[#2F2F2F] text-[#9B9B9B]` that darken and brighten text on hover. Destructive (delete) is text-only by default and turns red on hover (`hover:bg-[#FF4D4D20] hover:text-[#FF4D4D]`).
- Expansion: click-the-row-to-expand is the primary disclosure pattern, with a chevron that rotates 180deg. Avoid modals for per-item detail.

#### What not to do

- No `rounded-2xl` cards, no drop shadows, no gradient buttons, no glassmorphism.
- No bold accent colors for large surfaces -- teal is a highlight, never a panel.
- No oversized hero sections, no illustrations, no marketing-style typography.
- No icon next to every label; no emoji in UI.
- No pastel badges or filled status buttons -- status colors appear only as tinted pills (`{color}20` background, solid color text).
- No dense multi-column tables -- use rows with optional expanded detail instead.
- No heavy borders, ring utilities, or focus halos.
- Don't reach for a new font weight, color, or radius when an existing one works. The constrained palette is the aesthetic.

---

## Component: Worker System

### The Worker Script (`run-worker.sh`)

This is a bash script that cron calls. Here's what it does step by step:

```
1. Acquire file lock (flock) -- prevents concurrent workers
2. Check for stale locks (> 35 min old) -- kill and reclaim if stale
3. Set up logging to workers/logs/worker-{timestamp}.log
4. Check dependencies: curl, jq, claude, timeout
5. GET /api/tasks -- fetch all tasks
6. Find highest-priority pending task (sort by priority asc, createdAt asc)
7. Skip tasks whose parentTaskId points to a still-pending/in_progress task
8. PATCH /api/tasks/{id} -- set status to "in_progress"
9. Create workspace: outputs/{task-id}/ and notes/{task-id}.md
10. Build prompt from task title + description + acceptance criteria
11. If task has a slashCommand, load the workflow template from
    ~/.claude/commands/{slashCommand}.md and inject it into the prompt
12. If claudeNotes contains "[REVISION REQUESTED]", extract the feedback
    and prepend a revision section to the prompt
13. Spawn: timeout 1800 claude -p --dangerously-skip-permissions \
      --output-format json --model {model} \
      --system-prompt system-prompt.md "{prompt}"
14. On success: find primary output file, read notes, PATCH task to
    "needs_review" with completionFile and claudeNotes
15. On failure/timeout: PATCH task back to "pending" with error note
16. Update cron config with lastRun timestamp
```

#### Key design decisions

- **One worker at a time.** File lock (`flock`) prevents races. If cron fires while a worker is still running, the second invocation exits immediately.
- **Script owns the state machine.** The bash script handles all status transitions deterministically. Claude just produces the work product. Don't rely on Claude to update its own task status.
- **Parent blocking.** If a task has a `parentTaskId` and that parent is still pending or in_progress, skip it. This enforces sequential execution within task chains without explicit ordering fields.
- **Failure is safe.** If Claude errors or times out (exit 124), the task reverts to "pending" and will be retried on the next cron cycle.
- **30-minute timeout.** Prevents runaway workers. Stale lock detection at 35 minutes as a safety net.

### System Prompt (`workers/system-prompt.md`)

Keep it minimal. The system prompt tells Claude:
- Where to put deliverables (the output directory from the task prompt)
- Where to put working notes (the notes file from the task prompt)
- Not to modify files outside its workspace
- To set status to `needs_review`, never `completed` (you decide that)
- To address all acceptance criteria
- Quality standards

```markdown
# Worker System Prompt

You are an autonomous worker. You execute tasks and the human reviews
your output before anything goes live.

## Rules
- Put deliverables in the output directory specified in the task
- Write working notes to the notes file specified in the task
- Never modify files outside your designated workspace
- Set status to "needs_review" when done (never "completed")
- Address all acceptance criteria listed in the task
- If something is ambiguous, make a reasonable choice and note it
- Document errors in your notes file
```

### Slash Commands (Workflow Templates)

Optional but powerful. A slash command is a markdown file at `~/.claude/commands/{name}.md` that contains step-by-step instructions for a specific type of work. When a task has a `slashCommand` field, the worker loads that file and injects it into Claude's prompt as a "Workflow" section.

Example: `~/.claude/commands/worker/summarize-doc.md`
```markdown
# Summarize Document

1. Read the document at the path specified in the task description
2. Write a 3-paragraph executive summary
3. List 5 key takeaways as bullet points
4. Note any action items mentioned
5. Save to {output_dir}/summary.md
```

This separation means the task description is the "WHAT" (which document, which client) and the slash command is the "HOW" (step-by-step process).

### Revision Loop

When you review a task and want changes:
1. Edit the task's `claudeNotes` field to include `[REVISION REQUESTED] your feedback here`
2. Set the task status back to `pending`
3. Next cron cycle, the worker picks it up, sees the revision marker, and gets your feedback prepended to its prompt with instructions to revise the existing output (not start from scratch)

---

## Setup Guide

### Prerequisites

- Node.js 20+
- Claude Code CLI installed (`claude` command available)
- `curl`, `jq`, `flock`, `timeout` (standard Linux/WSL tools)

### Step 1: Create the project

```bash
mkdir my-command-center && cd my-command-center
```

### Step 2: Set up the dashboard

```bash
npx create-next-app@latest dashboard --typescript --tailwind --app --eslint
cd dashboard
```

Create the directory structure:
```bash
mkdir -p data lib app/api/tasks/\[id\] app/api/cron-config app/api/worker-status app/api/files/\[...path\] app/tasks app/settings components
```

Initialize the data files:
```bash
echo '[]' > data/tasks.json
echo '{"enabled":false,"intervalMinutes":60,"lastRun":null,"lastTaskId":null}' > data/cron-config.json
```

### Step 3: Set up the worker

```bash
cd ..  # back to project root
mkdir -p workers/workspace/outputs workers/workspace/notes workers/logs
```

Create `workers/system-prompt.md` and `workers/run-worker.sh` per the specs above. Make the script executable:
```bash
chmod +x workers/run-worker.sh
```

### Step 4: Configure

Create `config/paths.json` for any external directory references:
```json
{
  "someExternalDir": "/path/to/wherever"
}
```

Update the `WORKER_DIR` variable in `run-worker.sh` to point to your project root. Update `DASHBOARD_URL` if you're using a different port.

### Step 5: Start the dashboard

```bash
cd dashboard
npm run dev
```

### Step 6: Enable the worker

Open the dashboard Settings page, enable the worker, pick an interval, and save. The dashboard will install the crontab entry automatically.

---

## Customization Points

These are the places you'll modify to make this your own:

| What | Where | Notes |
|------|-------|-------|
| Task types | `lib/types.ts` | Change the `type` union to your categories |
| Slash commands | `~/.claude/commands/worker/*.md` | Add workflows for your repeating task types |
| Worker timeout | `run-worker.sh` | `TIMEOUT_SECONDS` variable (default 1800 = 30 min) |
| Dashboard port | `next.config.ts` or dev command | Default is 3000 |
| System prompt | `workers/system-prompt.md` | Add your quality standards, workspace rules |
| Task form workflows | `components/TaskForm.tsx` | The `SLASH_COMMANDS` array maps dropdown labels to command names |
| Priority colors | `components/PriorityIndicator.tsx` | `PRIORITY_COLORS` object |
| Status colors | `components/StatusBadge.tsx` | `STATUS_COLORS` object |
| Cron intervals | `components/CronConfigPanel.tsx` | `INTERVAL_OPTIONS` array |

---

## What's NOT in This Blueprint

This is the stripped-down core. The reference system also has:

- **Client profiles** -- Living markdown files per client, auto-updated after sessions
- **Nuggets queue** -- Knowledge extraction from transcripts, batch review page
- **Zoom pipeline** -- Polls Zoom API for recordings, auto-creates post-call task chains
- **Video pipeline** -- Multi-stage content production pipeline (ideation through publish)
- **Schedule/daily brief** -- Calendar integration + AI-optimized daily schedule
- **Skool DM pipeline** -- Gmail polling for community DMs, AI-drafted responses
- **CoachingVault** -- Obsidian knowledge base integration
- **Pipeline auto-progression** -- Automatic next-stage task creation

Each of these builds on the same task system described here. Once you have the dashboard + worker running, adding any of these is just:
1. A new page in the dashboard (optional)
2. A new slash command defining the workflow
3. A script or poller that creates tasks via `POST /api/tasks`

---

## Quick Reference: API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks` | List all tasks (sorted by priority) |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks/{id}` | Get one task |
| PATCH | `/api/tasks/{id}` | Update a task (status, notes, etc.) |
| DELETE | `/api/tasks/{id}` | Delete a task |
| GET | `/api/cron-config` | Get worker schedule config |
| PUT | `/api/cron-config` | Update worker schedule (installs/removes crontab) |
| GET | `/api/worker-status` | Get last run info |
| GET | `/api/files/{path}` | Serve workspace files |

## Quick Reference: Worker CLI Command

```bash
timeout 1800 claude -p \
  --dangerously-skip-permissions \
  --output-format json \
  --model sonnet \
  --system-prompt workers/system-prompt.md \
  "Your task prompt here"
```

- `-p` = pipe mode (non-interactive)
- `--dangerously-skip-permissions` = no approval prompts (worker runs unattended)
- `--output-format json` = structured output with session_id
- `--model` = sonnet (default), opus (complex tasks), haiku (simple tasks)
