#!/usr/bin/env python3
"""
Daily Accomplishments MCP Server + Web Dashboard

MCP runs over stdio (how Claude connects).
Web dashboard runs in a background thread on http://localhost:8765
"""
import os
import re
import sys
import json
import time
import random
import sqlite3
import shutil
import tempfile
import threading
from datetime import datetime
from typing import Optional

from starlette.background import BackgroundTask

import uvicorn
from fastapi import FastAPI, Query, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from mcp.server.fastmcp import FastMCP

import db as database

# ---------------------------------------------------------------------------
# Paths & config
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DASHBOARD_HTML = os.path.join(BASE_DIR, "web", "index.html")
WEB_PORT = 8765

_DATA_DIR = os.path.join(os.path.expanduser("~"), ".daily-accomplishments")
_CONFIG_PATH = os.path.join(_DATA_DIR, "config.json")
_DEFAULT_DB = os.path.join(_DATA_DIR, "accomplishments.db")


def _load_config() -> dict:
    if os.path.exists(_CONFIG_PATH):
        with open(_CONFIG_PATH) as f:
            return json.load(f)
    return {}


def _save_config(updates: dict) -> None:
    """Merge updates into the config file (never overwrites unrelated keys)."""
    config = _load_config()
    config.update(updates)
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


# ---------------------------------------------------------------------------
# Creative name generator  (pattern: ADJECTIVE_FRUIT)
# ---------------------------------------------------------------------------
_ADJECTIVES = [
    "golden", "amber", "azure", "crimson", "emerald", "sapphire", "silver",
    "stellar", "cosmic", "lunar", "radiant", "luminous", "serene", "vibrant",
    "timeless", "ancient", "vivid", "crystal", "noble", "twilight",
]
_FRUITS = [
    "apple", "mango", "peach", "plum", "grape", "lemon", "cherry", "melon",
    "kiwi", "pear", "fig", "guava", "lychee", "papaya", "apricot", "lime",
    "coconut", "berry", "orange", "pomelo",
]


def _creative_name() -> str:
    """Return a name in the format ADJECTIVE_FRUIT_YYYYMMDD_HHMMSS."""
    ts = int(datetime.now().timestamp())
    return f"{random.choice(_ADJECTIVES)}_{random.choice(_FRUITS)}_{ts}"


# ---------------------------------------------------------------------------
# DB history helpers  (last 10 paths, stored in config.json)
# ---------------------------------------------------------------------------
_HISTORY_LIMIT = 10


def _add_to_history(path: str, display_name: str, db_type: str = "active") -> None:
    config = _load_config()
    history = config.get("db_history", [])
    # Remove any existing entry for this path so it moves to top
    history = [h for h in history if h["path"] != path]
    history.insert(0, {
        "path": path,
        "display_name": display_name,
        "last_used": datetime.now().isoformat(),
        "type": db_type,
    })
    _save_config({"db_history": history[:_HISTORY_LIMIT]})


# Priority: config file > ACCOMPLISHMENTS_DB env var > default
_config = _load_config()
DB_PATH: str = _config.get("db_path") or os.environ.get("ACCOMPLISHMENTS_DB") or _DEFAULT_DB

# Ensure the database directory exists and initialise
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
database.init_db(DB_PATH)
_add_to_history(DB_PATH, os.path.splitext(os.path.basename(DB_PATH))[0], "active")

def _is_wsl() -> bool:
    try:
        with open('/proc/version') as f:
            return 'microsoft' in f.read().lower()
    except OSError:
        return False

_RUNNING_IN_WSL = _is_wsl()


def _normalize_path(path: str) -> str:
    """Normalise a user-supplied path for the current platform.

    On WSL: convert Windows-style paths to their /mnt/<drive>/... equivalent
      C:\\Users\\rhan\\foo  →  /mnt/c/Users/rhan/foo
      C:/Users/rhan/foo    →  /mnt/c/Users/rhan/foo

    On native Windows or Linux: return the path unchanged (just flip
    backslashes to forward slashes on Windows so os.path functions work).
    """
    m = re.match(r'^([A-Za-z]):[\\\/](.*)', path)
    if m:
        if _RUNNING_IN_WSL:
            drive = m.group(1).lower()
            rest = m.group(2).replace('\\', '/')
            return f'/mnt/{drive}/{rest}'
        else:
            # Native Windows — keep the drive letter, just normalise slashes
            return path.replace('/', '\\')
    return path


# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------
mcp = FastMCP(
    "daily-accomplishments",
    instructions=(
        "Use these tools to record and review the user's daily accomplishments. "

        "All date parameters MUST be Unix timestamps (seconds since epoch, integers). "
        "NEVER pass date strings like 'YYYY-MM-DD'. "
        "To get the current timestamp, run: date +%s in bash. "
        "The date field on log_accomplishment is optional and defaults to the current time. "

        "BEFORE logging at the end of a session: call get_accomplishments with today's timestamp "
        "to see what is already recorded. If related accomplishments exist, update them with "
        "update_accomplishment rather than creating duplicates. Consolidate related work into "
        "a single entry — do not log one entry per file changed, bug fixed, or tool added. "
        "Aim for one entry per distinct, meaningful outcome. "
        "Keep descriptions concise — 2 to 3 sentences is usually enough. "
        "Exceed this only when the work is genuinely complex and a short description would lose important context. "
        "If the workspace is a git repository, populate the project field with the project name "
        "(derived from the git remote URL or the repository folder name). "

        "For long sessions, encourage the user to log incrementally at natural breakpoints "
        "(e.g. after completing a feature or fixing a bug) rather than only at the end. "
        "Long conversations may be compacted, which causes early details to be lost — "
        "logging while the work is still in context produces more accurate records. "

        "Default context='work'. You may infer a different context if the work is clearly "
        "related to a previously logged record with a different context — for example, if "
        "earlier records for the same project are tagged 'side_project', use that. "
        "If the user explicitly specifies a context, always use that. "
        "Never ask the user to clarify context. "

        "Use get_summary for performance review preparation. After retrieving the data, "
        "present it as a structured narrative grouped by project — not just raw numbers. "
        "For large date ranges, use the two-pass strategy: first call get_summary without "
        "include_records to discover projects, then call it again per project with "
        "include_records=True to get the full details for each section. "

        "To merge databases: warn the user first that this can be token-intensive for large "
        "databases (all records are loaded into context). Then call get_merge_candidates with "
        "the file paths, review results carefully — use your judgment to identify near-duplicates "
        "that differ only in wording, ask the user when unsure — then call execute_merge with "
        "the final curated list. Never skip the review step."
    ),
)

VALID_CATEGORIES = [
    "feature", "bugfix", "learning", "review", "design",
    "documentation", "refactor", "infrastructure", "meeting", "other",
]
VALID_IMPACT = ["low", "medium", "high"]
VALID_PERIODS = ["today", "this_week", "this_month", "this_year", "last_year", "all_time"]


@mcp.tool()
def log_accomplishment(
    title: str,
    description: str,
    category: str,
    date: Optional[int] = None,
    impact_level: str = "medium",
    tags: list[str] = [],
    context: str = "work",
    project: Optional[str] = None,
) -> dict:
    """
    Log a new accomplishment or completed task.

    Call this at the end of a Claude session to record what was achieved.
    Multiple calls are expected — one per significant accomplishment.

    Args:
        title: Brief, one-line title (e.g. "Implemented user authentication")
        description: Detailed description of what was done and why it matters
        category: One of: feature, bugfix, learning, review, design,
                  documentation, refactor, infrastructure, meeting, other
        date: Unix timestamp (seconds since epoch). Optional — defaults to now.
        impact_level: Significance — low | medium | high
        tags: Optional list of keywords (e.g. ["python", "api", "auth"])
        context: Where this work belongs — e.g. "work", "side_project",
                 "personal", or any custom label. Always defaults to "work"
                 unless the user explicitly says otherwise.
        project: Project name (e.g. "my-app", "daily-accomplishments").
                 If the workspace is a git repo, derive from remote URL or folder name.
    """
    if category not in VALID_CATEGORIES:
        return {"error": f"Invalid category '{category}'. Must be one of: {VALID_CATEGORIES}"}
    if impact_level not in VALID_IMPACT:
        return {"error": f"Invalid impact_level '{impact_level}'. Must be one of: {VALID_IMPACT}"}
    if date is None:
        date = int(time.time())
    elif not isinstance(date, int):
        return {"error": f"date must be a Unix timestamp (int), got {type(date).__name__}. Run: date +%s"}

    record = database.log_accomplishment(
        DB_PATH, title, description, category, impact_level, tags, date, context, project
    )
    return {"success": True, "id": record["id"], "title": record["title"], "date": record["date"], "context": record["context"], "project": record.get("project")}


@mcp.tool()
def get_accomplishments(
    date_from: Optional[int] = None,
    date_to: Optional[int] = None,
    category: Optional[str] = None,
    impact_level: Optional[str] = None,
    context: Optional[str] = None,
    project: Optional[str] = None,
) -> list:
    """
    Retrieve logged accomplishments with optional filters.

    Args:
        date_from: Start of range as Unix timestamp (seconds since epoch, inclusive)
        date_to: End of range as Unix timestamp (seconds since epoch, inclusive)
        category: Filter by category
        impact_level: Filter by impact (low | medium | high)
        context: Filter by context (e.g. "work", "side_project", "personal")
        project: Filter by project name
    """
    return database.get_accomplishments(DB_PATH, date_from, date_to, category, impact_level, context, project)


@mcp.tool()
def search_accomplishments(query: str) -> list:
    """
    Full-text search across accomplishment titles, descriptions, and tags.

    Args:
        query: Search term (e.g. "authentication", "python", "API")
    """
    return database.search_accomplishments(DB_PATH, query)


@mcp.tool()
def get_summary(
    period: str = "this_year",
    date_from: Optional[int] = None,
    date_to: Optional[int] = None,
    include_records: bool = False,
    project: Optional[str] = None,
) -> dict:
    """
    Get a summary of accomplishments for a time period.

    Ideal for performance reviews — shows totals broken down by
    category, impact level, month, and project.

    Provide either period OR date_from/date_to for a custom range.
    When date_from/date_to are provided they take precedence over period.

    Args:
        period: One of: today, this_week, this_month, this_year,
                last_year, all_time
        date_from: Start of range as Unix timestamp (seconds since epoch, inclusive).
        date_to: End of range as Unix timestamp (seconds since epoch, inclusive).
        include_records: Whether to include the full list of accomplishment
                         records in the response. Defaults to False to keep
                         token usage low. Set to True when you need the full
                         descriptions to write a detailed narrative summary.
        project: Filter to a single project. Use in the second pass of a
                 multi-project summary (see below).

    After retrieving the data, present it as a structured performance summary
    worth showing to a manager — not just raw numbers. Group accomplishments
    by project, highlight high-impact work, call out key deliverables by name,
    and include relevant technical detail. Use a narrative format with clear
    headings. Lead with what was delivered and why it matters.

    For large date ranges (e.g. a full year), use this two-pass strategy to
    keep token usage manageable:
    1. Call get_summary without include_records to get the breakdown and the
       list of projects (by_project).
    2. For each project in by_project, call get_summary again with
       include_records=True and project=<name> — this keeps each call small
       and focused, and lets you write a detailed section per project.
    """
    if not (date_from or date_to) and period not in VALID_PERIODS:
        return {"error": f"Invalid period '{period}'. Must be one of: {VALID_PERIODS}"}
    return database.get_summary(DB_PATH, period, date_from, date_to, include_records, project)


@mcp.tool()
def update_accomplishment(
    id: int,
    title: Optional[str] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
    impact_level: Optional[str] = None,
    tags: Optional[list[str]] = None,
    date: Optional[int] = None,
    context: Optional[str] = None,
    project: Optional[str] = None,
) -> dict:
    """
    Edit an existing accomplishment by its ID.
    Only the fields you provide will be updated; omitted fields stay unchanged.

    Args:
        id: The accomplishment ID (from log_accomplishment or get_accomplishments)
        title: New title
        description: New description
        category: New category
        impact_level: New impact level (low | medium | high)
        tags: New tags list (replaces existing tags)
        date: New date as Unix timestamp (seconds since epoch)
        context: New context (e.g. "work", "side_project", "personal")
        project: New project name
    """
    if category is not None and category not in VALID_CATEGORIES:
        return {"error": f"Invalid category '{category}'. Must be one of: {VALID_CATEGORIES}"}
    if impact_level is not None and impact_level not in VALID_IMPACT:
        return {"error": f"Invalid impact_level '{impact_level}'. Must be one of: {VALID_IMPACT}"}
    if date is not None and not isinstance(date, int):
        return {"error": f"date must be a Unix timestamp (int), got {type(date).__name__}. Run: date +%s"}

    updated = database.update_accomplishment(DB_PATH, id, title, description, category, impact_level, tags, date, context, project)
    if updated is None:
        return {"error": f"No accomplishment found with id={id}, or no fields were provided to update."}
    return {"success": True, "accomplishment": updated}


@mcp.tool()
def delete_accomplishment(id: int) -> dict:
    """
    Delete an accomplishment by its ID.

    Args:
        id: The accomplishment ID to delete
    """
    deleted = database.delete_accomplishment(DB_PATH, id)
    if not deleted:
        return {"error": f"No accomplishment found with id={id}"}
    return {"success": True, "deleted_id": id}


@mcp.tool()
def get_merge_candidates(source_paths: list[str]) -> dict:
    """
    Read records from multiple database files and surface potential duplicates.

    ⚠️  Cost warning: all records from every source file are loaded into context.
    This can be token-intensive for large databases — warn the user before calling
    this on databases with hundreds of records.

    Use this first when the user wants to merge databases. Returns all records
    labelled by source, with exact duplicates pre-flagged. Review the
    unique_records list for near-duplicates (same accomplishment described
    differently on different machines) before calling execute_merge.

    Args:
        source_paths: List of paths to .db files to merge.
                      Windows paths (C:\\...) are converted automatically on WSL.
    """
    normalized = []
    for p in source_paths:
        resolved = _normalize_path(os.path.expanduser(p.strip().strip('"\'') ))
        if not os.path.exists(resolved):
            return {"error": f"File not found: {resolved}"}
        normalized.append(resolved)

    return database.get_merge_candidates(normalized)


@mcp.tool()
def execute_merge(records: list[dict], output_path: Optional[str] = None) -> dict:
    """
    Create a new merged database from the provided list of records.

    Call this after reviewing get_merge_candidates and deciding which records
    to keep. Pass only the records you want in the final database — duplicates
    you chose to drop should simply be omitted from the list.

    Args:
        records: List of record dicts to write. Each needs: title, description,
                 category, impact_level, tags, date, context. The _source field
                 is ignored if present.
        output_path: Where to save the merged database. Defaults to
                     ~/.daily-accomplishments/merged_<timestamp>.db
                     Windows paths are converted automatically on WSL.
    """
    if output_path is None:
        name = _creative_name()
        out = os.path.join(_DATA_DIR, f"{name}_merge.db")
    else:
        out = _normalize_path(os.path.expanduser(output_path.strip().strip('"\'') ))
        name = os.path.splitext(os.path.basename(out))[0]

    os.makedirs(os.path.dirname(out), exist_ok=True)
    result = database.execute_merge(records, out)
    _add_to_history(out, name, "merge")
    return result


# ---------------------------------------------------------------------------
# Web Dashboard (FastAPI)
# ---------------------------------------------------------------------------
web_app = FastAPI(title="Daily Accomplishments Dashboard")
web_app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "web")), name="static")


@web_app.get("/", response_class=HTMLResponse)
async def dashboard():
    with open(DASHBOARD_HTML, encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@web_app.get("/api/accomplishments")
async def api_accomplishments(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    impact_level: Optional[str] = Query(None),
    context: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    if search:
        results = database.search_accomplishments(DB_PATH, search)
        if context:
            results = [r for r in results if r.get("context") == context]
        if project:
            results = [r for r in results if r.get("project") == project]
    else:
        results = database.get_accomplishments(DB_PATH, date_from, date_to, category, impact_level, context, project)
    return JSONResponse(content=results)


@web_app.get("/api/summary/{period}")
async def api_summary(period: str):
    if period not in VALID_PERIODS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid period. Use one of: {VALID_PERIODS}"},
        )
    return JSONResponse(content=database.get_summary(DB_PATH, period))


@web_app.get("/api/stats")
async def api_stats():
    return JSONResponse(content=database.get_stats(DB_PATH))


@web_app.get("/api/settings")
async def api_settings():
    return JSONResponse(content={"db_path": DB_PATH})


@web_app.post("/api/settings")
async def api_save_settings(body: dict):
    global DB_PATH
    raw = body.get("db_path", "").strip().strip('"\'')
    new_path = _normalize_path(os.path.expanduser(raw))
    if not new_path:
        return JSONResponse(status_code=400, content={"error": "db_path is required"})

    # Require the file to already exist — silently creating an empty database
    # at a mistyped path is confusing and causes data loss.
    if not os.path.exists(new_path):
        return JSONResponse(status_code=400, content={
            "error": f"No file found at: {new_path}\n\nExport your current database, move it to that location, then try again."
        })

    # Validate it's a proper SQLite database with the right table
    try:
        conn = sqlite3.connect(new_path)
        count = conn.execute("SELECT COUNT(*) FROM accomplishments").fetchone()[0]
        conn.close()
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Not a valid accomplishments database: {e}"})

    # Run migrations (adds any missing columns) then switch
    try:
        database.init_db(new_path)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Could not open database: {e}"})

    DB_PATH = new_path
    display_name = os.path.splitext(os.path.basename(new_path))[0]
    _save_config({"db_path": new_path})
    _add_to_history(new_path, display_name, "active")
    return JSONResponse(content={"success": True, "db_path": DB_PATH, "count": count})


@web_app.put("/api/accomplishments/{id}")
async def api_update(id: int, body: dict):
    updated = database.update_accomplishment(
        DB_PATH, id,
        title=body.get("title"),
        description=body.get("description"),
        category=body.get("category"),
        impact_level=body.get("impact_level"),
        tags=body.get("tags"),
        date_str=body.get("date"),
        context=body.get("context"),
        project=body.get("project"),
    )
    if updated is None:
        return JSONResponse(status_code=404, content={"error": "Not found or nothing to update"})
    return JSONResponse(content=updated)


@web_app.delete("/api/accomplishments/{id}")
async def api_delete(id: int):
    deleted = database.delete_accomplishment(DB_PATH, id)
    if not deleted:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return JSONResponse(content={"success": True, "deleted_id": id})


@web_app.get("/api/export")
async def api_export():
    if not os.path.exists(DB_PATH):
        return JSONResponse(status_code=404, content={"error": "Database not found"})
    filename = f"{_creative_name()}_export.db"
    return FileResponse(
        DB_PATH,
        media_type="application/octet-stream",
        filename=filename,
    )


@web_app.post("/api/merge")
async def api_merge(file: UploadFile = File(...)):
    # Write the uploaded source DB to a temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix="_source.db") as tmp:
        shutil.copyfileobj(file.file, tmp)
        source_path = tmp.name

    # Validate it's a proper SQLite database with the right table
    try:
        conn = sqlite3.connect(source_path)
        conn.execute("SELECT COUNT(*) FROM accomplishments").fetchone()
        conn.close()
    except Exception as e:
        os.unlink(source_path)
        return JSONResponse(status_code=400, content={"error": f"Invalid database file: {e}"})

    # Create the output as a copy of the active DB — the active DB is never modified
    name = _creative_name()
    output_path = source_path.replace("_source.db", f"_{name}_merge.db")
    shutil.copy2(DB_PATH, output_path)

    try:
        database.init_db(source_path)
        result = database.merge_accomplishments(output_path, source_path)
    except Exception as e:
        os.unlink(source_path)
        os.unlink(output_path)
        return JSONResponse(status_code=500, content={"error": f"Merge failed: {e}"})

    def cleanup():
        for p in (source_path, output_path):
            try:
                os.unlink(p)
            except OSError:
                pass

    download_name = f"{name}_merge.db"
    headers = {
        "X-Merge-Added": str(result["added"]),
        "X-Merge-Skipped": str(result["skipped"]),
        "X-Merge-Total": str(result["total_source"]),
        "X-Merge-Name": download_name,
    }
    return FileResponse(
        output_path,
        media_type="application/octet-stream",
        filename=download_name,
        headers=headers,
        background=BackgroundTask(cleanup),
    )


@web_app.get("/api/db-history")
async def api_db_history():
    config = _load_config()
    return JSONResponse(content=config.get("db_history", []))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def _run_web_server() -> None:
    uvicorn.run(web_app, host="127.0.0.1", port=WEB_PORT, log_level="error")


def main() -> None:
    web_thread = threading.Thread(target=_run_web_server, daemon=True)
    web_thread.start()
    print(f"Dashboard: http://localhost:{WEB_PORT}", file=sys.stderr)
    mcp.run()


if __name__ == "__main__":
    main()
