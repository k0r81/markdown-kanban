# MCP Server Guide for LLM Agents

Complete guide for integrating markdown-kanban MCP server into LLM agents and AI assistants.

## Quick Integration

### Configuration

Add to your MCP client configuration:

**Claude Desktop:**
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

**General MCP:**
```json
{
  "mcpServers": {
    "markdown-kanban": {
      "command": "node",
      "args": ["path/to/mcp-server.js"]
    }
  }
}
```

### Project Automation (Claude Code + OpenCode)

Generate project configs automatically in the current folder:

```bash
# Local install (recommended)
npx markdown-kanban mcp-init

# Use npx-based command in configs
npx markdown-kanban mcp-init --npx

# Only Claude Code config
npx markdown-kanban mcp-init --claude

# Only OpenCode config
npx markdown-kanban mcp-init --opencode
```

This creates:
- `.mcp.json` for Claude Code (project-scoped MCP servers)
- `opencode.json` for OpenCode (project-scoped MCP servers)

## Available Tools

### 1. kanban_read

Read tasks from kanban board. Can list all tasks, filter by column/epic, or get details of a specific task.

**Operations:**
- `list` - Get all tasks (with optional filters)
- `show` - Get specific task details

**Parameters:**
```json
{
  "operation": "list",  // "list" or "show"
  "task_id": "PI-014-google-calendar",  // Required for "show"
  "col": "planned",  // Optional: "active" | "planned" | "icebox" | "done"
  "epic": "Phase 1"  // Optional: filter by epic group
}
```

**Examples:**

List all tasks:
```json
{
  "operation": "list"
}
```

List tasks in active column:
```json
{
  "operation": "list",
  "col": "active"
}
```

Get specific task details:
```json
{
  "operation": "show",
  "task_id": "PI-014-google-calendar"
}
```

**Response (list):**
```json
[
  {
    "id": "PI-014-google-calendar",
    "title": "PI-014: Google Calendar Integration",
    "column": "active",
    "epic_group": "Phase 1",
    "created": "2026-03-15",
    "tasks": [
      { "done": true, "text": "API authentication" },
      { "done": false, "text": "Event synchronization" }
    ]
  }
]
```

**Response (show):**
```json
{
  "id": "PI-014-google-calendar",
  "title": "PI-014: Google Calendar Integration",
  "column": "active",
  "epic_group": "Phase 1",
  "created": "2026-03-15",
  "tasks": [
    { "done": true, "text": "API authentication" },
    { "done": false, "text": "Event synchronization" }
  ]
}
```

---

### 2. kanban_create

Create a new task on kanban board.

**Parameters:**
```json
{
  "title": "New feature implementation",  // Required
  "col": "planned",  // Optional: "active" | "planned" | "icebox" | "done" (default: "planned")
  "epic": "Phase 1"  // Optional: epic group name (default: "—")
}
```

**Examples:**

Create task with defaults:
```json
{
  "title": "Add user authentication"
}
```

Create task with custom column and epic:
```json
{
  "title": "Database optimization",
  "col": "planned",
  "epic": "Performance"
}
```

**Response:**
```json
{
  "id": "PI-015-database-optimization",
  "title": "PI-015: Database optimization",
  "column": "planned",
  "epic_group": "Performance",
  "created": "2026-03-16",
  "tasks": []
}
```

---

### 3. kanban_update

Update existing tasks on kanban board. Can move tasks between columns, toggle subtask completion, or update task details.

**Operations:**
- `move` - Move task to different column
- `toggle` - Toggle subtask completion
- `update` - Update task title and/or subtask list

**Parameters:**
```json
{
  "operation": "move",  // "move" | "toggle" | "update"
  "task_id": "PI-014-google-calendar",  // Required
  "column": "done",  // Required for "move"
  "idx": 0,  // Required for "toggle"
  "title": "Updated title",  // Optional for "update"
  "tasks": [  // Optional for "update"
    { "done": true, "text": "Task 1" },
    { "done": false, "text": "Task 2" }
  ]
}
```

**Examples:**

Move task to done:
```json
{
  "operation": "move",
  "task_id": "PI-014-google-calendar",
  "column": "done"
}
```

Toggle first subtask:
```json
{
  "operation": "toggle",
  "task_id": "PI-014-google-calendar",
  "idx": 0
}
```

Update task title:
```json
{
  "operation": "update",
  "task_id": "PI-014-google-calendar",
  "title": "Google Calendar API Integration"
}
```

Update subtasks:
```json
{
  "operation": "update",
  "task_id": "PI-014-google-calendar",
  "tasks": [
    { "done": true, "text": "API authentication" },
    { "done": true, "text": "Event synchronization" },
    { "done": false, "text": "Error handling" }
  ]
}
```

**Response (move):**
```json
{
  "success": true,
  "message": "Moved PI-014-google-calendar to done"
}
```

**Response (toggle/update):**
```json
{
  "id": "PI-014-google-calendar",
  "title": "PI-014: Google Calendar Integration",
  "column": "active",
  "epic_group": "Phase 1",
  "created": "2026-03-15",
  "tasks": [
    { "done": false, "text": "API authentication" },
    { "done": false, "text": "Event synchronization" }
  ]
}
```

---

## Data Structure

### Task Object

```json
{
  "id": "string",  // Unique task identifier (e.g., "PI-014-google-calendar")
  "title": "string",  // Full title with ID prefix
  "column": "string",  // "active" | "planned" | "icebox" | "done"
  "epic_group": "string",  // Epic group name or "—"
  "created": "string",  // Creation date (YYYY-MM-DD)
  "tasks": [
    {
      "done": "boolean",  // Subtask completion status
      "text": "string"  // Subtask description
    }
  ]
}
```

### Columns

- `active` - In progress (max 1-2 tasks recommended)
- `planned` - Planned for implementation
- `icebox` - Frozen / nice-to-have
- `done` - Completed

---

## Usage Patterns

### Pattern 1: Task Discovery

```json
// List all active tasks
{ "operation": "list", "col": "active" }
```

### Pattern 2: Task Creation Workflow

```json
// 1. Create task
{ "title": "New feature", "col": "planned", "epic": "Phase 1" }

// 2. Get task details to see generated ID
{ "operation": "show", "task_id": "PI-015-new-feature" }

// 3. Update with subtasks
{
  "operation": "update",
  "task_id": "PI-015-new-feature",
  "tasks": [
    { "done": false, "text": "Research" },
    { "done": false, "text": "Implementation" }
  ]
}
```

### Pattern 3: Task Progression

```json
// Move from planned → active
{ "operation": "move", "task_id": "PI-015", "column": "active" }

// Mark subtask complete
{ "operation": "toggle", "task_id": "PI-015", "idx": 0 }

// Move from active → done
{ "operation": "move", "task_id": "PI-015", "column": "done" }
```

### Pattern 4: Epic Management

```json
// List all tasks in an epic
{ "operation": "list", "epic": "Performance" }

// Create task in specific epic
{ "title": "Cache optimization", "epic": "Performance" }
```

---

## Best Practices for LLM Agents

1. **Always use `kanban_read` first** - Discover existing tasks before creating new ones
2. **Use `col` filter** - Narrow down to relevant column when listing
3. **Use `epic` grouping** - Organize tasks by features/phases
4. **Work through subtasks** - Toggle each subtask as you complete them
5. **Move tasks through workflow** - planned → active → done progression
6. **Use `show` operation** - Get full task details including subtasks
7. **Handle task IDs** - Always use the full task ID returned from create/show

---

## Error Handling

All tools return error messages in this format:

```json
{
  "error": "Error message description"
}
```

Common errors:
- `"Task not found: PI-999"` - Task ID doesn't exist
- `"Failed to move task: PI-999"` - Move operation failed
- `"task_id is required for 'show' operation"` - Missing required parameter

---

## Installation for Users

Tell users to run:

```bash
npm install -g markdown-kanban
```

Then add to their MCP configuration using the examples above.

---

## Support

- GitHub: https://github.com/k0r81/markdown-kanban
- Issues: https://github.com/k0r81/markdown-kanban/issues
- Full docs: https://github.com/k0r81/markdown-kanban#readme
