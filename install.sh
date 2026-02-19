#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Database location — override by passing a path as the first argument
# or by setting ACCOMPLISHMENTS_DB in the environment before running.
#
#   ./install.sh                          # default: ~/.daily-accomplishments/accomplishments.db
#   ./install.sh /data/my-db.db          # custom path via argument
#   ACCOMPLISHMENTS_DB=/data/my-db.db ./install.sh  # custom path via env
#
DEFAULT_DB="$HOME/.daily-accomplishments/accomplishments.db"
DB_PATH="${1:-${ACCOMPLISHMENTS_DB:-$DEFAULT_DB}}"

echo "Installing Python dependencies…"
pip3 install -r "$SCRIPT_DIR/requirements.txt" \
  --trusted-host pypi.org --trusted-host files.pythonhosted.org \
  --break-system-packages -q 2>/dev/null \
  || pip3 install -r "$SCRIPT_DIR/requirements.txt" \
     --trusted-host pypi.org --trusted-host files.pythonhosted.org -q

# Windows (native, not WSL): run the equivalent manually in PowerShell —
#   $env:ACCOMPLISHMENTS_DB = "$HOME\.daily-accomplishments\accomplishments.db"
#   claude mcp add daily-accomplishments --scope user -e ACCOMPLISHMENTS_DB="$env:ACCOMPLISHMENTS_DB" -- python "$PSScriptRoot\server.py"
echo "Registering MCP server with Claude…"
claude mcp add daily-accomplishments --scope user \
  -e ACCOMPLISHMENTS_DB="$DB_PATH" \
  -- python3 "$SCRIPT_DIR/server.py"

echo ""
echo "✓ Done! The MCP server is registered as 'daily-accomplishments'."
echo ""
echo "  Database: $DB_PATH"
echo "  Dashboard: http://localhost:8765 (active during Claude sessions)"
echo ""
echo "Usage:"
echo "  At the end of any Claude session, say:"
echo "  \"Log today's accomplishments\""
echo "  Claude will analyze the session and call the MCP tools automatically."
echo ""
echo "  For annual review: \"Summarize my accomplishments this year\""
