# Month Rollover Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate and store a performance-review-focused monthly summary when a new log is created in a different month than the previous one, and display it as a pinned banner in the Annual Review.

**Architecture:** Gap detection lives in `db.log_accomplishment` — after insert, it queries the previous record, compares months, and returns a `needs_summary` payload (pre-computed stats + records). Claude writes the narrative + key_wins and calls the new `store_monthly_summary` MCP tool. The frontend Annual Review fetches all summaries via a new REST endpoint and injects a banner at the top of each month container.

**Tech Stack:** Python/SQLite (db.py), FastAPI + FastMCP (server.py), Vanilla JS (web/app.js), CSS (web/style.css), pytest

---

## File Map

| File | Change |
|------|--------|
| `db.py` | Add `monthly_summaries` table, 5 new functions, modify `log_accomplishment` |
| `server.py` | Add 2 MCP tools, 1 REST endpoint, update instructions string |
| `web/app.js` | Update `renderAnnual()`, add `renderSummaryBanner()` |
| `web/style.css` | Add `.month-summary-banner` styles |
| `tests/test_db.py` | Add `TestMonthlySummaries` and `TestGapDetection` test classes |

---

## Task 1: DB — table + helper functions

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

- [ ] **Step 1: Write failing tests**

Add this class to `tests/test_db.py`:

```python
# ---------------------------------------------------------------------------
# monthly_summaries table
# ---------------------------------------------------------------------------

def _summary_columns(db_path):
    conn = sqlite3.connect(db_path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(monthly_summaries)")}
    conn.close()
    return cols


class TestMonthlySummariesTable:
    def test_fresh_db_has_monthly_summaries_table(self, tmp_db):
        assert "month" in _summary_columns(tmp_db)
        assert "narrative" in _summary_columns(tmp_db)
        assert "stats" in _summary_columns(tmp_db)
        assert "generated_at" in _summary_columns(tmp_db)

    def test_init_is_idempotent_with_summary_table(self, tmp_db):
        db.init_db(tmp_db)  # second call must not raise
        assert "month" in _summary_columns(tmp_db)

    def test_compute_month_stats_counts(self, tmp_db):
        records = [
            {"category": "feature", "impact_level": "high",  "project": "app", "tags": ["python"], "title": "A"},
            {"category": "feature", "impact_level": "medium", "project": "app", "tags": ["python", "api"], "title": "B"},
            {"category": "bugfix",  "impact_level": "low",    "project": None,  "tags": [], "title": "C"},
        ]
        stats = db._compute_month_stats(records)
        assert stats["total"] == 3
        assert stats["by_category"]["feature"] == 2
        assert stats["by_category"]["bugfix"] == 1
        assert stats["by_impact"]["high"] == 1
        assert stats["by_impact"]["medium"] == 1
        assert stats["by_impact"]["low"] == 1
        assert stats["by_project"]["app"] == 2
        assert "None" not in stats["by_project"]
        assert "python" in stats["top_tags"]
        assert stats["high_impact_titles"] == ["A"]

    def test_compute_month_stats_empty(self):
        stats = db._compute_month_stats([])
        assert stats["total"] == 0
        assert stats["top_tags"] == []
        assert stats["high_impact_titles"] == []

    def test_last_day_of_month_regular(self):
        assert db._last_day_of_month("2025-03") == "2025-03-31"
        assert db._last_day_of_month("2025-04") == "2025-04-30"

    def test_last_day_of_month_december(self):
        assert db._last_day_of_month("2025-12") == "2025-12-31"

    def test_last_day_of_month_february_leap(self):
        assert db._last_day_of_month("2024-02") == "2024-02-29"

    def test_last_day_of_month_february_non_leap(self):
        assert db._last_day_of_month("2025-02") == "2025-02-28"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/rhan/Claude/daily-accomplishments
pytest tests/test_db.py::TestMonthlySummariesTable -v
```

Expected: multiple FAILs — table doesn't exist, functions not defined.

- [ ] **Step 3: Add the table, helpers, and row converter to `db.py`**

After the existing `_parse_date_range_end` function (around line 85), add:

```python
def _last_day_of_month(month_str: str) -> str:
    """Return YYYY-MM-DD for the last day of a YYYY-MM month string."""
    year, mo = int(month_str[:4]), int(month_str[5:7])
    if mo == 12:
        last = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(year, mo + 1, 1) - timedelta(days=1)
    return last.strftime("%Y-%m-%d")


def _compute_month_stats(records: list) -> dict:
    """Compute stats for a list of accomplishment dicts.

    Returns all stats fields except key_wins — those are written by Claude.
    """
    by_category: dict = {}
    by_impact: dict = {"low": 0, "medium": 0, "high": 0}
    by_project: dict = {}
    tag_counts: dict = {}

    for item in records:
        cat = item.get("category", "other")
        by_category[cat] = by_category.get(cat, 0) + 1
        lvl = item.get("impact_level", "medium")
        by_impact[lvl] = by_impact.get(lvl, 0) + 1
        proj = item.get("project")
        if proj:
            by_project[proj] = by_project.get(proj, 0) + 1
        for tag in (item.get("tags") or []):
            t = tag.strip().lower()
            if t:
                tag_counts[t] = tag_counts.get(t, 0) + 1

    top_tags = [t for t, _ in sorted(tag_counts.items(), key=lambda x: -x[1])[:10]]
    high_impact_titles = [item["title"] for item in records if item.get("impact_level") == "high"]

    return {
        "total": len(records),
        "by_category": by_category,
        "by_impact": by_impact,
        "by_project": by_project,
        "top_tags": top_tags,
        "high_impact_titles": high_impact_titles,
    }


def _summary_row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    try:
        d["stats"] = json.loads(d["stats"]) if d.get("stats") else {}
    except (json.JSONDecodeError, TypeError):
        d["stats"] = {}
    return d
```

In `init_db()`, after the last `try/except` migration block (before `conn.commit()`), add:

```python
        conn.execute("""
            CREATE TABLE IF NOT EXISTS monthly_summaries (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                month        TEXT    NOT NULL UNIQUE,
                narrative    TEXT    NOT NULL,
                stats        TEXT    NOT NULL DEFAULT '{}',
                generated_at INTEGER NOT NULL
            )
        """)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_db.py::TestMonthlySummariesTable -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat(db): add monthly_summaries table and stat helpers"
```

---

## Task 2: DB — store and retrieve a summary

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_db.py` (after `TestMonthlySummariesTable`):

```python
class TestStoreMonthlySummary:
    def _sample_stats(self):
        return {
            "total": 5,
            "by_category": {"feature": 3, "bugfix": 2},
            "by_impact": {"high": 1, "medium": 3, "low": 1},
            "by_project": {"my-app": 5},
            "top_tags": ["python"],
            "high_impact_titles": ["Shipped login"],
        }

    def _sample_key_wins(self):
        return [{"title": "Shipped login", "why": "Unblocked team"}]

    def test_store_returns_dict_with_month(self, tmp_db):
        result = db.store_monthly_summary(
            tmp_db, "2025-03", "Great month.", self._sample_key_wins(), self._sample_stats()
        )
        assert result["month"] == "2025-03"
        assert result["narrative"] == "Great month."

    def test_store_merges_key_wins_into_stats(self, tmp_db):
        db.store_monthly_summary(
            tmp_db, "2025-03", "Great month.", self._sample_key_wins(), self._sample_stats()
        )
        summary = db.get_monthly_summary(tmp_db, "2025-03")
        assert summary["stats"]["key_wins"] == self._sample_key_wins()
        assert summary["stats"]["total"] == 5

    def test_get_returns_none_when_missing(self, tmp_db):
        assert db.get_monthly_summary(tmp_db, "2025-03") is None

    def test_store_upserts_on_duplicate_month(self, tmp_db):
        db.store_monthly_summary(
            tmp_db, "2025-03", "First.", self._sample_key_wins(), self._sample_stats()
        )
        db.store_monthly_summary(
            tmp_db, "2025-03", "Updated.", self._sample_key_wins(), self._sample_stats()
        )
        summary = db.get_monthly_summary(tmp_db, "2025-03")
        assert summary["narrative"] == "Updated."
        # Still only one row
        conn = sqlite3.connect(tmp_db)
        count = conn.execute("SELECT COUNT(*) FROM monthly_summaries WHERE month='2025-03'").fetchone()[0]
        conn.close()
        assert count == 1

    def test_stats_json_round_trips(self, tmp_db):
        db.store_monthly_summary(
            tmp_db, "2025-03", "N.", self._sample_key_wins(), self._sample_stats()
        )
        summary = db.get_monthly_summary(tmp_db, "2025-03")
        assert isinstance(summary["stats"], dict)
        assert summary["stats"]["by_category"]["feature"] == 3
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_db.py::TestStoreMonthlySummary -v
```

Expected: FAILs — `store_monthly_summary` and `get_monthly_summary` not defined.

- [ ] **Step 3: Add `store_monthly_summary` and `get_monthly_summary` to `db.py`**

Add after `delete_accomplishment`:

```python
def store_monthly_summary(
    db_path: str,
    month: str,
    narrative: str,
    key_wins: list,
    stats: dict,
) -> dict:
    """Store or overwrite a monthly summary for YYYY-MM month.

    key_wins is merged into the stats blob before persisting.
    Uses INSERT OR REPLACE so calling twice for the same month is safe.
    """
    stats_to_store = dict(stats)
    stats_to_store["key_wins"] = key_wins
    generated_ts = int(time.time())

    with get_conn(db_path) as conn:
        conn.execute(
            """INSERT OR REPLACE INTO monthly_summaries (month, narrative, stats, generated_at)
               VALUES (?, ?, ?, ?)""",
            (month, narrative, json.dumps(stats_to_store), generated_ts),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM monthly_summaries WHERE month = ?", (month,)
        ).fetchone()
        return _summary_row_to_dict(row)


def get_monthly_summary(db_path: str, month: str) -> Optional[dict]:
    """Return the summary for a single YYYY-MM month, or None if not yet generated."""
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM monthly_summaries WHERE month = ?", (month,)
        ).fetchone()
        return _summary_row_to_dict(row) if row else None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_db.py::TestStoreMonthlySummary -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat(db): add store_monthly_summary and get_monthly_summary"
```

---

## Task 3: DB — get_monthly_summaries (range query)

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_db.py`:

```python
class TestGetMonthlySummaries:
    def _store(self, db_path, month):
        db.store_monthly_summary(
            db_path, month, f"Summary for {month}.",
            [], {"total": 1, "by_category": {}, "by_impact": {"low": 0, "medium": 1, "high": 0},
                 "by_project": {}, "top_tags": [], "high_impact_titles": []}
        )

    def test_returns_all_when_no_filter(self, tmp_db):
        self._store(tmp_db, "2025-01")
        self._store(tmp_db, "2025-02")
        results = db.get_monthly_summaries(tmp_db)
        assert len(results) == 2

    def test_ordered_newest_first(self, tmp_db):
        self._store(tmp_db, "2025-01")
        self._store(tmp_db, "2025-03")
        results = db.get_monthly_summaries(tmp_db)
        assert results[0]["month"] == "2025-03"
        assert results[1]["month"] == "2025-01"

    def test_filter_date_from(self, tmp_db):
        self._store(tmp_db, "2025-01")
        self._store(tmp_db, "2025-06")
        self._store(tmp_db, "2025-12")
        results = db.get_monthly_summaries(tmp_db, date_from="2025-06")
        months = [r["month"] for r in results]
        assert "2025-01" not in months
        assert "2025-06" in months
        assert "2025-12" in months

    def test_filter_date_to(self, tmp_db):
        self._store(tmp_db, "2025-01")
        self._store(tmp_db, "2025-06")
        self._store(tmp_db, "2025-12")
        results = db.get_monthly_summaries(tmp_db, date_to="2025-06")
        months = [r["month"] for r in results]
        assert "2025-01" in months
        assert "2025-06" in months
        assert "2025-12" not in months

    def test_filter_both(self, tmp_db):
        for m in ["2025-01", "2025-06", "2025-09", "2025-12"]:
            self._store(tmp_db, m)
        results = db.get_monthly_summaries(tmp_db, date_from="2025-06", date_to="2025-09")
        months = [r["month"] for r in results]
        assert months == ["2025-09", "2025-06"]

    def test_empty_when_none(self, tmp_db):
        assert db.get_monthly_summaries(tmp_db) == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_db.py::TestGetMonthlySummaries -v
```

Expected: FAILs — `get_monthly_summaries` not defined.

- [ ] **Step 3: Add `get_monthly_summaries` to `db.py`**

Add immediately after `get_monthly_summary`:

```python
def get_monthly_summaries(
    db_path: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> list:
    """Return monthly summaries ordered newest-first.

    Args:
        date_from: Earliest month to include, as YYYY-MM string. Optional.
        date_to:   Latest month to include, as YYYY-MM string. Optional.
    """
    query = "SELECT * FROM monthly_summaries WHERE 1=1"
    params = []
    if date_from:
        query += " AND month >= ?"
        params.append(date_from[:7])
    if date_to:
        query += " AND month <= ?"
        params.append(date_to[:7])
    query += " ORDER BY month DESC"

    with get_conn(db_path) as conn:
        rows = conn.execute(query, params).fetchall()
        return [_summary_row_to_dict(row) for row in rows]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_db.py::TestGetMonthlySummaries -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat(db): add get_monthly_summaries with date range filter"
```

---

## Task 4: DB — gap detection in log_accomplishment

**Files:**
- Modify: `db.py`
- Test: `tests/test_db.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_db.py`:

```python
# ---------------------------------------------------------------------------
# Gap detection
# ---------------------------------------------------------------------------

# Fixed timestamps for testing
_MARCH_TS  = 1743379200   # 2025-03-31 00:00 UTC
_APRIL_TS  = 1743465600   # 2025-04-01 00:00 UTC
_APRIL2_TS = 1743552000   # 2025-04-02 00:00 UTC
_JAN_TS    = 1735689600   # 2025-01-01 00:00 UTC


class TestGapDetection:
    def test_no_signal_when_same_month(self, tmp_db):
        _log(tmp_db, title="First",  date_str=_APRIL_TS)
        result = _log(tmp_db, title="Second", date_str=_APRIL2_TS)
        assert result.get("needs_summary") is None

    def test_signal_when_month_changes(self, tmp_db):
        _log(tmp_db, title="March entry", date_str=_MARCH_TS)
        result = _log(tmp_db, title="April entry", date_str=_APRIL_TS)
        assert result["needs_summary"] is not None
        assert result["needs_summary"]["month"] == "2025-03"

    def test_signal_includes_records(self, tmp_db):
        _log(tmp_db, title="March entry", date_str=_MARCH_TS)
        result = _log(tmp_db, title="April entry", date_str=_APRIL_TS)
        records = result["needs_summary"]["records"]
        assert len(records) == 1
        assert records[0]["title"] == "March entry"

    def test_signal_includes_precomputed_stats(self, tmp_db):
        _log(tmp_db, title="March entry", date_str=_MARCH_TS, impact_level="high")
        result = _log(tmp_db, title="April entry", date_str=_APRIL_TS)
        stats = result["needs_summary"]["stats"]
        assert stats["total"] == 1
        assert stats["high_impact_titles"] == ["March entry"]

    def test_no_signal_on_first_ever_log(self, tmp_db):
        result = _log(tmp_db, title="First ever", date_str=_APRIL_TS)
        assert result.get("needs_summary") is None

    def test_no_signal_when_summary_already_exists(self, tmp_db):
        _log(tmp_db, title="March entry", date_str=_MARCH_TS)
        # Pre-store a summary for March
        db.store_monthly_summary(
            tmp_db, "2025-03", "Already done.", [],
            {"total": 1, "by_category": {}, "by_impact": {"low": 0, "medium": 1, "high": 0},
             "by_project": {}, "top_tags": [], "high_impact_titles": []}
        )
        result = _log(tmp_db, title="April entry", date_str=_APRIL_TS)
        assert result.get("needs_summary") is None

    def test_multi_month_gap_only_summarises_prev_log_month(self, tmp_db):
        # Last log was January, new log is April — only January gets summarised
        _log(tmp_db, title="Jan entry", date_str=_JAN_TS)
        result = _log(tmp_db, title="April entry", date_str=_APRIL_TS)
        assert result["needs_summary"]["month"] == "2025-01"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_db.py::TestGapDetection -v
```

Expected: FAILs — `needs_summary` key not present in result.

- [ ] **Step 3: Modify `log_accomplishment` in `db.py`**

Replace the `return _row_to_dict(row)` at the end of `log_accomplishment` with:

```python
        result = _row_to_dict(row)

    # Gap detection: check if we've crossed a month boundary since the last log.
    # Run outside the insert transaction so get_monthly_summary can open its own conn.
    result["needs_summary"] = None
    with get_conn(db_path) as conn:
        prev = conn.execute(
            "SELECT date FROM accomplishments WHERE id != ? ORDER BY id DESC LIMIT 1",
            (result["id"],),
        ).fetchone()

    if prev:
        prev_month = _ts_to_month(prev["date"])
        new_month = _ts_to_month(date_ts)
        if prev_month != new_month and not get_monthly_summary(db_path, prev_month):
            month_records = get_accomplishments(
                db_path,
                date_from=f"{prev_month}-01",
                date_to=_last_day_of_month(prev_month),
            )
            result["needs_summary"] = {
                "month": prev_month,
                "records": month_records,
                "stats": _compute_month_stats(month_records),
            }

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_db.py::TestGapDetection -v
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
pytest tests/ -v
```

Expected: all PASS. The `needs_summary: None` in normal log responses is a new key but doesn't break existing callers.

- [ ] **Step 6: Commit**

```bash
git add db.py tests/test_db.py
git commit -m "feat(db): detect month gap in log_accomplishment, return needs_summary payload"
```

---

## Task 5: Server — MCP tools, REST endpoint, updated instructions

**Files:**
- Modify: `server.py`

- [ ] **Step 1: Add `store_monthly_summary` MCP tool to `server.py`**

Add after the `execute_merge` tool (around line 435):

```python
@mcp.tool()
def store_monthly_summary(
    month: str,
    narrative: str,
    key_wins: list[dict],
    stats: dict,
) -> dict:
    """
    Store a Claude-authored monthly summary after a month rollover is detected.

    Call this when log_accomplishment returns a needs_summary field. Do not
    call unless that signal is present — summaries are only generated once
    per month automatically.

    Args:
        month:     The summarised month in YYYY-MM format (e.g. "2025-03").
        narrative: 2-4 sentence performance-review-focused narrative.
                   Lead with outcomes and impact ("Delivered X which enabled Y"),
                   not activity. Write it as text the user could quote verbatim
                   in a self-evaluation.
        key_wins:  List of 2-3 dicts, each with "title" (str) and "why" (str).
                   Select for genuine significance — cross-team impact, unblocking
                   others, complex problems solved. Do not mechanically pick
                   entries that happen to have impact_level=high; use judgment.
        stats:     Pass through needs_summary.stats unchanged. Do not modify.
    """
    return database.store_monthly_summary(DB_PATH, month, narrative, key_wins, stats)
```

- [ ] **Step 2: Add `get_monthly_summaries` MCP tool to `server.py`**

Add immediately after `store_monthly_summary`:

```python
@mcp.tool()
def get_monthly_summaries(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> list:
    """
    Retrieve monthly summaries for a date range.

    Use as the FIRST call in any multi-month performance review — summaries
    are pre-computed and contain the narrative, key wins, and stats needed
    to write a complete review without fetching individual records.

    Only call get_accomplishments for a month if the user asks to drill into
    it specifically, or if no summary exists for that month.

    Args:
        date_from: Earliest month to include as YYYY-MM (e.g. "2025-01"). Optional.
        date_to:   Latest month to include as YYYY-MM (e.g. "2025-06"). Optional.
                   If both are omitted, returns all summaries.
    """
    return database.get_monthly_summaries(DB_PATH, date_from, date_to)
```

- [ ] **Step 3: Add REST endpoint to `server.py`**

Add after the `api_stats` endpoint (after line 484):

```python
@web_app.get("/api/monthly-summaries")
async def api_monthly_summaries(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    return JSONResponse(
        content=database.get_monthly_summaries(DB_PATH, date_from, date_to)
    )
```

- [ ] **Step 4: Update MCP instructions string in `server.py`**

In the `FastMCP(...)` call, append two new paragraphs to the end of the `instructions=` string, before the closing `)`). Replace the last paragraph (currently ending with `"Never skip the review step."`) so it reads:

```python
        "Never skip the review step. "

        "MONTHLY ROLLOVER SUMMARY: After calling log_accomplishment, check "
        "the response for a needs_summary field. If it is not None: "
        "(1) Write a 2-4 sentence performance-review-focused narrative from "
        "the provided records and stats — lead with outcomes and impact, not "
        "activity, write it as text the user could quote in a self-evaluation. "
        "(2) Select 2-3 key_wins dicts (each with title and why) using judgment "
        "— genuine significance, not just high impact_level entries. "
        "(3) Call store_monthly_summary with the narrative, key_wins, and the "
        "pre-computed stats from needs_summary.stats (pass stats through unchanged). "
        "(4) Inform the user briefly: '<Month YYYY> summary saved.' "
        "Then continue with the original logging response. "

        "MULTI-MONTH PERFORMANCE REVIEW: When the user asks for a review or "
        "summary covering multiple months (any range — full year, past N months, "
        "month-to-month), call get_monthly_summaries first with the appropriate "
        "date_from/date_to range. Build the narrative from those summaries alone. "
        "Only call get_accomplishments for a specific month if the user asks to "
        "drill into it or if no summary exists for that month. "
        "If no summaries exist for the range at all, fall back to get_accomplishments."
    ),
```

- [ ] **Step 5: Smoke-test the server starts cleanly**

```bash
cd /home/rhan/Claude/daily-accomplishments
python3 -c "import server; print('OK')"
```

Expected: `OK` with no import errors.

- [ ] **Step 6: Commit**

```bash
git add server.py
git commit -m "feat(server): add store/get monthly summary MCP tools, REST endpoint, update instructions"
```

---

## Task 6: Frontend — fetch summaries and render banner

**Files:**
- Modify: `web/app.js`
- Modify: `web/style.css`

- [ ] **Step 1: Add module-level variable and fetch in `app.js`**

Near the top of `app.js`, after the existing `let monthShown = {};` line, add:

```javascript
let monthlySummaries = {};  // keyed by YYYY-MM
```

- [ ] **Step 2: Add `loadMonthlySummaries` function to `app.js`**

After the `loadStats` function, add:

```javascript
async function loadMonthlySummaries() {
  try {
    const r = await fetch('/api/monthly-summaries');
    const list = await r.json();
    monthlySummaries = {};
    for (const s of list) {
      monthlySummaries[s.month] = s;
    }
  } catch (_) {
    monthlySummaries = {};
  }
}
```

- [ ] **Step 3: Call `loadMonthlySummaries` when Annual Review is rendered**

In `renderAnnual()`, at the very top of the function body (before the `if (!allData.length)` check), add:

```javascript
  await loadMonthlySummaries();
```

Make `renderAnnual` async if it isn't already — check the current signature and change `function renderAnnual()` to `async function renderAnnual()` if needed.

- [ ] **Step 4: Add `renderSummaryBanner` function to `app.js`**

After `renderMonthPage`, add:

```javascript
function renderSummaryBanner(summary) {
  if (!summary) return '';
  const stats = summary.stats || {};
  const keyWins = stats.key_wins || [];
  const winsHtml = keyWins.map(function(w) {
    return '<li class="msb-win"><span class="msb-win-title">' + esc(w.title) + '</span>'
      + '<span class="msb-win-why">' + esc(w.why) + '</span></li>';
  }).join('');
  return '<div class="month-summary-banner">'
    + '<div class="msb-header"><span class="msb-label">Monthly Summary</span></div>'
    + '<p class="msb-narrative">' + esc(summary.narrative) + '</p>'
    + (winsHtml ? '<ul class="msb-wins">' + winsHtml + '</ul>' : '')
    + '</div>';
}
```

- [ ] **Step 5: Inject banner into month container in `renderAnnual`**

In `renderAnnual()`, locate the `.map(([month, items]) => {` callback. Inside it, before the `return` statement, add:

```javascript
      const summaryBanner = renderSummaryBanner(monthlySummaries[month] || null);
```

Then update the `month-cards` div to include the banner:

```javascript
          <div class="month-cards">
            ${summaryBanner}${renderMonthPage(month, items)}
          </div>
```

- [ ] **Step 6: Add CSS for the summary banner to `style.css`**

Append to `style.css`:

```css
/* ── Monthly Summary Banner ── */
.month-summary-banner {
  background: var(--primary-bg);
  border-left: 3px solid var(--primary);
  border-radius: 0 8px 8px 0;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
.msb-header { margin-bottom: 0.5rem; }
.msb-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--primary);
  font-weight: 700;
}
.msb-narrative {
  font-size: 0.88rem;
  color: var(--text);
  line-height: 1.6;
  margin-bottom: 0.75rem;
}
.msb-wins {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.msb-win {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-left: 1rem;
  position: relative;
}
.msb-win::before {
  content: '✦';
  position: absolute;
  left: 0;
  color: var(--primary);
  font-size: 0.65rem;
  top: 0.2rem;
}
.msb-win-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
}
.msb-win-why {
  font-size: 0.75rem;
  color: var(--muted);
}
```

- [ ] **Step 7: Verify syntax**

```bash
node --check web/app.js && echo OK
```

Expected: `OK`

- [ ] **Step 8: Start the server and check Annual Review manually**

```bash
python3 server.py &
sleep 2
curl -s http://localhost:8765/api/monthly-summaries
# Expected: [] (no summaries yet — that's correct)
curl -s http://localhost:8765/ | grep -c "month-summary-banner"
# Expected: 1 (the CSS class exists in the HTML/JS bundle)
pkill -f "python3 server.py"
```

- [ ] **Step 9: Commit**

```bash
git add web/app.js web/style.css
git commit -m "feat(frontend): show monthly summary banner in Annual Review"
```

---

## Task 7: End-to-end wire-up verification

**Files:** No changes — this task verifies the full chain works.

- [ ] **Step 1: Run the full test suite**

```bash
pytest tests/ -v
```

Expected: all PASS.

- [ ] **Step 2: Seed a month-crossing scenario and verify the signal**

```bash
python3 - <<'EOF'
import db
import tempfile, os

tmp = tempfile.mktemp(suffix=".db")
db.init_db(tmp)

MARCH_TS = 1743379200  # 2025-03-31
APRIL_TS = 1743465600  # 2025-04-01

db.log_accomplishment(tmp, "March work", "Did things", "feature", date_str=MARCH_TS)
result = db.log_accomplishment(tmp, "April work", "Did more", "feature", date_str=APRIL_TS)

assert result["needs_summary"] is not None, "needs_summary missing"
assert result["needs_summary"]["month"] == "2025-03"
assert result["needs_summary"]["stats"]["total"] == 1
print("needs_summary:", result["needs_summary"]["month"], "— stats total:", result["needs_summary"]["stats"]["total"])

# Store a summary and verify retrieval
db.store_monthly_summary(tmp, "2025-03", "Shipped things.", [{"title": "March work", "why": "It mattered"}], result["needs_summary"]["stats"])
summary = db.get_monthly_summary(tmp, "2025-03")
assert summary["narrative"] == "Shipped things."
assert summary["stats"]["key_wins"][0]["title"] == "March work"
print("Stored summary for:", summary["month"])

summaries = db.get_monthly_summaries(tmp)
assert len(summaries) == 1
print("get_monthly_summaries count:", len(summaries))

os.unlink(tmp)
print("All checks passed.")
EOF
```

Expected output:
```
needs_summary: 2025-03 — stats total: 1
Stored summary for: 2025-03
get_monthly_summaries count: 1
All checks passed.
```

- [ ] **Step 3: Push branch**

```bash
git push origin feature/month-rollover-summary
```
