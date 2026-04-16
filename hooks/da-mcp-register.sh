#!/usr/bin/env bash
# Idempotent MCP registration for daily-accomplishments.
# Runs at SessionStart — safe to execute every session.
set -e

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DB="$HOME/.daily-accomplishments/accomplishments.db"
DB_PATH="${ACCOMPLISHMENTS_DB:-$DEFAULT_DB}"

# Validate required files exist before attempting anything
if [ ! -f "$PLUGIN_ROOT/server.py" ]; then
  echo "[da-mcp] ERROR: server.py not found at $PLUGIN_ROOT/server.py" >&2
  exit 1
fi
if [ ! -f "$PLUGIN_ROOT/requirements.txt" ]; then
  echo "[da-mcp] ERROR: requirements.txt not found at $PLUGIN_ROOT/requirements.txt" >&2
  exit 1
fi

# Validate python3 is available
if ! command -v python3 >/dev/null 2>&1; then
  echo "[da-mcp] ERROR: python3 not found in PATH. Cannot register MCP server." >&2
  exit 1
fi

# Check if already registered (capture stdout; stderr flows to terminal for real failures)
mcp_list=$(claude mcp list)
if echo "$mcp_list" | grep -qw "daily-accomplishments"; then
  exit 0
fi

# Install Python dependencies.
# Note: --break-system-packages is required on Debian/Ubuntu (externally-managed-environment)
# but not supported on all pip versions; fallback omits it for compatibility.
pip3 install -r "$PLUGIN_ROOT/requirements.txt" \
  --trusted-host pypi.org --trusted-host files.pythonhosted.org \
  --break-system-packages -q 2>&1 \
  || pip3 install -r "$PLUGIN_ROOT/requirements.txt" \
     --trusted-host pypi.org --trusted-host files.pythonhosted.org -q \
  || { echo "[da-mcp] ERROR: pip install failed. MCP server not registered." >&2; exit 1; }

# Register MCP server
claude mcp add daily-accomplishments \
  -e ACCOMPLISHMENTS_DB="$DB_PATH" \
  -- python3 "$PLUGIN_ROOT/server.py"

echo "[da-mcp] Registered daily-accomplishments MCP server." >&2
