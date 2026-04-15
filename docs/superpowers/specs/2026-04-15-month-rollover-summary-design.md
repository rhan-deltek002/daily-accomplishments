# Month Rollover Summary — Design Spec

**Date:** 2026-04-15  
**Status:** Approved  

---

## Goal

When a new accomplishment is logged in a different month than the previous log, automatically generate a performance-review-focused summary of the completed month and persist it. Monthly summaries serve as a pre-digested tier for annual and multi-month reviews, reducing token usage and surfacing the insights that matter most for performance conversations.

---

## Trigger

Inside `log_accomplishment`, after inserting the new record:

1. Query the most recent record **before** the one just inserted.
2. If that record's month (`YYYY-MM`) differs from the new record's month **and** no summary already exists for the previous month → signal Claude with pre-fetched data.
3. If the months are the same, or a summary already exists → do nothing. Log proceeds normally.
4. If there is a gap of multiple months (e.g. last log was January, new log is April), summarize only the month of the last log (January). February and March have no records and are skipped.

---

## Data Model

### New table: `monthly_summaries`

```sql
CREATE TABLE IF NOT EXISTS monthly_summaries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    month        TEXT    NOT NULL UNIQUE,  -- YYYY-MM
    narrative    TEXT    NOT NULL,
    stats        TEXT    NOT NULL DEFAULT '{}',  -- JSON blob (see below)
    generated_at INTEGER NOT NULL
)
```

`UNIQUE` on `month` enforces one summary per month. `INSERT OR REPLACE` is used on store so a duplicate trigger is safe.

Added via the existing `CREATE TABLE IF NOT EXISTS` pattern in `db.py:init_db()` — no separate migration script needed.

### Stats JSON blob

Two forms: **pre-computed** (what the server puts in `needs_summary.stats`) and **stored** (what ends up in the DB after Claude adds key_wins).

**Pre-computed by server** (no key_wins yet):
```json
{
  "total": 15,
  "by_category":        { "feature": 5, "bugfix": 3, "learning": 4, "other": 3 },
  "by_impact":          { "high": 2, "medium": 8, "low": 5 },
  "by_project":         { "project-a": 8, "project-b": 7 },
  "top_tags":           ["python", "api", "auth"],
  "high_impact_titles": ["Shipped auth service", "Migrated DB to Postgres"]
}
```

**Stored in DB** (after Claude merges in key_wins via `store_monthly_summary`):
```json
{
  "total": 15,
  "by_category":        { "feature": 5, "bugfix": 3, "learning": 4, "other": 3 },
  "by_impact":          { "high": 2, "medium": 8, "low": 5 },
  "by_project":         { "project-a": 8, "project-b": 7 },
  "top_tags":           ["python", "api", "auth"],
  "high_impact_titles": ["Shipped auth service", "Migrated DB to Postgres"],
  "key_wins": [
    { "title": "Shipped auth service",   "why": "Unblocked 3 downstream teams, delivered ahead of schedule" },
    { "title": "Migrated DB to Postgres","why": "Eliminated the main source of prod incidents for the quarter" }
  ]
}
```

`key_wins` is selected by Claude using judgment — 2-3 genuinely noteworthy accomplishments, not mechanically the highest `impact_level` records. The server passes `key_wins` as a separate parameter to `store_monthly_summary`, which merges it into the stats blob before writing to the DB.

---

## Server Changes

### `db.py`

**New functions:**

```python
def store_monthly_summary(db_path, month, narrative, stats) -> dict
    # INSERT OR REPLACE into monthly_summaries

def get_monthly_summaries(db_path, date_from=None, date_to=None) -> list
    # Return summaries in range. date_from/date_to are YYYY-MM strings.
    # If both omitted, returns all summaries.

def get_monthly_summary(db_path, month) -> dict | None
    # Single month lookup — used by gap detection to skip if already exists

def _compute_month_stats(records) -> dict
    # Pure function: takes a list of accomplishment dicts, returns the stats blob
    # (all fields except key_wins and narrative — those are Claude's job)
```

**`log_accomplishment` addition** (after insert, same connection):

```python
prev = conn.execute(
    "SELECT date FROM accomplishments WHERE id != ? ORDER BY date DESC LIMIT 1",
    (new_id,)
).fetchone()

if prev and _ts_to_month(prev["date"]) != _ts_to_month(date_ts):
    prev_month = _ts_to_month(prev["date"])
    if not get_monthly_summary(db_path, prev_month):
        records = get_accomplishments(db_path,
            date_from=f"{prev_month}-01",
            date_to=_last_day_of_month(prev_month))
        stats = _compute_month_stats(records)
        result["needs_summary"] = {
            "month":   prev_month,
            "records": records,
            "stats":   stats
        }
```

**`get_summary` two-pass update:**

When the requested range spans multiple months, fetch `get_monthly_summaries` for that range first. Return summaries as the primary payload. Only include individual records for months that have no summary, or when `include_records=True` is explicitly set.

### `server.py` — new MCP tools

```python
@mcp.tool()
def store_monthly_summary(month: str, narrative: str, key_wins: list, stats: dict) -> dict:
    """Store a generated monthly summary. month is YYYY-MM."""

@mcp.tool()
def get_monthly_summaries(date_from: str = None, date_to: str = None) -> list:
    """Retrieve monthly summaries. date_from/date_to are YYYY-MM strings.
    Returns all summaries if neither is provided."""
```

### `server.py` — new REST endpoint

```
GET /api/monthly-summaries?date_from=YYYY-MM&date_to=YYYY-MM
```

Used by the frontend Annual Review to load summaries alongside accomplishment records.

---

## MCP Instructions Update

Two new rules appended to the `instructions=` string in `FastMCP(...)`:

### Rule 1 — Act on the summary signal

After calling `log_accomplishment`, check the response for a `needs_summary` field. If present:

1. Write a performance-review-focused narrative for that month using the `records` and `stats` provided — no additional tool calls needed.
2. The narrative leads with outcomes and impact ("Delivered X which enabled Y"), not activity. 2-4 sentences. Write it as something the user could quote directly in a self-evaluation.
3. Select 2-3 `key_wins` from the records using judgment — genuinely noteworthy work that demonstrates capability, ownership, or cross-team impact. Do not mechanically pick the highest `impact_level` entries; use the descriptions to assess real significance.
4. Call `store_monthly_summary` with the narrative, key_wins, and the pre-computed stats from `needs_summary.stats`.
5. Inform the user briefly: "{Month} summary saved." Then proceed with the original logging response.

### Rule 2 — Two-pass multi-month review

When the user asks for a performance review or summary covering multiple months (full year, past N months, a specific month range, etc.):

1. Call `get_monthly_summaries` with the appropriate `date_from`/`date_to` range first.
2. Build the narrative from the summaries that exist in that range. Do not fetch individual records unless the user asks to drill into a specific month or a month has no summary.
3. If no summaries exist at all for the range, fall back to `get_accomplishments` with the appropriate date range.

---

## Frontend Changes

### Annual Review — month container

When `monthly_summaries` are loaded for the current year, each month section that has a summary renders a **pinned summary banner** at the top of its card list, before individual accomplishment cards:

```
┌─ April 2025 ──────────────────── 15 accomplishments ─┐
│  ┌─ Monthly Summary ─────────────────────────────┐   │
│  │  Delivered the auth service ahead of schedule,│   │
│  │  unblocking 3 downstream teams. Completed the │   │
│  │  Postgres migration, resolving the quarter's  │   │
│  │  main source of production incidents.         │   │
│  │                                               │   │
│  │  ✦ Shipped auth service                       │   │
│  │    Unblocked 3 downstream teams               │   │
│  │  ✦ Migrated DB to Postgres                    │   │
│  │    Eliminated main source of prod incidents   │   │
│  └───────────────────────────────────────────────┘   │
│  [individual accomplishment cards below...]           │
└──────────────────────────────────────────────────────┘
```

The banner is visually distinct from cards (different background, no edit/delete actions). Key wins are rendered as bullet points with their `why` field as a subtitle.

### Data loading

`renderAnnual()` makes one additional call to `/api/monthly-summaries` (filtered to the current year or active filter range). Results stored in a `monthlySummaries` map keyed by `YYYY-MM`. When rendering each month section, the map is checked and the banner injected if a summary exists.

---

## Out of Scope

- Editing or regenerating a summary from the UI (can be done via MCP if needed)
- Summaries for months with zero accomplishments
- Push notifications or reminders to log

---

## Open Questions

None — all resolved during design.
