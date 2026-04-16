#!/usr/bin/env bash
# Idempotent MCP registration for daily-accomplishments.
# Runs at SessionStart — safe to execute every session.
set -e

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DB="$HOME/.daily-accomplishments/accomplishments.db"
DB_PATH="${ACCOMPLISHMENTS_DB:-$DEFAULT_DB}"

# Check if already registered
if claude mcp list 2>/dev/null | grep -q "daily-accomplishments"; then
  exit 0
fi

# Install Python dependencies quietly
pip3 install -r "$PLUGIN_ROOT/requirements.txt" \
  --trusted-host pypi.org --trusted-host files.pythonhosted.org \
  --break-system-packages -q 2>/dev/null \
  || pip3 install -r "$PLUGIN_ROOT/requirements.txt" \
     --trusted-host pypi.org --trusted-host files.pythonhosted.org -q

# Register MCP server
claude mcp add daily-accomplishments \
  -e ACCOMPLISHMENTS_DB="$DB_PATH" \
  -- python3 "$PLUGIN_ROOT/server.py"
