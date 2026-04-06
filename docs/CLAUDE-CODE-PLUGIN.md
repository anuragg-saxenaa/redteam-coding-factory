# Using RedTeam Coding Factory as a Claude Code Plugin

This guide explains how to install and use the RedTeam Coding Factory as an MCP (Model Context Protocol) plugin inside **Claude Code**, **Codex**, or any other MCP-compatible AI agent.

---

## What You Get

Once installed, the coding factory adds 4 tools directly into your Claude Code session:

| Tool | What it does |
|---|---|
| `run_issue_watcher` | Picks open GitHub issues, implements full fixes, and opens PRs — autonomously |
| `run_oss_discovery` | Searches trending GitHub repos, evaluates contribution fit, writes specs |
| `get_pr_log` | Shows a log of all PRs the factory has opened |
| `get_factory_status` | Current status of all streams and recent activity |

---

## Prerequisites

- **Node.js 20+** — `node --version`
- **GitHub CLI** installed and authenticated — `gh auth status`
- A **GitHub personal access token** with `repo` and `pull_requests` scopes
- Claude Code installed — `npm install -g @anthropic-ai/claude-code`

---

## Step 1 — Install the Package

**Option A: Global install (recommended)**

```bash
npm install -g redteam-coding-factory
```

Verify:

```bash
coding-factory-mcp --version
# or
npx redteam-coding-factory --version
```

**Option B: No install (use npx)**

No install needed — `npx` will download it on first use. Skip to Step 2.

---

## Step 2 — Get a GitHub Token

1. Go to https://github.com/settings/tokens/new
2. Select scopes: `repo`, `read:org` (optionally `workflow` if you want CI access)
3. Copy the token — you will need it in Step 3

---

## Step 3 — Add to Claude Code Config

The config file location depends on how you run Claude Code:

| Platform | Config file |
|---|---|
| Claude Desktop app (Mac) | `~/.claude/claude_desktop_config.json` |
| Claude Desktop app (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code CLI | `~/.claude/claude_desktop_config.json` |

Open (or create) the config file and add:

**With global install:**

```json
{
  "mcpServers": {
    "coding-factory": {
      "command": "coding-factory-mcp",
      "env": {
        "GITHUB_TOKEN": "ghp_YOUR_TOKEN_HERE",
        "FACTORY_WORKSPACE": "/Users/yourname/coding-factory-workspace"
      }
    }
  }
}
```

**With npx (no global install):**

```json
{
  "mcpServers": {
    "coding-factory": {
      "command": "npx",
      "args": ["redteam-coding-factory", "--mcp"],
      "env": {
        "GITHUB_TOKEN": "ghp_YOUR_TOKEN_HERE",
        "FACTORY_WORKSPACE": "/Users/yourname/coding-factory-workspace"
      }
    }
  }
}
```

> Replace `ghp_YOUR_TOKEN_HERE` with your GitHub token from Step 2.
> Replace `/Users/yourname/coding-factory-workspace` with any local folder — the factory will use it to store PR logs and state.

---

## Step 4 — Create the Workspace Folder

```bash
mkdir -p ~/coding-factory-workspace
```

---

## Step 5 — Restart Claude Code

Close and reopen Claude Code (or the Claude Desktop app). The `coding-factory` MCP server will appear in the tools list.

---

## Step 6 — Use It

In any Claude Code conversation, just ask:

```
Run the coding factory on spring-projects/spring-ai — pick an open issue and open a PR
```

or use a tool call directly:

```
Use run_issue_watcher on repo=spring-projects/spring-ai, max_prs=2
```

Claude Code will call the MCP tool, the factory will:
1. Clone the repo to your workspace
2. Pick a concrete open issue
3. Implement the full fix
4. Run the repo's tests
5. Open a PR with `gh pr create`

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | — | GitHub personal access token with `repo` scope |
| `FACTORY_WORKSPACE` | No | current directory | Folder for cloned repos, PR logs, and factory state |

---

## Tool Reference

### `run_issue_watcher`

Picks open GitHub issues, implements fixes, and opens PRs.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `repo` | string | Yes | — | GitHub repo in `org/name` format, e.g. `spring-projects/spring-ai` |
| `stream` | string | No | `auto` | Technology stream: `java-spring`, `typescript`, `python`, `mobile`, `auto` |
| `max_prs` | number | No | `2` | Max PRs to open in this run |
| `dry_run` | boolean | No | `false` | Implement but do not push or create PR |

**Stream auto-detection:**
- Repo name contains `spring`, `java`, `langchain4j`, `quarkus` → `java-spring`
- Contains `swift`, `ios`, `android`, `react-native` → `mobile`
- Contains `python`, `fastapi`, `langchain` → `python`
- Anything else → `typescript`

**Example:**

```
Use run_issue_watcher with repo=langchain4j/langchain4j, max_prs=1, dry_run=true
```

---

### `run_oss_discovery`

Searches trending GitHub repos and writes contribution specs.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `focus` | string | No | `java-ai` | Discovery focus: `java-ai`, `typescript`, `python`, `any` |
| `min_stars` | number | No | `5000` | Minimum repo star count |
| `output_file` | string | No | `./backlog.md` | Path to write discovered specs |

**`java-ai` focus targets:** Spring AI, LangChain4j, Quarkus, semantic-kernel-java (5k+ stars Java AI projects)

**Example:**

```
Use run_oss_discovery with focus=java-ai, min_stars=5000
```

---

### `get_pr_log`

Returns the log of PRs opened by the factory.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `last_n` | number | No | `20` | How many recent entries to return |

---

### `get_factory_status`

Returns current stream schedule and total PR count. No parameters.

---

## If Something Goes Wrong

**`coding-factory-mcp: command not found`**
→ Run `npm install -g redteam-coding-factory` again, or switch to the `npx` config.

**`Error: GITHUB_TOKEN not set`**
→ Check the `env` block in your config file. Make sure the token starts with `ghp_`.

**`Error: repo must be in org/name format`**
→ Use `spring-projects/spring-ai` not `https://github.com/spring-projects/spring-ai`.

**MCP server not appearing in Claude Code**
→ Restart Claude Code completely after editing the config file.

**PRs opened but CI failing**
→ Use `dry_run=true` first to verify the implementation without pushing. The factory's self-healing CI will auto-fix common CI failures on retry.

---

## Technology Streams

| Stream | Repos it handles | Build tool |
|---|---|---|
| `java-spring` | Spring AI, LangChain4j, Quarkus, any Java repo | Maven / Gradle |
| `typescript` | Node.js, ESM projects | npm / vitest |
| `python` | FastAPI, LangChain, any Python repo | pytest / pip |
| `mobile` | SwiftFormat, React Native, iOS, Android | swift / gradle |
| `auto` | Detects from repo name automatically | — |

---

## Adding New Streams (For Contributors)

To add a new stream (e.g. `rust`, `go`):

1. Add detection logic in `src/mcp-server.js` → `detectStream()` function
2. Add stream config in `src/redteam-factory.js`
3. Add build/test commands in `tasks.json`
4. Submit a PR — the factory will review it autonomously

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guide.

---

## Running Without Claude Code (Standalone)

You can also run the MCP server manually to test it:

```bash
# Start the server (stdio transport — used by Claude Code)
coding-factory-mcp

# Or with environment variables
GITHUB_TOKEN=ghp_... FACTORY_WORKSPACE=~/workspace coding-factory-mcp
```

---

*Part of [RedTeam Coding Factory](https://github.com/anuragg-saxenaa/redteam-coding-factory) · MIT License*
