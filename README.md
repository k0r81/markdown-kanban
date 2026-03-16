# markdown-kanban

Markdown-based local Kanban board with web GUI, CLI, and MCP server (pure JavaScript).

## Features

- 📊 Local Kanban board stored in Markdown files
- 🎨 Modern web GUI with drag-and-drop interface
- 🖥️ Full CLI support for automation and CI/CD
- 🤖 AI-friendly API (JSON output)
- 📁 Four columns: Active, Planned, Icebox, Done
- ✅ Subtasks with progress tracking
- 🏷️ Epic grouping

## Installation

### Global (recommended)
```bash
npm install -g markdown-kanban
```

### Local (per project)
```bash
npm install -D markdown-kanban
```

### Using npx (no installation)
```bash
npx markdown-kanban --help
```

## Requirements

- Node.js 16+

## Quick Start

```bash
# Initialize backlog structure
kanban init

# Start web GUI (opens http://localhost:5500)
kanban serve

# List all tasks (JSON)
kanban list --json

# Add a new task
kanban add "New feature" --col planned --epic "Phase1"

# Show task details
kanban show PI-001

# Move task between columns
kanban move PI-001 active

# Toggle subtask
kanban toggle PI-001 0
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `kanban serve [PORT]` | Start web GUI (default: 5500) |
| `kanban init` | Initialize backlog structure |
| `kanban mcp-init` | Generate MCP config files for Claude Code / OpenCode |
| `kanban list` | List all tasks |
| `kanban show <ID>` | Show task details |
| `kanban add <TITLE>` | Add new task |
| `kanban move <ID> <COL>` | Move task to column |
| `kanban toggle <ID> <IDX>` | Toggle subtask |

## Columns

- `active` — In progress (max 1-2 tasks)
- `planned` — Planned for implementation
- `icebox` — Frozen / nice-to-have
- `done` — Completed

## Data Structure

Tasks are stored as Markdown files in `backlog/<column>/`:

```markdown
# PI-001: Feature Title

**Status:** planned
**Epic:** Phase1
**Created:** 2026-03-15

## Description
—

## Tasks
- [ ] First subtask
- [x] Second subtask (done)

## Notes
—
```

## AI Integration

The `kanban-cmd` command provides simplified JSON output for AI agents:

```bash
# For AI: always use JSON output
kanban-cmd list

# Filter by column
kanban-cmd list --col active

# Show task details
kanban-cmd show PI-001

# Add task (AI-friendly)
kanban-cmd add "New task" --col planned --epic "Phase 1"
```

### JSON Output Format

```json
[
  {
    "id": "PI-001",
    "title": "PI-001: Feature Title",
    "column": "planned",
    "epic_group": "Phase 1",
    "created": "2026-03-15",
    "tasks": [
      {
        "done": false,
        "text": "First subtask"
      },
      {
        "done": true,
        "text": "Second subtask (done)"
      }
    ]
  }
]
```

## Web GUI

Start the web interface:
```bash
kanban serve 5500
```

Features:
- Swimlanes grouped by epic
- Drag-and-drop between columns
- Inline editing
- Real-time subtask checkboxes
- Progress tracking

## Directory Structure

```
backlog/
├── active/    # Tasks in progress
├── planned/   # Planned tasks
├── icebox/    # Frozen tasks
└── done/      # Completed tasks
```

## API for AI Agents

See [API.md](API.md) for detailed API function definitions.

## MCP Server

This package includes a Model Context Protocol (MCP) server for integration with MCP-compatible clients.

### Using the MCP server

```bash
# Run the MCP server directly
npm run mcp

# Or using npx
npx markdown-kanban mcp
```

### MCP Configuration

For MCP clients, add this to your configuration:

```json
{
  "mcpServers": {
    "markdown-kanban": {
      "command": "npx",
      "args": ["markdown-kanban", "mcp"]
    }
  }
}
```

### MCP Per Project (Recommended)

Install locally in the project so each repo controls its own MCP version:

```bash
npm install -D markdown-kanban
```

Then point MCP to the local package:

```json
{
  "mcpServers": {
    "markdown-kanban": {
      "command": "node",
      "args": ["./node_modules/markdown-kanban/mcp-server.js"]
    }
  }
}
```

If you prefer `npx`, you can still use it, but versioning is less explicit:

```json
{
  "mcpServers": {
    "markdown-kanban": {
      "command": "npx",
      "args": ["markdown-kanban", "mcp"]
    }
  }
}
```

### MCP Project Automation (Claude Code + OpenCode)

Generate project configs automatically (creates `.mcp.json` and `opencode.json` in the current folder):

```bash
# Local install (recommended)
npx markdown-kanban mcp-init

# Use npx-based command in configs
npx markdown-kanban mcp-init --npx

# Only Claude Code config
npx markdown-kanban mcp-init --claude

# Only OpenCode config
npx markdown-kanban mcp-init --opencode

# Overwrite existing files
npx markdown-kanban mcp-init --force
```

### Available MCP Tools

- `kanban_read` - Read tasks (list all, filter, or get specific task details)
- `kanban_create` - Create a new task
- `kanban_update` - Update tasks (move, toggle subtask, or edit details)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build (if needed)
npm run build
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
