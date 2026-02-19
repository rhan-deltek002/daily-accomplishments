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
import sqlite3
import shutil
import tempfile
import threading
from typing import Optional

import uvicorn
from fastapi import FastAPI, Query, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse

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


def _save_config(data: dict) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)


# Priority: config file > ACCOMPLISHMENTS_DB env var > default
_config = _load_config()
DB_PATH: str = _config.get("db_path") or os.environ.get("ACCOMPLISHMENTS_DB") or _DEFAULT_DB

# Ensure the database directory exists and initialise
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
database.init_db(DB_PATH)

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

        "BEFORE logging at the end of a session: call get_accomplishments with today's date "
        "to see what is already recorded. If related accomplishments exist, update them with "
        "update_accomplishment rather than creating duplicates. Consolidate related work into "
        "a single entry — do not log one entry per file changed, bug fixed, or tool added. "
        "Aim for one entry per distinct, meaningful outcome. "

        "For long sessions, encourage the user to log incrementally at natural breakpoints "
        "(e.g. after completing a feature or fixing a bug) rather than only at the end. "
        "Long conversations may be compacted, which causes early details to be lost — "
        "logging while the work is still in context produces more accurate records. "

        "Default context='work'. You may infer a different context if the work is clearly "
        "related to a previously logged record with a different context — for example, if "
        "earlier records for the same project are tagged 'side_project', use that. "
        "If the user explicitly specifies a context, always use that. "
        "Never ask the user to clarify context. "

        "Use get_summary for annual performance review preparation."
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
    impact_level: str = "medium",
    tags: list[str] = [],
    date: Optional[str] = None,
    context: str = "work",
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
        impact_level: Significance — low | medium | high
        tags: Optional list of keywords (e.g. ["python", "api", "auth"])
        date: Date in YYYY-MM-DD format (defaults to today)
        context: Where this work belongs — e.g. "work", "side_project",
                 "personal", or any custom label. Always defaults to "work"
                 unless the user explicitly says otherwise.
    """
    if category not in VALID_CATEGORIES:
        return {"error": f"Invalid category '{category}'. Must be one of: {VALID_CATEGORIES}"}
    if impact_level not in VALID_IMPACT:
        return {"error": f"Invalid impact_level '{impact_level}'. Must be one of: {VALID_IMPACT}"}

    record = database.log_accomplishment(
        DB_PATH, title, description, category, impact_level, tags, date, context
    )
    return {"success": True, "id": record["id"], "title": record["title"], "date": record["date"], "context": record["context"]}


@mcp.tool()
def get_accomplishments(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category: Optional[str] = None,
    impact_level: Optional[str] = None,
    context: Optional[str] = None,
) -> list:
    """
    Retrieve logged accomplishments with optional filters.

    Args:
        date_from: Start date YYYY-MM-DD (inclusive)
        date_to: End date YYYY-MM-DD (inclusive)
        category: Filter by category
        impact_level: Filter by impact (low | medium | high)
        context: Filter by context (e.g. "work", "side_project", "personal")
    """
    return database.get_accomplishments(DB_PATH, date_from, date_to, category, impact_level, context)


@mcp.tool()
def search_accomplishments(query: str) -> list:
    """
    Full-text search across accomplishment titles, descriptions, and tags.

    Args:
        query: Search term (e.g. "authentication", "python", "API")
    """
    return database.search_accomplishments(DB_PATH, query)


@mcp.tool()
def get_summary(period: str = "this_year") -> dict:
    """
    Get a summary of accomplishments for a time period.

    Ideal for annual performance reviews — shows totals broken down by
    category, impact level, and month.

    Args:
        period: One of: today, this_week, this_month, this_year,
                last_year, all_time
    """
    if period not in VALID_PERIODS:
        return {"error": f"Invalid period '{period}'. Must be one of: {VALID_PERIODS}"}
    return database.get_summary(DB_PATH, period)


@mcp.tool()
def update_accomplishment(
    id: int,
    title: Optional[str] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
    impact_level: Optional[str] = None,
    tags: Optional[list[str]] = None,
    date: Optional[str] = None,
    context: Optional[str] = None,
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
        date: New date in YYYY-MM-DD format
        context: New context (e.g. "work", "side_project", "personal")
    """
    if category is not None and category not in VALID_CATEGORIES:
        return {"error": f"Invalid category '{category}'. Must be one of: {VALID_CATEGORIES}"}
    if impact_level is not None and impact_level not in VALID_IMPACT:
        return {"error": f"Invalid impact_level '{impact_level}'. Must be one of: {VALID_IMPACT}"}

    updated = database.update_accomplishment(DB_PATH, id, title, description, category, impact_level, tags, date, context)
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


# ---------------------------------------------------------------------------
# Web Dashboard (FastAPI)
# ---------------------------------------------------------------------------
web_app = FastAPI(title="Daily Accomplishments Dashboard")


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
    search: Optional[str] = Query(None),
):
    if search:
        results = database.search_accomplishments(DB_PATH, search)
        if context:
            results = [r for r in results if r.get("context") == context]
    else:
        results = database.get_accomplishments(DB_PATH, date_from, date_to, category, impact_level, context)
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
    _save_config({"db_path": new_path})
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
    return FileResponse(
        DB_PATH,
        media_type="application/octet-stream",
        filename="accomplishments.db",
    )


@web_app.post("/api/merge")
async def api_merge(file: UploadFile = File(...)):
    # Write upload to a temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    # Validate it's a proper SQLite database with the right table
    try:
        conn = sqlite3.connect(tmp_path)
        conn.execute("SELECT COUNT(*) FROM accomplishments").fetchone()
        conn.close()
    except Exception as e:
        os.unlink(tmp_path)
        return JSONResponse(status_code=400, content={"error": f"Invalid database file: {e}"})

    # Run migrations on the source so columns match before merging
    try:
        database.init_db(tmp_path)
        result = database.merge_accomplishments(DB_PATH, tmp_path)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Merge failed: {e}"})
    finally:
        os.unlink(tmp_path)

    return JSONResponse(content={"success": True, **result})


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
