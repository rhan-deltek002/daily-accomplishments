# Daily Accomplishments Tracker

An MCP server that lets Claude log your daily accomplishments automatically, with a web dashboard to review them — including an annual review mode great for performance reviews.

## What is this?

**Daily Accomplishments** is a personal productivity tool that runs inside Claude Code.

Instead of manually writing down what you did each day, Claude tracks it for you as you work. At review time, pull up a timeline or annual summary — great for performance reviews or just reflecting on your progress.

- **Logging via Claude** — Claude logs entries using natural language tools as you work
- **Smart deduplication** — checks existing records before logging to avoid duplicates and consolidates related work
- **Web dashboard** — Timeline view, annual review, and settings in a single lightweight frontend
- **AI-assisted merge** — if you have databases from multiple machines, Claude can intelligently merge them, identifying near-duplicates

Think of it as a *work journal that writes itself.*

## How it works

1. At the end of any Claude Code session, say: **"Log today's accomplishments"**
2. Claude analyses the session and calls the MCP tools to record what was done
3. Open the dashboard at `http://localhost:8765` to browse your history
4. At review time: **"Summarize my accomplishments this year"**

## Requirements

- Python 3.10+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## Installation

### Step 1: Clone the repo

```bash
git clone https://github.com/rhan-deltek002/daily-accomplishments.git
cd daily-accomplishments
```

### Step 2: Install dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Register the MCP

> **Recommended:** Use the manual command below so you can choose the scope. The install scripts default to **project scope**, meaning the MCP is only active when Claude Code is opened inside this directory — most users want it available everywhere.

#### Recommended: manual install (choose your scope)

Register with `--scope user` to make it available **across all your projects**:

```bash
# Linux / macOS / WSL
claude mcp add daily-accomplishments --scope user \
  -e ACCOMPLISHMENTS_DB="$HOME/.daily-accomplishments/accomplishments.db" \
  -- python3 /path/to/daily-accomplishments/server.py
```

```bat
rem Windows
claude mcp add daily-accomplishments --scope user ^
  -e ACCOMPLISHMENTS_DB="%USERPROFILE%\.daily-accomplishments\accomplishments.db" ^
  -- python C:\path\to\daily-accomplishments\server.py
```

Use `--scope project` instead if you intentionally want it limited to a single project directory.

#### Quick install scripts (project scope only)

These scripts register the MCP at **project scope** — only active when Claude Code is opened inside this directory.

```bash
# Linux / macOS / WSL
./install.sh

# Custom database location
./install.sh /path/to/my-accomplishments.db
```

```bat
rem Windows
install.bat
```

To switch an existing installation from project to user scope:
```bash
claude mcp remove daily-accomplishments
# then re-run the manual install command above with --scope user
```

## Database location

| Platform | Default path |
|----------|-------------|
| Linux / WSL | `~/.daily-accomplishments/accomplishments.db` |
| macOS | `~/.daily-accomplishments/accomplishments.db` |
| Windows | `%USERPROFILE%\.daily-accomplishments\accomplishments.db` |

The directory is created automatically. To use a different location on Linux/macOS, pass it as an argument to `install.sh` (see above) or set the `ACCOMPLISHMENTS_DB` environment variable. On Windows the default path is always used — to move the database, use the **Settings** page in the dashboard.

## MCP Tools

Claude has access to these tools once the MCP is registered:

| Tool | Description |
|------|-------------|
| `log_accomplishment` | Record one accomplishment (title, description, category, impact, context) |
| `get_accomplishments` | Query with filters (date range, category, impact, context) |
| `search_accomplishments` | Full-text search |
| `get_summary` | Stats grouped by category/month — ideal for annual reviews |
| `update_accomplishment` | Edit an existing entry by ID |
| `delete_accomplishment` | Delete an entry by ID |

### Categories
`feature` · `bugfix` · `learning` · `review` · `design` · `documentation` · `refactor` · `infrastructure` · `meeting` · `other`

### Impact levels
`low` · `medium` · `high`

### Context
Free-form label to separate work types. Common values: `work` (default), `side_project`, `personal`.

## Moving your database

Use the **Settings** page in the dashboard:

1. **Export DB** — downloads the current database file to your browser
2. Move the file to the desired location
3. **Change DB** — paste the new path (Windows or Linux format) and click **Save**

The server switches immediately with no data copied. The selected path is saved to `~/.daily-accomplishments/config.json` and persists across restarts.

## Dashboard

Start the server manually (useful for testing):
```bash
python3 server.py        # Linux/macOS/WSL
python server.py         # Windows
```

Then open `http://localhost:8765`.

The dashboard starts automatically whenever Claude Code launches a session with the MCP active.

## Uninstall

```bash
claude mcp remove daily-accomplishments
```

Your database file is not deleted — remove it manually if needed.
