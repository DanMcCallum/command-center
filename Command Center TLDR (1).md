# Command Center -- How It Works

## The One-Sentence Version

A cron job picks up tasks from a queue, hands them to Claude, and drops the output into a review bin for you to approve.

## The Loop

```
You create a task
  -> It sits in the queue as "pending"
  -> Cron fires every N minutes
  -> Worker grabs the highest-priority pending task
  -> Claude does the work
  -> Output lands in "needs review"
  -> You look at it, approve or send it back
```

That's the whole system. A Next.js dashboard to see and manage the queue, a bash script that cron runs, and Claude doing the actual work.

## Why This Design Is Good

### Human in the loop -- or not

The key insight is the **review step is a gate, and gates are optional.**

By default, every task Claude finishes goes to "needs review." You look at the output, decide if it's good, and approve it. Nothing goes live without you.

But some tasks don't need review. A profile update that feeds into another system. A data extraction that has its own review surface elsewhere. For those, the worker can auto-complete the task and skip the review bin entirely. You decide which task types get the gate and which don't.

This means the same system can run:
- **Fully supervised** -- everything stops at "needs review," you approve each piece
- **Fully autonomous** -- everything auto-completes, Claude runs unsupervised
- **Mixed** -- some tasks need your eye, others don't

You pick the level of control per task type, not per system. One command center, flexible trust levels.

### Cron as the engine

There's no always-running daemon, no websocket, no queue service. Just cron. It fires, the worker runs, it's done. If nothing is pending, the worker exits in under a second.

This means:
- **No infrastructure.** No Redis, no RabbitMQ, no Celery. A flat JSON file and a crontab entry.
- **Failure is free.** If Claude errors out or times out, the task goes back to pending and gets retried on the next cron cycle. Cron is the retry mechanism.
- **Easy to reason about.** One worker runs at a time (file lock prevents overlap). You always know what's happening: check the task list.

### Priority queue, not FIFO

Tasks have priority 1-5. The worker always picks the highest-priority task first. If two tasks tie on priority, the older one wins.

This means you can dump a batch of low-priority tasks into the queue and they'll get done eventually, but if something urgent comes in, it jumps the line.

### Task chains

A task can point to a parent task. If the parent is still pending or in progress, the child waits. This lets you set up sequences:

```
Task A (priority 1) -- "Update the client profile"
  -> Task B (priority 2, parent: A) -- "Extract knowledge from the transcript"
    -> Task C (priority 2, parent: B) -- "Prep next session materials"
```

B won't run until A is done. C won't run until B is done. But other unrelated tasks at priority 1 will still jump ahead of B and C.

### Revision loop

When you review something and it's not quite right:
1. Add your feedback to the task notes
2. Set status back to "pending"
3. Next cron cycle, the worker picks it up again with your feedback injected into the prompt
4. Claude revises the existing output instead of starting from scratch

No back-and-forth chat. No "can you change X." Just structured feedback that feeds into the next autonomous run.

### Workflow templates

Tasks can carry a "slash command" -- a reference to a markdown file that describes a step-by-step process. The worker loads it and injects it into Claude's prompt.

This separates the WHAT from the HOW:
- The task says: "Update profile for Alex Chen, transcript at /path/to/file.vtt"
- The workflow says: "Read the transcript, extract key points, update the markdown profile, increment session count..."

You build the workflow once. Every task of that type follows it. Quality becomes consistent and repeatable.

## What It Looks Like

**Dashboard** -- A dark-themed web app running on localhost. One page for tasks (filterable by status), one page for settings (worker on/off, interval picker). Tasks show priority, status, title, Claude's notes, and a link to the output file.

**Worker** -- A bash script. Runs silently via cron. Logs each run to a timestamped file. You never interact with it directly.

**Database** -- A JSON file. No SQL, no migrations, no ORM. Tasks are objects in an array. The dashboard reads and writes this file through a data access layer.

## The Stack

- Next.js (React + TypeScript + Tailwind)
- Flat JSON storage (no database server)
- Bash + cron (no queue infrastructure)
- Claude Code CLI (`claude -p`)

No Docker. No Kubernetes. No cloud services. Runs on a laptop.
