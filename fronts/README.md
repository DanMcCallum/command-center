# Fronts

A front is one of the handful of things the operator works on every day. Each front is a directory here with two files (spec: `specs/fronts.md`, registry: `config/fronts.json`).

| File | Who writes it | What it is |
|---|---|---|
| `north-star.md` | The operator, by hand. **Agents never edit it.** | What this front is, what good looks like, reference examples, boundaries. Lean enough to inject into any Claude session with `@fronts/<slug>/north-star.md`. |
| `now.md` | The what's-next agent after each routed session; the operator may correct it by hand. | Where we are, what the last session did, what is next, candidate agent work, the operator's answers to open questions. |

`memory/` holds one summary per Claude Code session, written by the session-end pipeline (`workers/fronts/`). Files are named `<YYYY-MM-DD>-<HHMM>-<session prefix>.md` with frontmatter naming the front they were routed to. A file ending in `-private.md` is gitignored; rename a summary that way when it must not leave this machine.

Start a session on a front:

```
@fronts/<slug>/north-star.md @fronts/<slug>/now.md what's next?
```

`_template/` holds the blank files a new front starts from. To add a front: add an entry to `config/fronts.json`, copy `_template/` to `fronts/<slug>/`, and write the north star.
