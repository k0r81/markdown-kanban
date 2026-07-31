# kanbango

JSON-first local Kanban board for developers and AI agents — CLI, web GUI, and MCP server in one lightweight package.

## Installation

### Global (recommended for CLI)
```bash
npm install -g kanbango
```

### Local per project (recommended for MCP)
```bash
npm install -D kanbango
```

### No install
```bash
npx kanbango --help
```

## Quick Start

```bash
# Initialize backlog directories
kanban init

# Start web GUI (stable project port; prints the real URL)
kanban serve

# List all tasks
kanban list --json

# Add an epic (initiative container), then a task under it
kanban epic add "Phase 1" --description "Why this initiative" --goals "Ship X"
kanban add "My task" --col planned --epic E001

# List epics / show epic with child rollup (default: live only)
kanban epic list --json
kanban epic list --all --json
kanban epic show E001

# Archive or delete (epic_delete cascades child tasks)
kanban epic archive E001
kanban epic unarchive E001
kanban epic rm E001
kanban rm 001

# Show details
kanban show 001

# Move between columns (active | planned | icebox | done)
kanban move 001 active

# Update subtasks in one call
kanban update 001 '{"subtasks":[{"done":true,"text":"Research"},{"done":false,"text":"Implementation"}]}'
```

### Hierarchy

| Level | What | Storage |
|-------|------|---------|
| **Epic** | Initiative context (description, goals) | `backlog/epics/E001.json` |
| **Task** | Kanban card (column, AC, plan) | `backlog/{col}/001.json` |
| **Subtask** | Checklist / plan steps | `subtasks[]` on task |

Epic status is **derived** from child task columns (not a board column).

### Columns

| Column | Purpose |
|--------|---------|
| `active` | In progress (keep to 1–2 tasks) |
| `planned` | Ready to implement |
| `icebox` | Nice-to-have / frozen |
| `done` | Completed |

## Data Structure

Tasks are JSON files in `backlog/<column>/`:

```json
{
  "id": "001",
  "title": "My Feature",
  "column": "planned",
  "epic_group": "Phase 1",
  "created": "2026-07-08",
  "description": "High-level context.",
  "specs": "Technical details.",
  "in_scope": ["What this task covers"],
  "out_of_scope": ["What is explicitly excluded"],
  "acceptance_criteria": ["Works as expected"],
  "test_cases": ["Verify the happy path"],
  "subtasks": [
    { "id": "st-1", "text": "First step", "done": false }
  ]
}
```

## MCP Server (for Claude Code, OpenCode, Cursor)

Run the MCP server to let AI agents read / create / update your board:

```bash
npx kanbango mcp
```

### Give it to your agent

Add this to your MCP client config (`.mcp.json`, `opencode.json`, or Claude Desktop config):

```json
{
  "mcpServers": {
    "kanbango": {
      "command": "npx",
      "args": ["kanbango", "mcp"]
    }
  }
}
```

Auto-start the web GUI with MCP (opt-in):

```json
{
  "mcpServers": {
    "kanbango": {
      "command": "npx",
      "args": ["kanbango", "mcp"],
      "env": {
        "KANBANGO_AUTO_GUI": "1"
      }
    }
  }
}
```

Optional: pin the port with `KANBANGO_GUI_PORT` (e.g. `"5821"`). Without it, each project gets a stable port in `5510–5999` derived from the project path. The real URL is always available via `kanban_gui` → `status` (and written to `backlog/.kanbango-gui.json` while the GUI runs). The browser tab title, GUI header, and `kanban_gui` responses include `project` (folder name of the project cwd; override with `KANBANGO_PROJECT_NAME`).

Or generate the config files automatically:

```bash
npx kanbango mcp-init
```

### What the agent can do

Once connected, your agent gets access to these tools:

| Tool | What it does |
|------|-------------|
| `kanban_read` | List/show tasks (`view=summary` by default — cheap) |
| `kanban_manage` | Create, move, update, plan_* workflow |
| `kanban_gui` | Start / status / stop (stop only kills GUI this MCP started) |

**Token tip for agents:** rules ship inside MCP tool descriptions (`agent-playbook.js`). Optional: `kanban_read` → `operation: "help"`. Human setup notes: [LLM_AGENTS.md](./LLM_AGENTS.md).

Your agent stays in sync with your real board — every change is persisted as JSON files.

## CLI Reference

| Command | Description |
|---------|-------------|
| `kanban init` | Create backlog directory structure |
| `kanban serve [PORT]` | Start web GUI (stable project port, or PORT / KANBANGO_GUI_PORT) |
| `kanban list [--col <col>] [--json]` | List tasks |
| `kanban show <ID>` | Show task details |
| `kanban add <TITLE>` | Add a new task |
| `kanban move <ID> <COL>` | Move task |
| `kanban mcp-init` | Generate MCP config files |
| `kanban plan <action> --json '{...}'` | Accepted-plan workflow (create/advance/evidence/done/status) |

## Web GUI

```bash
kanban serve
```
- Swimlanes grouped by epic
- Drag-and-drop between columns
- Inline editing and subtask checkboxes

## Using as a Node.js module

```js
const kanban = require('kanbango');
const tasks = await kanban.allTasks();
```

## Requirements

Node.js 16+

## License

MIT
