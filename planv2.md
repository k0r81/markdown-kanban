# Plan V2

## Goal

Evolve `markdown-kanban` into an LLM-first task system with:

- rich task and subtask descriptions
- minimal token usage in MCP flows
- a minimal MCP surface area
- structured, actionable error messages
- partial reads so agents only fetch the task slices they need

## Core Decision

Use JSON as the canonical task storage format.

Reasoning:

- Markdown is human-friendly, but becomes fragile once tasks need nested rich fields.
- JSON is easier to validate, partially read, partially update, and return through MCP.
- Token savings will come primarily from response shaping in MCP, not from the on-disk format itself.

## Token Strategy

The main token optimization should happen in MCP responses, not by compressing field names or over-optimizing file syntax.

Avoid:

- always returning the full task
- adding many narrow MCP methods
- cryptic short keys like `sp`, `ac`, `d`

Prefer:

- one read tool with multiple views
- explicit field selection
- compact summary responses by default
- structured update responses with configurable return payloads

## Recommended Task Schema

```json
{
  "id": "014",
  "title": "Google Calendar Integration",
  "column": "active",
  "epic_group": "Phase 1",
  "created": "2026-07-07",
  "description": "High-level context and implementation plan in markdown.",
  "specs": "Technical constraints, APIs, data model, edge cases.",
  "in_scope": [
    "OAuth connect/disconnect",
    "Two-way event sync"
  ],
  "out_of_scope": [
    "Microsoft Calendar",
    "Mobile push notifications"
  ],
  "acceptance_criteria": [
    "User can connect Google account",
    "Events sync in both directions",
    "Sync conflicts are logged"
  ],
  "subtasks": [
    {
      "id": "st-1",
      "text": "Implement OAuth flow",
      "done": false,
      "description": "Use PKCE, store refresh token encrypted."
    }
  ],
  "notes": "Optional freeform notes"
}
```

## Field Semantics

- `description`: the main context, why the work exists, and the implementation plan
- `specs`: concrete technical facts, constraints, APIs, data shape, edge cases
- `in_scope`: what this task includes (boundaries)
- `out_of_scope`: explicit non-goals / exclusions
- `acceptance_criteria`: what must be true for the task to count as done
- `subtasks[].description`: local execution detail for a subtask
- `notes`: optional freeform leftovers, references, or observations

This split is useful for both humans and agents.

## MCP Surface

Keep the MCP surface at 3 tools:

- `kanban_read`
- `kanban_create`
- `kanban_update`

Do not add separate tools like:

- `kanban_read_specs`
- `kanban_read_ac`
- `kanban_read_subtasks`

That would increase surface area without meaningfully reducing tokens.

## kanban_read Design

Add support for response shaping.

### Option A: view presets

```json
{
  "operation": "show",
  "task_id": "014",
  "view": "planning"
}
```

Suggested views:

- `summary`: id, title, column, epic, created, progress counts
- `planning`: summary + description + specs + in_scope + out_of_scope + acceptance_criteria
- `execution`: planning + subtasks
- `full`: everything including notes and metadata

### Option B: explicit fields

```json
{
  "operation": "show",
  "task_id": "014",
  "fields": ["title", "description", "acceptance_criteria"]
}
```

Recommendation: support both.

- `view` is simple and ergonomic
- `fields` is precise for advanced agents

If both are supplied, `fields` should win.

## kanban_create Design

Allow rich fields during creation, but keep minimal creation possible.

Minimal create:

```json
{
  "title": "Add user authentication"
}
```

Full create:

```json
{
  "title": "Add user authentication",
  "col": "planned",
  "epic": "Auth",
  "description": "Implement auth flow and session model.",
  "specs": "Use OAuth + session cookies.",
  "acceptance_criteria": [
    "User can sign in",
    "Session persists after refresh"
  ],
  "subtasks": [
    {
      "text": "Create auth routes",
      "description": "Add login and callback handlers."
    }
  ],
  "notes": "Optional"
}
```

## kanban_update Design

Use a patch-like payload and let callers control the returned payload size.

```json
{
  "operation": "update",
  "task_id": "014",
  "patch": {
    "description": "Updated implementation plan...",
    "acceptance_criteria": [
      "OAuth works",
      "Tokens refresh correctly"
    ]
  },
  "return": "summary"
}
```

Suggested `return` values:

- `none`
- `summary`
- `full`

Default should be `summary`, not `full`.

This avoids sending large descriptions back after every small edit.

## Read Strategy For Agents

Agents should not always read the whole task.

Recommended workflows:

### Triage

Use `summary` only.

### Planning

Read:

- `description`
- `specs`
- `acceptance_criteria`

### Implementation

Read:

- planning fields
- subtasks

### Verification

Read:

- `acceptance_criteria`
- progress / status fields

### Backlog cleanup

Read:

- summary only

This is not a bad idea. It is the correct way to reduce token use while staying useful.

## Error Design

Errors should be structured JSON, not a plain string.

Recommended shape:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task 014 was not found",
    "hint": "Call kanban_read with operation=list to discover valid task ids",
    "details": {
      "task_id": "014"
    },
    "retryable": false
  }
}
```

Suggested error codes:

- `TASK_NOT_FOUND`
- `INVALID_COLUMN`
- `INVALID_SUBTASK_INDEX`
- `VALIDATION_ERROR`
- `MISSING_REQUIRED_FIELD`
- `TASK_CONFLICT`
- `PARSE_ERROR`

Good errors should help an agent recover without extra back-and-forth.

## Migration Strategy

Existing Markdown files are already persisted data, so backward compatibility matters during migration.

Recommended migration plan:

1. Add JSON schema support.
2. Support reading both `.md` and `.json` task files during transition.
3. Write new tasks as JSON.
4. Add an optional migration command later if needed.
5. Once the repo is clean and the migration is accepted, decide whether to keep Markdown read support permanently.

## Suggested Defaults

- Canonical storage: JSON
- MCP tools: keep exactly 3
- Default read view: `summary` for lists, `planning` or `summary` for show depending on client choice
- Default update return payload: `summary`
- Rich task fields: `description`, `specs`, `acceptance_criteria`, `notes`
- Rich subtask fields: `text`, `done`, `description`

## Non-Goals

Avoid for now:

- many specialized MCP methods
- abbreviated schema keys just to save a few tokens
- always rendering HTML for descriptions
- over-structuring subtasks with too many fields

## Next Implementation Steps

1. Define the JSON schema in code and docs.
2. Update `kanban.js` to read and write JSON tasks.
3. Add transitional support for reading existing Markdown tasks.
4. Extend `kanban_read` with `view` and `fields`.
5. Extend `kanban_create` and `kanban_update` with rich fields and `patch` semantics.
6. Add structured MCP error responses with codes and hints.
7. Update the web GUI to edit `description`, `specs`, `acceptance_criteria`, and subtask descriptions.
8. Add tests for partial reads, structured errors, and Markdown-to-JSON compatibility.
