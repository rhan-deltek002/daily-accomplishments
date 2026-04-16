---
name: da
description: >
  Daily accomplishments commands. Use when user invokes /da, /da log,
  /da summary, /da search, or /da review. Provides unambiguous access
  to daily-accomplishments MCP tools without clashing with other servers.
user-invocable: true
---

# /da — Daily Accomplishments

Arguments passed: $ARGUMENTS

---

## Command Routing

Parse `$ARGUMENTS` to determine which command to run:

| Invocation | Action |
|---|---|
| (empty) | Show today's entries + available commands |
| `log` | Log current session work |
| `summary [month]` | Summary for current or specified month |
| `review [month]` | Performance-review narrative for current or specified month |
| `search <query>` | Search accomplishments |

---

## /da (bare — no arguments)

1. Get today's boundaries:
   - `date_from`: `date -d 'today 00:00:00' +%s` (Linux) or `date -v0H -v0M -v0S +%s` (macOS)
   - `date_to`: `date +%s`
2. Call `get_accomplishments` with `date_from` and `date_to`
3. Display entries as a formatted list (title, description, impact, project)
4. If no entries: say "No accomplishments logged today yet."
5. Always append available commands hint:

```
Available: /da log · /da summary · /da review · /da search <query>
```

---

## /da log

Goal: record today's session work without duplicates, consolidated into meaningful outcomes.

1. Get today's boundaries:
   - `date_from`: `date -d 'today 00:00:00' +%s` (Linux) or `date -v0H -v0M -v0S +%s` (macOS)
   - `date_to`: `date +%s`
2. Call `get_accomplishments` with `date_from` and `date_to` — note any existing entries
3. Read git context:
   - `git log --oneline -20` (recent commits)
   - `git diff --stat HEAD~5..HEAD 2>/dev/null || git diff --stat` (changed files)
4. Synthesize session work + git context into candidate accomplishment entries
5. Consolidate: one entry per distinct meaningful outcome (not per file, not per bug)
6. If related entries already exist today: prefer `update_accomplishment` over creating duplicates
7. Present proposed entry/entries to user for confirmation before calling any MCP write tool
8. On confirmation: call `log_accomplishment` or `update_accomplishment`

**Field defaults:**
- `project`: derived from `git remote get-url origin` (repo name) or folder name
- `context`: `"side_project"` for this repo; `"work"` otherwise — infer from existing records, never ask
- `impact`: infer from scope of work (high = shipped feature; medium = fix/refactor; low = docs/chore)
- `date`: omit (defaults to current time)

**If git context is sparse:** ask user "What did you work on this session?"

---

## /da summary [month]

1. Get target month boundaries:
   - Default (no argument): `date_from` = first second of current month, `date_to` = `date +%s`
   - If month argument given (e.g. `march`, `2026-03`): convert to Unix timestamp range for that month
2. If range spans more than one month: call `get_monthly_summaries` first and build the narrative from those pre-computed summaries. Only call `get_summary` with `include_records=True` if no summary exists for the target month.
3. For single-month requests: call `get_summary` with `date_from`, `date_to`, `include_records=True`
4. Present as structured narrative grouped by project
5. Lead with what was delivered and why it matters

---

## /da review [month]

Follow the same month boundary and `get_monthly_summaries` / `get_summary` logic as `/da summary`. Then present framed for performance review:
- Group by project
- Emphasize outcomes and impact, not activities
- Use past-tense, first-person ("Delivered...", "Reduced...", "Built...")
- Suitable for copy-paste into a perf review doc

---

## /da search <query>

1. Extract query from `$ARGUMENTS` (everything after `search `)
2. Call `search_accomplishments` with the query string
3. Display results: title, date, project, description

If no query provided: ask "What are you searching for?"
