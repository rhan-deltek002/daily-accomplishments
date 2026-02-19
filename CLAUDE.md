# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

An MCP server that lets Claude log daily accomplishments, with a web dashboard at `http://localhost:8765`. The MCP runs over stdio (how Claude Code connects); the web server runs in a background thread within the same process.

## Running the server

```bash
python3 server.py
```

The dashboard is served at `http://localhost:8765`. The MCP tools are available to Claude once the server is registered (see install scripts).

## Installing / registering the MCP

```bash
# Linux/macOS/WSL
./install.sh

# Windows
install.bat
```

Both scripts run `pip install` then call `claude mcp add daily-accomplishments -e ACCOMPLISHMENTS_DB=<path> -- python3 server.py`.

## Architecture

**`server.py`** — entry point. Starts a FastAPI web server in a daemon thread (`port 8765`), then calls `mcp.run()` which blocks on stdio. Holds the global `DB_PATH` (mutable at runtime via `POST /api/settings`). Config is persisted to `~/.daily-accomplishments/config.json`. Path priority: config file > `ACCOMPLISHMENTS_DB` env var > `~/.daily-accomplishments/accomplishments.db`.

**`db.py`** — all SQLite operations. Stateless: every function accepts `db_path` as its first argument so the live `DB_PATH` global is always used. `init_db()` is safe to call on existing databases (uses `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN` with a caught `OperationalError` for migrations).

**`web/index.html`** — single-file dashboard. Vanilla JS, no build step. Fetches from the FastAPI endpoints at runtime. Three views: Timeline, Annual Review, Settings.

## Key behaviours to preserve

- **`DB_PATH` is a runtime global** in `server.py`. Both the MCP tools and the web API read it; changing it via `POST /api/settings` affects both immediately.
- **`_normalize_path()`** converts Windows paths (`C:\...`) to WSL paths (`/mnt/c/...`) when `_RUNNING_IN_WSL` is true, and strips surrounding quotes before processing. Always call this before using a user-supplied path.
- **`POST /api/settings` requires the file to already exist** — it will not create a new empty database at a mistyped path.
- **MCP server instructions** govern how Claude behaves when logging — see the `instructions=` string in `FastMCP(...)`. These are sent to every Claude instance that connects, so all users get consistent behaviour automatically. The rules encoded there:
  - Check today's existing records with `get_accomplishments` *before* logging anything
  - Consolidate related work into one entry; don't log per-file or per-bug granularity
  - Default `context='work'` — but infer a different context if the work clearly relates to previously logged records with a different context (e.g. same project already tagged `side_project`). Never ask.
  - When in doubt, `update_accomplishment` an existing entry rather than creating a new one

## MCP tools

`log_accomplishment`, `get_accomplishments`, `search_accomplishments`, `get_summary`, `update_accomplishment`, `delete_accomplishment`

Valid values: categories — `feature bugfix learning review design documentation refactor infrastructure meeting other`; impact — `low medium high`; context — free-form string, common values `work side_project personal`.

## Database

SQLite. Schema lives in `db.py:init_db()`. The `context` column was added via migration — any change to the schema should follow the same `ALTER TABLE ... ADD COLUMN` + caught `OperationalError` pattern so existing databases upgrade automatically.
