# MCP Server Guide for LLM Agents

Complete guide for integrating kanbango MCP server into LLM agents and AI assistants.

## Quick Integration

### Configuration

Add to your MCP client configuration:

**Claude Desktop:**
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

**General MCP:**
```json
{
  "mcpServers": {
    "kanbango": {
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
npx kanbango mcp-init

# Use npx-based command in configs
npx kanbango mcp-init --npx

# Only Claude Code config
npx kanbango mcp-init --claude

# Only OpenCode config
npx kanbango mcp-init --opencode
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

### 2. kanban_manage

Create, move, toggle subtasks, or patch-update kanban tasks. Single tool for all mutations.

**Actions:**
- `create` - Create a new task with optional rich planning fields
- `move` - Move a task to a different column
- `toggle` - Toggle a subtask's completion status
- `update` - Apply a field-level patch to any task attributes

**Parameters (create):**
```json
{
  "action": "create",
  "title": "New feature",  // Required
  "col": "planned",  // Optional, default "planned"
  "epic": "Phase 1",  // Optional, default "—"
  "description": "Context and plan",
  "specs": "Technical constraints",
  "acceptance_criteria": ["Must work"],
  "test_cases": ["Verify X"],
  "subtasks": [{"text": "Do it", "done": false}],
  "notes": "Freeform notes"
}
```

**Parameters (move):**
```json
{
  "action": "move",
  "task_id": "PI-014-google-calendar",  // Required
  "column": "done"  // Required: target column
}
```

**Parameters (toggle):**
```json
{
  "action": "toggle",
  "task_id": "PI-014-google-calendar",  // Required
  "idx": 0  // Required: zero-based subtask index
}
```

**Parameters (update):**
```json
{
  "action": "update",
  "task_id": "PI-014-google-calendar",  // Required
  "patch": {"description": "New context"},  // Field-level patch object
  "title": "New title",  // Shortcut, equivalent to patch.title
  "tasks": [{"text": "A", "done": true}],  // Shortcut, equivalent to patch.subtasks
  "return": "summary"  // "none" | "summary" | "full" (default "summary")
}
```

**Examples:**

Create a task:
```json
{
  "action": "create",
  "title": "Database optimization",
  "col": "planned",
  "epic": "Performance"
}
```

Move task to done:
```json
{
  "action": "move",
  "task_id": "PI-014-google-calendar",
  "column": "done"
}
```

Toggle first subtask:
```json
{
  "action": "toggle",
  "task_id": "PI-014-google-calendar",
  "idx": 0
}
```

Patch-update task fields:
```json
{
  "action": "update",
  "task_id": "PI-014-google-calendar",
  "patch": {
    "title": "Updated title",
    "description": "New implementation plan",
    "epic_group": "Phase 2"
  }
}
```

---

### 3. kanban_gui

Control the web GUI server: start, stop, or check status.

**Actions:**
- `start` - Launch the GUI server
- `stop` - Kill the GUI server
- `status` - Check if the GUI is running

**Parameters:**
```json
{
  "action": "start",  // "start" | "stop" | "status"
  "port": 5500  // Optional, only for "start" (default 5500)
}
```

**Examples:**

Start GUI on default port:
```json
{
  "action": "start"
}
```

Start GUI on custom port:
```json
{
  "action": "start",
  "port": 8080
}
```

Stop the GUI:
```json
{
  "action": "stop"
}
```

Check status:
```json
{
  "action": "status"
}
```

**Response (start):**
```json
{
  "status": "started",
  "port": 5500,
  "pid": 12345,
  "url": "http://localhost:5500"
}
```

**Response (stop):**
```json
{
  "status": "stopping",
  "port": 5500
}
```

**Response (status - running):**
```json
{
  "status": "running",
  "port": 5500,
  "pid": 12345,
  "url": "http://localhost:5500"
}
```

**Response (status - not running):**
```json
{
  "status": "not_running"
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
{ "tool": "kanban_read", "arguments": { "operation": "list", "col": "active" } }
```

### Pattern 2: Task Creation Workflow

```json
// 1. Create task
{ "tool": "kanban_manage", "arguments": { "action": "create", "title": "New feature", "col": "planned", "epic": "Phase 1" } }

// 2. Get task details to see generated ID
{ "tool": "kanban_read", "arguments": { "operation": "show", "task_id": "PI-015-new-feature" } }

// 3. Update with subtasks
{ "tool": "kanban_manage", "arguments": { "action": "update", "task_id": "PI-015-new-feature", "tasks": [{"done": false, "text": "Research"}, {"done": false, "text": "Implementation"}] } }
```

### Pattern 3: Task Progression

```json
// Move from planned → active
{ "tool": "kanban_manage", "arguments": { "action": "move", "task_id": "PI-015", "column": "active" } }

// Mark subtask complete
{ "tool": "kanban_manage", "arguments": { "action": "toggle", "task_id": "PI-015", "idx": 0 } }

// Move from active → done
{ "tool": "kanban_manage", "arguments": { "action": "move", "task_id": "PI-015", "column": "done" } }
```

### Pattern 4: Epic Management

```json
// List all tasks in an epic
{ "tool": "kanban_read", "arguments": { "operation": "list", "epic": "Performance" } }

// Create task in specific epic
{ "tool": "kanban_manage", "arguments": { "action": "create", "title": "Cache optimization", "epic": "Performance" } }
```

---

## Best Practices for LLM Agents

1. **Always use `kanban_read` first** - Discover existing tasks before creating new ones
2. **Numeric task lookup** - You can reference tasks by number alone (e.g. `"35"` for task `PI-035-whatever`). This works in any `task_id` parameter.
3. **Use `col` filter** - Narrow down to relevant column when listing
4. **Use `epic` grouping** - Organize tasks by features/phases
5. **Work through subtasks** - Toggle each subtask as you complete them
6. **Move tasks through workflow** - planned → active → done progression
7. **Use `show` operation** - Get full task details including subtasks
8. **Handle task IDs** - Always use the full task ID returned from create/show

---

## Error Handling

All tools return structured error responses:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task PI-999 was not found",
    "hint": "Call kanban_read with operation=list to discover valid task ids",
    "details": {},
    "retryable": false
  }
}
```

---

## Installation for Users

Tell users to run:

```bash
npm install -g kanbango
```

Then add to their MCP configuration using the examples above.

---

## Support

- GitHub: https://github.com/k0r81/kanbango
- Issues: https://github.com/k0r81/kanbango/issues
- Full docs: https://github.com/k0r81/kanbango#readme
