# /da Skill & Plugin Design

**Date:** 2026-04-16  
**Status:** Approved

## Problem

Triggering daily-accomplishments MCP tools via natural language ("Log", "Log session") is ambiguous — clashes with other MCP servers, hard to discover. Need a dedicated, unambiguous `/da` command namespace.

## Goals

- Unambiguous `/da` skill with subcommands: `log`, `summary`, `search`, `review`
- Cross-platform: Claude Code, Gemini CLI, Codex (Cursor/Windsurf optional)
- Single `claude plugin install` installs skill + registers MCP (Claude Code)
- Zero breakage of existing functionality — additive only

## Repo Structure Changes

New files only. No existing files modified.

```
daily-accomplishments/
├── .claude-plugin/
│   ├── plugin.json           # Claude Code: plugin identity + SessionStart MCP hook
│   └── marketplace.json      # Claude Code: makes repo self-contained marketplace
├── skills/
│   └── da/
│       └── SKILL.md          # Single skill file, all /da subcommands (platform-agnostic)
├── hooks/
│   └── da-mcp-register.sh   # Idempotent MCP registration script
├── gemini-extension.json     # Gemini CLI extension manifest
├── GEMINI.md                 # @./skills/da/SKILL.md
├── AGENTS.md                 # @./skills/da/SKILL.md (Codex)
└── .codex/
    └── config.toml           # [features] codex_hooks + @-ref to skill
```

`install.sh` and `install.bat` remain unchanged for direct/legacy installs.

## Plugin Manifests

### `.claude-plugin/plugin.json`

```json
{
  "name": "daily-accomplishments",
  "description": "Log and review daily accomplishments via /da commands",
  "author": { "name": "Rhanel Candia" },
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/da-mcp-register.sh\"",
        "timeout": 10,
        "statusMessage": "Registering daily-accomplishments MCP..."
      }]
    }]
  }
}
```

### `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "daily-accomplishments",
  "description": "Log and review daily accomplishments with Claude",
  "owner": { "name": "Rhanel Candia" },
  "plugins": [{
    "name": "daily-accomplishments",
    "description": "Log and review daily accomplishments via /da commands",
    "source": "./",
    "category": "productivity"
  }]
}
```

## MCP Registration Hook

`hooks/da-mcp-register.sh` behavior:
1. Check if MCP already registered: `claude mcp list | grep daily-accomplishments`
2. If found: exit 0 (idempotent)
3. If not found: run `pip install -e .` then `claude mcp add daily-accomplishments ...`

Claude Code only. Other platforms register MCP via their own mechanisms.

## Cross-Platform Skill Discovery

Skill content lives in one place: `skills/da/SKILL.md`. Platforms reference it:

| Platform | Entry Point | Mechanism |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` | Auto-discovers `skills/` directory |
| Gemini CLI | `gemini-extension.json` → `GEMINI.md` | `@./skills/da/SKILL.md` |
| Codex | `AGENTS.md` | `@./skills/da/SKILL.md` |
| Cursor (optional) | `.cursor/rules/da.mdc` | Inline or @-ref |
| Windsurf (optional) | `.windsurf/rules/da.md` | Inline or @-ref |

## Skill Behavior (`skills/da/SKILL.md`)

Triggered by: `/da`, `/da log`, `/da summary`, `/da search <query>`, `/da review`

### Argument Routing

**`/da` (bare)**
- Call `get_accomplishments` with today's timestamp
- Display entries formatted as list
- Show hint: available subcommands (log, summary, search, review)

**`/da log`**
- Call `get_accomplishments` for today (check existing, avoid duplicates)
- Read git log + git status + session context to infer work done
- Propose consolidated entry (one entry per distinct outcome, not per file/bug)
- Confirm with user → `log_accomplishment` or `update_accomplishment` existing entry
- Fall back to prompting if git context is sparse
- Populate `project` from git remote/folder name; use `context="side_project"` for this repo

**`/da summary [month]`**
- Call `get_summary` for current month (default) or specified month
- Present as structured narrative grouped by project
- Lead with what was delivered and why it matters

**`/da review [month]`**
- Call `get_summary` for current month (default) or specified month
- Present as performance-review-ready narrative grouped by project
- Same as summary but framed for perf review context

**`/da search <query>`**
- Call `search_accomplishments` with query string
- Display results

## Installation (Claude Code)

```bash
# From GitHub (once published)
claude plugin marketplace add <github-repo>
claude plugin install daily-accomplishments

# Local development
claude plugin marketplace add /path/to/daily-accomplishments
claude plugin install daily-accomplishments
```

## Non-Goals

- No changes to existing MCP tools or server behavior
- No changes to web dashboard
- No changes to `install.sh` / `install.bat`
- No Cursor/Windsurf support in initial implementation (optional later)
