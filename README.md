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

# Start web GUI at http://localhost:5500
kanban serve

# List all tasks
kanban list --json

# Add a task
kanban add "My task" --col planned --epic "Phase 1"

# Show details
kanban show PI-001

# Move between columns (active | planned | icebox | done)
kanban move PI-001 active

# Toggle subtask completion
kanban toggle PI-001 0
```

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
  "id": "PI-001-my-feature",
  "title": "My Feature",
  "column": "planned",
  "epic_group": "Phase 1",
  "created": "2026-07-08",
  "description": "High-level context.",
  "specs": "Technical details.",
  "acceptance_criteria": ["Works as expected"],
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

Or generate the config files automatically:

```bash
npx kanbango mcp-init
```

### What the agent can do

Once connected, your agent gets access to these tools:

| Tool | What it does |
|------|-------------|
| `kanban_read` | List tasks, filter by column/epic, show details |
| `kanban_create` | Add new tasks |
| `kanban_update` | Move, edit, toggle subtasks |
| `kanban_gui_start` | Start web GUI from the agent |
| `kanban_gui_stop` | Stop web GUI |
| `kanban_gui_status` | Check if GUI is running |

Your agent stays in sync with your real board — every change is persisted as JSON files.

## CLI Reference

| Command | Description |
|---------|-------------|
| `kanban init` | Create backlog directory structure |
| `kanban serve [PORT]` | Start web GUI (default 5500) |
| `kanban list [--col <col>] [--json]` | List tasks |
| `kanban show <ID>` | Show task details |
| `kanban add <TITLE>` | Add a new task |
| `kanban move <ID> <COL>` | Move task |
| `kanban toggle <ID> <IDX>` | Toggle subtask |
| `kanban mcp-init` | Generate MCP config files |

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
const tasks = await kanban.allEpics();
```

## Requirements

Node.js 16+

## License

MIT