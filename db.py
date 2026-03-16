import sqlite3
import json
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional


# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------
def _date_to_ts(date_str: str) -> int:
    """Convert YYYY-MM-DD to Unix timestamp at noon UTC (avoids TZ boundary issues)."""
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
    return int(d.timestamp())


def _datetime_str_to_ts(dt_str: str) -> int:
    """Convert 'YYYY-MM-DD HH:MM:SS' to Unix timestamp (treated as UTC)."""
    try:
        d = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return int(d.timestamp())
    except ValueError:
        d = datetime.strptime(dt_str[:10], "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
        return int(d.timestamp())


def _date_range_start(date_str: str) -> int:
    """Start-of-day (midnight UTC) timestamp for range filtering."""
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(d.timestamp())


def _date_range_end(date_str: str) -> int:
    """End-of-day (23:59:59 UTC) timestamp for range filtering."""
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(
        hour=23, minute=59, second=59, tzinfo=timezone.utc
    )
    return int(d.timestamp())


def _ts_to_month(ts) -> str:
    """Extract YYYY-MM from a Unix timestamp."""
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m")


def _is_string_date(val) -> bool:
    """Check if a value looks like a YYYY-MM-DD date string."""
    return isinstance(val, str) and len(val) >= 10 and val[4:5] == '-'


def _parse_date(val) -> int:
    """Accept a Unix timestamp (int) or YYYY-MM-DD string, return a timestamp."""
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        # Could be a stringified int or a YYYY-MM-DD date
        try:
            return int(val)
        except ValueError:
            return _date_to_ts(val)
    raise ValueError(f"Cannot parse date: {val!r}")


def _parse_date_range_start(val) -> int:
    """Accept int timestamp or YYYY-MM-DD string, return start-of-day timestamp."""
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        try:
            return int(val)
        except ValueError:
            return _date_range_start(val)
    raise ValueError(f"Cannot parse date: {val!r}")


def _parse_date_range_end(val) -> int:
    """Accept int timestamp or YYYY-MM-DD string, return end-of-day timestamp."""
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        try:
            return int(val)
        except ValueError:
            return _date_range_end(val)
    raise ValueError(f"Cannot parse date: {val!r}")


def get_conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str) -> None:
    with get_conn(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS accomplishments (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT    NOT NULL,
                description  TEXT    NOT NULL,
                category     TEXT    NOT NULL,
                impact_level TEXT    NOT NULL DEFAULT 'medium',
                tags         TEXT    DEFAULT '[]',
                context      TEXT    NOT NULL DEFAULT 'work',
                date         INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer)),
                created_at   INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON accomplishments(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON accomplishments(category)")
        # Migration: add context column to existing databases
        try:
            conn.execute("ALTER TABLE accomplishments ADD COLUMN context TEXT NOT NULL DEFAULT 'work'")
        except sqlite3.OperationalError:
            pass  # Column already exists
        # Migration: add project column to existing databases
        try:
            conn.execute("ALTER TABLE accomplishments ADD COLUMN project TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        # Migration: convert string dates to Unix timestamps
        try:
            sample = conn.execute("SELECT date FROM accomplishments LIMIT 1").fetchone()
            if sample and _is_string_date(sample[0]):
                rows = conn.execute("SELECT id, date, created_at FROM accomplishments").fetchall()
                for row in rows:
                    rid, d, ca = row[0], row[1], row[2]
                    new_date = _date_to_ts(d) if d and _is_string_date(d) else d
                    new_ca = _datetime_str_to_ts(ca) if ca and _is_string_date(ca) else ca
                    conn.execute(
                        "UPDATE accomplishments SET date = ?, created_at = ? WHERE id = ?",
                        (new_date, new_ca, rid),
                    )
        except Exception:
            pass  # Empty table or already migrated
        conn.commit()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    try:
        d["tags"] = json.loads(d["tags"]) if d.get("tags") else []
    except (json.JSONDecodeError, TypeError):
        d["tags"] = []
    return d


def log_accomplishment(
    db_path: str,
    title: str,
    description: str,
    category: str,
    impact_level: str = "medium",
    tags: Optional[list] = None,
    date_str=None,
    context: str = "work",
    project: Optional[str] = None,
) -> dict:
    if tags is None:
        tags = []

    created_ts = int(time.time())
    if date_str is None:
        date_ts = created_ts
    else:
        date_ts = _parse_date(date_str)

    with get_conn(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO accomplishments (title, description, category, impact_level, tags, date, context, project, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, description, category, impact_level, json.dumps(tags), date_ts, context, project, created_ts),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM accomplishments WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return _row_to_dict(row)


def get_accomplishments(
    db_path: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category: Optional[str] = None,
    impact_level: Optional[str] = None,
    context: Optional[str] = None,
    project: Optional[str] = None,
) -> list:
    query = "SELECT * FROM accomplishments WHERE 1=1"
    params = []

    if date_from:
        query += " AND date >= ?"
        params.append(_parse_date_range_start(date_from))
    if date_to:
        query += " AND date <= ?"
        params.append(_parse_date_range_end(date_to))
    if category:
        query += " AND category = ?"
        params.append(category)
    if impact_level:
        query += " AND impact_level = ?"
        params.append(impact_level)
    if context:
        query += " AND context = ?"
        params.append(context)
    if project:
        query += " AND project = ?"
        params.append(project)

    query += " ORDER BY date DESC, created_at DESC"

    with get_conn(db_path) as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_dict(row) for row in rows]


def search_accomplishments(db_path: str, query: str) -> list:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM accomplishments
            WHERE title LIKE ? OR description LIKE ? OR tags LIKE ? OR project LIKE ?
            ORDER BY date DESC, created_at DESC
            """,
            (f"%{query}%", f"%{query}%", f"%{query}%", f"%{query}%"),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]


def get_summary(
    db_path: str,
    period: str = "this_year",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_records: bool = False,
    project: Optional[str] = None,
) -> dict:
    today = date.today()

    date_ranges = {
        "today": (today.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")),
        "this_week": (
            (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d"),
            today.strftime("%Y-%m-%d"),
        ),
        "this_month": (
            today.replace(day=1).strftime("%Y-%m-%d"),
            today.strftime("%Y-%m-%d"),
        ),
        "this_year": (
            today.replace(month=1, day=1).strftime("%Y-%m-%d"),
            today.strftime("%Y-%m-%d"),
        ),
        "last_year": (
            f"{today.year - 1}-01-01",
            f"{today.year - 1}-12-31",
        ),
        "all_time": ("2000-01-01", today.strftime("%Y-%m-%d")),
    }

    if date_from or date_to:
        period = "custom"
        date_from = date_from or "2000-01-01"
        date_to = date_to or today.strftime("%Y-%m-%d")
    else:
        date_from, date_to = date_ranges.get(period, date_ranges["all_time"])
    items = get_accomplishments(db_path, date_from=date_from, date_to=date_to, project=project)

    by_category: dict[str, int] = {}
    by_impact: dict[str, int] = {"low": 0, "medium": 0, "high": 0}
    by_month: dict[str, int] = {}
    by_project: dict[str, int] = {}

    for item in items:
        cat = item["category"]
        by_category[cat] = by_category.get(cat, 0) + 1
        lvl = item["impact_level"]
        by_impact[lvl] = by_impact.get(lvl, 0) + 1
        month = _ts_to_month(item["date"])
        by_month[month] = by_month.get(month, 0) + 1
        proj = item.get("project")
        if proj:
            by_project[proj] = by_project.get(proj, 0) + 1

    result = {
        "period": period,
        "date_from": date_from,
        "date_to": date_to,
        "total": len(items),
        "by_category": by_category,
        "by_impact": by_impact,
        "by_month": by_month,
        "by_project": by_project,
    }
    if include_records:
        result["accomplishments"] = items
    return result


def update_accomplishment(
    db_path: str,
    id: int,
    title: Optional[str] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
    impact_level: Optional[str] = None,
    tags: Optional[list] = None,
    date_str: Optional[str] = None,
    context: Optional[str] = None,
    project: Optional[str] = None,
) -> Optional[dict]:
    fields, params = [], []
    if title is not None:
        fields.append("title = ?"); params.append(title)
    if description is not None:
        fields.append("description = ?"); params.append(description)
    if category is not None:
        fields.append("category = ?"); params.append(category)
    if impact_level is not None:
        fields.append("impact_level = ?"); params.append(impact_level)
    if tags is not None:
        fields.append("tags = ?"); params.append(json.dumps(tags))
    if date_str is not None:
        fields.append("date = ?"); params.append(_parse_date(date_str))
    if context is not None:
        fields.append("context = ?"); params.append(context)
    if project is not None:
        fields.append("project = ?"); params.append(project)

    if not fields:
        return None

    params.append(id)
    with get_conn(db_path) as conn:
        conn.execute(f"UPDATE accomplishments SET {', '.join(fields)} WHERE id = ?", params)
        conn.commit()
        row = conn.execute("SELECT * FROM accomplishments WHERE id = ?", (id,)).fetchone()
        return _row_to_dict(row) if row else None


def merge_accomplishments(db_path: str, source_path: str) -> dict:
    """Merge records from source_path into db_path.

    Each record from the source is inserted with a new auto-assigned ID.
    Duplicates are detected by matching title + date + description and skipped.
    The original created_at timestamp is preserved so the timeline stays accurate.
    """
    src_conn = sqlite3.connect(source_path)
    src_conn.row_factory = sqlite3.Row
    try:
        source_records = src_conn.execute(
            "SELECT * FROM accomplishments ORDER BY date, created_at"
        ).fetchall()
    finally:
        src_conn.close()

    added = 0
    skipped = 0

    with get_conn(db_path) as conn:
        for row in source_records:
            r = _row_to_dict(row)
            duplicate = conn.execute(
                "SELECT id FROM accomplishments WHERE title = ? AND date = ? AND description = ?",
                (r["title"], r["date"], r["description"]),
            ).fetchone()

            if duplicate:
                skipped += 1
            else:
                conn.execute(
                    """
                    INSERT INTO accomplishments
                        (title, description, category, impact_level, tags, date, context, project, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r["title"], r["description"], r["category"],
                        r.get("impact_level", "medium"),
                        json.dumps(r.get("tags") or []),
                        r["date"],
                        r.get("context", "work"),
                        r.get("project"),
                        r.get("created_at"),
                    ),
                )
                added += 1
        conn.commit()

    return {"added": added, "skipped": skipped, "total_source": len(source_records)}


def get_merge_candidates(db_paths: list) -> dict:
    """Read records from multiple databases and surface potential duplicates.

    Returns all records labelled by source, with exact duplicates (same
    title + date + description) pre-flagged. Near-duplicates and judgment
    calls are left for the caller (Claude) to resolve.
    """
    all_records = []
    source_info = {}

    for path in db_paths:
        try:
            init_db(path)  # run migrations so columns match
            records = get_accomplishments(path)
            source_info[path] = {"count": len(records)}
            for r in records:
                r["_source"] = path
                all_records.append(r)
        except Exception as e:
            source_info[path] = {"error": str(e)}

    # Flag exact duplicates — same title (case-insensitive) + date + description
    seen: dict = {}
    unique_records = []
    exact_duplicate_groups = []

    for r in all_records:
        key = (r["title"].strip().lower(), r["date"], r["description"].strip().lower())
        if key in seen:
            # Add to the group for that key
            found = next((g for g in exact_duplicate_groups if g["key"] == key), None)
            if found:
                found["records"].append(r)
            else:
                exact_duplicate_groups.append({"key": key, "records": [seen[key], r]})
        else:
            seen[key] = r
            unique_records.append(r)

    return {
        "sources": source_info,
        "total_records": len(all_records),
        "exact_duplicate_groups": exact_duplicate_groups,
        "unique_records": unique_records,
        "note": (
            "exact_duplicate_groups contains records that are identical across sources. "
            "unique_records contains everything else — review for near-duplicates "
            "(e.g. same accomplishment described differently on different machines) "
            "before calling execute_merge."
        ),
    }


def execute_merge(records: list, output_path: str) -> dict:
    """Write a curated list of records into a new database at output_path.

    Call this after reviewing get_merge_candidates and deciding which
    records to keep. The _source field is stripped automatically.
    """
    init_db(output_path)
    with get_conn(output_path) as conn:
        for r in records:
            conn.execute(
                """
                INSERT INTO accomplishments
                    (title, description, category, impact_level, tags, date, context, project, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    r["title"], r["description"], r["category"],
                    r.get("impact_level", "medium"),
                    json.dumps(r.get("tags") or []),
                    r["date"],
                    r.get("context", "work"),
                    r.get("project"),
                    r.get("created_at"),
                ),
            )
        conn.commit()
    return {"success": True, "path": output_path, "count": len(records)}


def delete_accomplishment(db_path: str, id: int) -> bool:
    with get_conn(db_path) as conn:
        cursor = conn.execute("DELETE FROM accomplishments WHERE id = ?", (id,))
        conn.commit()
        return cursor.rowcount > 0


def get_stats(db_path: str) -> dict:
    today = date.today()
    today_str = today.strftime("%Y-%m-%d")
    week_start_str = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    year_start_str = today.replace(month=1, day=1).strftime("%Y-%m-%d")

    today_start = _date_range_start(today_str)
    today_end = _date_range_end(today_str)
    week_start_ts = _date_range_start(week_start_str)
    year_start_ts = _date_range_start(year_start_str)

    with get_conn(db_path) as conn:
        total = conn.execute("SELECT COUNT(*) FROM accomplishments").fetchone()[0]
        high_impact = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE impact_level = 'high'"
        ).fetchone()[0]
        this_week = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE date >= ?", (week_start_ts,)
        ).fetchone()[0]
        this_year = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE date >= ?", (year_start_ts,)
        ).fetchone()[0]
        today_count = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE date >= ? AND date <= ?",
            (today_start, today_end),
        ).fetchone()[0]

    return {
        "total": total,
        "high_impact": high_impact,
        "this_week": this_week,
        "this_year": this_year,
        "today": today_count,
    }
