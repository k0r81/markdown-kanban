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
  "task_id": "014",  // Required for "show"
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
  "task_id": "014"
}
```

**Response (list):**
```json
[
  {
    "id": "014",
    "title": "Google Calendar Integration",
    "column": "active",
    "epic_group": "Phase 1",
    "created": "2026-03-15",
    "subtasks": [
      { "done": true, "text": "API authentication" },
      { "done": false, "text": "Event synchronization" }
    ]
  }
]
```

**Response (show):**
```json
{
  "id": "014",
  "title": "Google Calendar Integration",
  "column": "active",
  "epic_group": "Phase 1",
  "created": "2026-03-15",
    "subtasks": [
      { "done": true, "text": "API authentication" },
      { "done": false, "text": "Event synchronization" }
    ]
}
```

---

### 2. kanban_manage

Create, move, or patch-update kanban tasks. Single tool for all mutations.

**Actions:**
- `create` - Create a new task with optional rich planning fields
- `move` - Move a task to a different column
- `update` - Apply a field-level patch to any task attributes

**Parameters (create):**
```json
{
  "action": "create",
  "title": "New feature",  // Required (only hard requirement)
  "col": "planned",  // Optional, default "planned"
  "epic": "Phase 1",  // Optional, default "—"
  "description": "Context and plan",  // Strongly recommended
  "specs": "Technical constraints",  // Strongly recommended
  "in_scope": ["What is included"],  // Strongly recommended
  "out_of_scope": ["What is excluded"],  // Strongly recommended
  "acceptance_criteria": ["Must work"],  // Strongly recommended
  "test_cases": ["Verify X"],  // Recommended
  "subtasks": [{"text": "Do it", "done": false}],
  "notes": "Freeform notes"
}
```

**Create field policy:** only `title` is hard-required (GUI/CLI quick-add stays usable). For agent work, always send the strongly recommended fields. If any are missing, create still succeeds and the response includes `warnings` + `missing_recommended`.

**Parameters (move):**
```json
{
  "action": "move",
  "task_id": "014",  // Required
  "column": "done"  // Required: target column
}
```

**Parameters (update):**
```json
{
  "action": "update",
  "task_id": "014",  // Required
  "patch": {"description": "New context"},  // Field-level patch object
  "title": "New title",  // Shortcut, equivalent to patch.title
  "subtasks": [{"text": "A", "done": true}],  // Preferred full subtask list
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
  "epic": "Performance",
  "description": "Reduce N+1 queries on board list",
  "specs": "Keep JSON storage; no new deps",
  "in_scope": ["list query path"],
  "out_of_scope": ["GUI redesign"],
  "acceptance_criteria": ["list stays correct under load"]
}
```

Move task to done:
```json
{
  "action": "move",
  "task_id": "014",
  "column": "done"
}
```

Patch-update task fields:
```json
{
  "action": "update",
  "task_id": "014",
  "patch": {
    "title": "Updated title",
    "description": "New implementation plan",
    "epic_group": "Phase 2",
    "subtasks": [
      { "id": "st-1", "text": "Research", "done": true },
      { "id": "st-2", "text": "Implementation", "done": false }
    ]
  }
}
```

---

### 3. kanban_gui

Control the web GUI server: start, stop, or check status.

**Ownership (important):**
- `stop` only sends SIGTERM to a GUI **spawned by this MCP process** (`owned: true`).
- If the GUI was started elsewhere (CLI `kanban serve`, another MCP), `stop` returns `external_running` and does **not** kill that PID.
- `status` distinguishes `running` (owned), `external_running` (discovered via port file), and `not_running`.

**Port resolution (start):**
1. Explicit `port` argument, if provided
2. Else `KANBANGO_GUI_PORT` env
3. Else stable hash of project cwd in range `5510–5999`

If the preferred port is busy, the server picks the next free port. Always trust the returned `url` / `port` (also written to `backlog/.kanbango-gui.json`).

**Auto-start with MCP:** set `KANBANGO_AUTO_GUI=1` in the MCP server env. GUI starts when MCP starts; use `status` to read the URL.

**Actions:**
- `start` - Launch the GUI server (or report already_running owned/external)
- `stop` - Stop only MCP-owned GUI
- `status` - Check GUI state

**Parameters:**
```json
{
  "action": "start",  // "start" | "stop" | "status"
  "port": 5821  // Optional, only for "start"
}
```

**Examples:**

Start GUI (stable project port):
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
  "owned": true,
  "port": 5623,
  "pid": 12345,
  "url": "http://localhost:5623"
}
```

**Response (stop - owned):**
```json
{
  "status": "stopping",
  "owned": true,
  "port": 5623,
  "pid": 12345
}
```

**Response (stop - external refused):**
```json
{
  "status": "external_running",
  "owned": false,
  "port": 5623,
  "pid": 12345,
  "url": "http://localhost:5623",
  "hint": "GUI was not started by this MCP process; stop refused."
}
```

**Response (status - running owned):**
```json
{
  "status": "running",
  "owned": true,
  "port": 5623,
  "pid": 12345,
  "url": "http://localhost:5623"
}
```

**Response (status - external):**
```json
{
  "status": "external_running",
  "owned": false,
  "port": 5623,
  "pid": 99999,
  "url": "http://localhost:5623"
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
  "id": "string",  // Numeric task identifier (e.g., "014")
  "title": "string",  // Task title, kept separate from the ID
  "column": "string",  // "active" | "planned" | "icebox" | "done"
  "epic_group": "string",  // Epic group name or "—"
  "created": "string",  // Creation date (YYYY-MM-DD)
  "description": "string",  // High-level context
  "specs": "string",  // Technical constraints
  "in_scope": ["string"],  // What this task includes
  "out_of_scope": ["string"],  // Explicit non-goals
  "acceptance_criteria": ["string"],
  "test_cases": ["string"],
  "notes": "string",
  "subtasks": [
    {
      "id": "string",
      "done": "boolean",
      "text": "string",
      "description": "string"
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
// 1. Create task with strongly recommended planning fields
{ "tool": "kanban_manage", "arguments": {
  "action": "create",
  "title": "New feature",
  "col": "planned",
  "epic": "Phase 1",
  "description": "Why this exists",
  "specs": "APIs and constraints",
  "in_scope": ["Core path"],
  "out_of_scope": ["Mobile"],
  "acceptance_criteria": ["npm test passes"]
} }

// 2. Get task details to see generated ID
{ "tool": "kanban_read", "arguments": { "operation": "show", "task_id": "015" } }

// 3. Update with subtasks
{ "tool": "kanban_manage", "arguments": { "action": "update", "task_id": "015", "subtasks": [{"done": false, "text": "Research"}, {"done": false, "text": "Implementation"}] } }
```

### Pattern 3: Task Progression

```json
// Move from planned → active
{ "tool": "kanban_manage", "arguments": { "action": "move", "task_id": "015", "column": "active" } }

// Update subtasks in one call
{ "tool": "kanban_manage", "arguments": { "action": "update", "task_id": "015", "subtasks": [{ "done": true, "text": "Research" }, { "done": false, "text": "Implementation" }] } }

// Move from active → done
{ "tool": "kanban_manage", "arguments": { "action": "move", "task_id": "015", "column": "done" } }
```

### Pattern 4: Epic Management

```json
// List all tasks in an epic
{ "tool": "kanban_read", "arguments": { "operation": "list", "epic": "Performance" } }

// Create task in specific epic (still include recommended fields)
{ "tool": "kanban_manage", "arguments": {
  "action": "create",
  "title": "Cache optimization",
  "epic": "Performance",
  "description": "Reduce repeated board reads",
  "specs": "In-memory cache with TTL",
  "in_scope": ["list endpoint"],
  "out_of_scope": ["distributed cache"],
  "acceptance_criteria": ["p95 list latency down"]
} }
```

---

## Best Practices for LLM Agents

1. **Always use `kanban_read` first** - Discover existing tasks before creating new ones
2. **Numeric task lookup** - Task IDs are zero-padded numbers (e.g. `"035"`). Unpadded numbers such as `"35"` also work in any `task_id` parameter.
3. **Use `col` filter** - Narrow down to relevant column when listing
4. **Use `epic` grouping** - Organize tasks by features/phases
5. **Create with planning fields** - Always include description, specs, in_scope, out_of_scope, acceptance_criteria; treat `warnings`/`missing_recommended` as a signal to fill gaps
6. **Work through subtasks** - Check/uncheck them via update as you complete them
7. **Move tasks through workflow** - planned → active → done progression
8. **Use `show` operation** - Get full task details including subtasks
9. **Handle task IDs** - Always use the full task ID returned from create/show

---

## Error Handling

All tools return structured error responses:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task 999 was not found",
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
