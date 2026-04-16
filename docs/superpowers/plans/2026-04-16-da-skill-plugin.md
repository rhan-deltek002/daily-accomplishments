# /da Skill & Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/da` skill + cross-platform plugin scaffolding so users can invoke daily-accomplishments MCP tools unambiguously via `/da`, `/da log`, `/da summary`, `/da search`, and `/da review`.

**Architecture:** All new files — nothing existing is modified. A single `skills/da/SKILL.md` is the source-of-truth skill content; platform entry points (`GEMINI.md`, `AGENTS.md`, `.codex/config.toml`) reference it via `@`-includes. Claude Code gets a `.claude-plugin/` manifest + `SessionStart` hook that idempotently registers the MCP server.

**Tech Stack:** Bash (hook script), JSON (plugin manifests), Markdown (skill + platform entry points)

**Spec:** `docs/superpowers/specs/2026-04-16-da-skill-plugin-design.md`

---

### Task 1: Create feature branch

**Files:**
- No file changes — git operation only

- [ ] **Step 1: Create and checkout feature branch**

```bash
git checkout -b feat/da-skill-plugin
```

Expected output: `Switched to a new branch 'feat/da-skill-plugin'`

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feat/da-skill-plugin`

---

### Task 2: Plugin manifests

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create `.claude-plugin/` directory and `plugin.json`**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "daily-accomplishments",
  "description": "Log and review daily accomplishments via /da commands. Provides MCP tools for recording session work and generating summaries.",
  "author": {
    "name": "Rhanel Candia"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/da-mcp-register.sh\"",
            "timeout": 15,
            "statusMessage": "Registering daily-accomplishments MCP server..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Create `marketplace.json`**

Create `.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "daily-accomplishments",
  "description": "Log and review daily accomplishments with Claude. Records session work, generates summaries, and supports performance review preparation.",
  "owner": {
    "name": "Rhanel Candia"
  },
  "plugins": [
    {
      "name": "daily-accomplishments",
      "description": "Log and review daily accomplishments via /da commands",
      "source": "./",
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 3: Validate plugin manifest**

```bash
claude plugin validate .
```

Expected: no errors reported. If errors, fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/
git commit -m "feat(plugin): add Claude Code plugin manifests"
```

---

### Task 3: MCP registration hook

**Files:**
- Create: `hooks/da-mcp-register.sh`

- [ ] **Step 1: Create `hooks/` directory and hook script**

Create `hooks/da-mcp-register.sh`:

```bash
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
```

- [ ] **Step 2: Make hook executable**

```bash
chmod +x hooks/da-mcp-register.sh
```

- [ ] **Step 3: Dry-run test — verify idempotency path**

```bash
# Should print nothing and exit 0 (MCP is already registered from install.sh)
bash hooks/da-mcp-register.sh && echo "exit: $?"
```

Expected: script exits 0 silently (already registered branch taken).

- [ ] **Step 4: Commit**

```bash
git add hooks/da-mcp-register.sh
git commit -m "feat(plugin): add idempotent MCP registration hook"
```

---

### Task 4: Core skill file

**Files:**
- Create: `skills/da/SKILL.md`

- [ ] **Step 1: Create `skills/da/` directory and `SKILL.md`**

Create `skills/da/SKILL.md`:

```markdown
---
name: da
description: >
  Daily accomplishments commands. Use when user invokes /da, /da log,
  /da summary, /da search, or /da review. Provides unambiguous access
  to daily-accomplishments MCP tools without clashing with other servers.
user-invocable: true
---

# /da — Daily Accomplishments

Arguments passed: $ARGUMENTS

---

## Command Routing

Parse `$ARGUMENTS` to determine which command to run:

| Invocation | Action |
|---|---|
| (empty) | Show today's entries + available commands |
| `log` | Log current session work |
| `summary [month]` | Summary for current or specified month |
| `review [month]` | Performance-review narrative for current or specified month |
| `search <query>` | Search accomplishments |

---

## /da (bare — no arguments)

1. Get today's timestamp: run `date +%s` in bash
2. Call `get_accomplishments` with today's timestamp
3. Display entries as a formatted list (title, description, impact, project)
4. If no entries: say "No accomplishments logged today yet."
5. Always append available commands hint:

```
Available: /da log · /da summary · /da review · /da search <query>
```

---

## /da log

Goal: record today's session work without duplicates, consolidated into meaningful outcomes.

1. Get today's timestamp: `date +%s`
2. Call `get_accomplishments` with today's timestamp — note any existing entries
3. Read git context:
   - `git log --oneline -20` (recent commits)
   - `git diff --stat HEAD~5..HEAD 2>/dev/null || git diff --stat` (changed files)
4. Synthesize session work + git context into candidate accomplishment entries
5. Consolidate: one entry per distinct meaningful outcome (not per file, not per bug)
6. If related entries already exist today: prefer `update_accomplishment` over creating duplicates
7. Present proposed entry/entries to user for confirmation before calling any MCP write tool
8. On confirmation: call `log_accomplishment` or `update_accomplishment`

**Field defaults:**
- `project`: derived from `git remote get-url origin` (repo name) or folder name
- `context`: `"side_project"` for this repo; `"work"` otherwise — infer from existing records, never ask
- `impact`: infer from scope of work (high = shipped feature; medium = fix/refactor; low = docs/chore)
- `date`: omit (defaults to current time)

**If git context is sparse:** ask user "What did you work on this session?"

---

## /da summary [month]

1. Get current month boundaries if no month specified:
   - Start: first second of current month (Unix timestamp)
   - End: current timestamp (`date +%s`)
2. If month argument given (e.g. `march`, `2026-03`): convert to timestamp range for that month
3. Call `get_summary` with `start_date`, `end_date`, `include_records=True`
4. Present as structured narrative grouped by project
5. Lead with what was delivered and why it matters

---

## /da review [month]

Same as `/da summary` but framed for performance review:
- Group by project
- Emphasize outcomes and impact, not activities
- Use past-tense, first-person ("Delivered...", "Reduced...", "Built...")
- Suitable for copy-paste into a perf review doc

---

## /da search <query>

1. Extract query from `$ARGUMENTS` (everything after `search `)
2. Call `search_accomplishments` with the query string
3. Display results: title, date, project, description

If no query provided: ask "What are you searching for?"
```

- [ ] **Step 2: Verify skill file is valid YAML frontmatter**

```bash
python3 -c "
import re, sys
content = open('skills/da/SKILL.md').read()
m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
print('Frontmatter OK' if m else 'ERROR: no frontmatter found')
"
```

Expected: `Frontmatter OK`

- [ ] **Step 3: Commit**

```bash
git add skills/da/SKILL.md
git commit -m "feat(skill): add /da skill with subcommand routing"
```

---

### Task 5: Cross-platform entry points

**Files:**
- Create: `gemini-extension.json`
- Create: `GEMINI.md`
- Create: `AGENTS.md`
- Create: `.codex/config.toml`

- [ ] **Step 1: Create `gemini-extension.json`**

```json
{
  "name": "daily-accomplishments",
  "description": "Log and review daily accomplishments via /da commands. Provides unambiguous access to daily-accomplishments MCP tools.",
  "version": "1.0.0",
  "contextFileName": "GEMINI.md"
}
```

- [ ] **Step 2: Create `GEMINI.md`**

```markdown
@./skills/da/SKILL.md
```

- [ ] **Step 3: Create `AGENTS.md`**

```markdown
@./skills/da/SKILL.md
```

- [ ] **Step 4: Create `.codex/config.toml`**

```toml
[features]
codex_hooks = true
---
@./skills/da/SKILL.md
```

- [ ] **Step 5: Verify all files exist**

```bash
ls gemini-extension.json GEMINI.md AGENTS.md .codex/config.toml
```

Expected: all four files listed with no errors.

- [ ] **Step 6: Commit**

```bash
git add gemini-extension.json GEMINI.md AGENTS.md .codex/
git commit -m "feat(plugin): add Gemini CLI and Codex cross-platform entry points"
```

---

### Task 6: Final validation

**Files:**
- No new files

- [ ] **Step 1: Validate plugin with Claude Code**

```bash
claude plugin validate .
```

Expected: no errors.

- [ ] **Step 2: Verify full file tree**

```bash
find .claude-plugin hooks skills/da -type f | sort
```

Expected output:
```
.claude-plugin/marketplace.json
.claude-plugin/plugin.json
hooks/da-mcp-register.sh
skills/da/SKILL.md
```

- [ ] **Step 3: Verify hook is executable**

```bash
ls -la hooks/da-mcp-register.sh
```

Expected: `-rwxr-xr-x` (executable bit set)

- [ ] **Step 4: Verify no existing files were modified**

```bash
git diff main -- install.sh install.bat server.py db.py web/
```

Expected: empty output (no changes to existing files).

- [ ] **Step 5: Commit plan doc**

```bash
git add docs/superpowers/plans/2026-04-16-da-skill-plugin.md
git commit -m "docs: add /da skill + plugin implementation plan"
```

---

### Task 7: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/da-skill-plugin
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat: /da skill + cross-platform plugin scaffolding" \
  --body "$(cat <<'EOF'
## Summary
- Adds `/da` skill with subcommands: `log`, `summary`, `review`, `search`
- Adds Claude Code plugin manifests (`.claude-plugin/`) with idempotent MCP registration hook
- Adds cross-platform entry points: Gemini CLI (`gemini-extension.json`, `GEMINI.md`), Codex (`AGENTS.md`, `.codex/config.toml`)
- Zero changes to existing files

## Test plan
- [ ] `claude plugin validate .` passes
- [ ] Hook exits 0 silently when MCP already registered
- [ ] `/da` shows today's entries + available commands hint
- [ ] `/da log` checks existing entries, infers from git, proposes before writing
- [ ] `/da summary` calls `get_summary` for current month
- [ ] `/da review` produces perf-review-framed narrative
- [ ] `/da search <query>` calls `search_accomplishments`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
