import sqlite3
import json
from datetime import date, timedelta
from typing import Optional


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
                date         DATE    NOT NULL DEFAULT (date('now')),
                created_at   DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON accomplishments(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON accomplishments(category)")
        # Migration: add context column to existing databases
        try:
            conn.execute("ALTER TABLE accomplishments ADD COLUMN context TEXT NOT NULL DEFAULT 'work'")
        except sqlite3.OperationalError:
            pass  # Column already exists
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
    date_str: Optional[str] = None,
    context: str = "work",
) -> dict:
    if tags is None:
        tags = []
    if date_str is None:
        date_str = date.today().strftime("%Y-%m-%d")

    with get_conn(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO accomplishments (title, description, category, impact_level, tags, date, context)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (title, description, category, impact_level, json.dumps(tags), date_str, context),
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
) -> list:
    query = "SELECT * FROM accomplishments WHERE 1=1"
    params = []

    if date_from:
        query += " AND date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND date <= ?"
        params.append(date_to)
    if category:
        query += " AND category = ?"
        params.append(category)
    if impact_level:
        query += " AND impact_level = ?"
        params.append(impact_level)
    if context:
        query += " AND context = ?"
        params.append(context)

    query += " ORDER BY date DESC, created_at DESC"

    with get_conn(db_path) as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_dict(row) for row in rows]


def search_accomplishments(db_path: str, query: str) -> list:
    with get_conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM accomplishments
            WHERE title LIKE ? OR description LIKE ? OR tags LIKE ?
            ORDER BY date DESC, created_at DESC
            """,
            (f"%{query}%", f"%{query}%", f"%{query}%"),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]


def get_summary(db_path: str, period: str = "this_year") -> dict:
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

    date_from, date_to = date_ranges.get(period, date_ranges["all_time"])
    items = get_accomplishments(db_path, date_from=date_from, date_to=date_to)

    by_category: dict[str, int] = {}
    by_impact: dict[str, int] = {"low": 0, "medium": 0, "high": 0}
    by_month: dict[str, int] = {}

    for item in items:
        cat = item["category"]
        by_category[cat] = by_category.get(cat, 0) + 1
        lvl = item["impact_level"]
        by_impact[lvl] = by_impact.get(lvl, 0) + 1
        month = item["date"][:7]
        by_month[month] = by_month.get(month, 0) + 1

    return {
        "period": period,
        "date_from": date_from,
        "date_to": date_to,
        "total": len(items),
        "by_category": by_category,
        "by_impact": by_impact,
        "by_month": by_month,
        "accomplishments": items,
    }


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
        fields.append("date = ?"); params.append(date_str)
    if context is not None:
        fields.append("context = ?"); params.append(context)

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
                        (title, description, category, impact_level, tags, date, context, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r["title"], r["description"], r["category"],
                        r.get("impact_level", "medium"),
                        json.dumps(r.get("tags") or []),
                        r["date"],
                        r.get("context", "work"),
                        r.get("created_at"),
                    ),
                )
                added += 1
        conn.commit()

    return {"added": added, "skipped": skipped, "total_source": len(source_records)}


def delete_accomplishment(db_path: str, id: int) -> bool:
    with get_conn(db_path) as conn:
        cursor = conn.execute("DELETE FROM accomplishments WHERE id = ?", (id,))
        conn.commit()
        return cursor.rowcount > 0


def get_stats(db_path: str) -> dict:
    today = date.today()
    week_start = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    year_start = today.replace(month=1, day=1).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")

    with get_conn(db_path) as conn:
        total = conn.execute("SELECT COUNT(*) FROM accomplishments").fetchone()[0]
        high_impact = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE impact_level = 'high'"
        ).fetchone()[0]
        this_week = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE date >= ?", (week_start,)
        ).fetchone()[0]
        this_year = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE date >= ?", (year_start,)
        ).fetchone()[0]
        today_count = conn.execute(
            "SELECT COUNT(*) FROM accomplishments WHERE date = ?", (today_str,)
        ).fetchone()[0]

    return {
        "total": total,
        "high_impact": high_impact,
        "this_week": this_week,
        "this_year": this_year,
        "today": today_count,
    }
