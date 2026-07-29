# Kanban API for AI Agents

Documentation for interacting with local Kanban system (kanban.py).

## Available Functions

```json
{
  "type": "function",
  "name": "kanban_list",
  "description": "Get list of all tasks from kanban. Optionally filter by column or epic group.",
  "parameters": {
    "type": "object",
    "properties": {
      "col": {
        "type": "string",
        "enum": ["active", "planned", "icebox", "done"],
        "description": "Optionally filter by column"
      },
      "epic": {
        "type": "string",
        "description": "Optionally filter by epic group"
      },
      "as_json": {
        "type": "boolean",
        "default": true,
        "description": "Return result as JSON"
      }
    },
    "additionalProperties": false
  }
}
```

```json
{
  "type": "function",
  "name": "kanban_show",
  "description": "Get detailed information about a specific task, including subtask list.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "Numeric task ID (e.g. '014')"
      }
    },
    "required": ["task_id"],
    "additionalProperties": false
  }
}
```

```json
{
  "type": "function",
  "name": "kanban_add",
  "description": "Create new task in kanban in specified column and optional epic group.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Title of new task"
      },
      "col": {
        "type": "string",
        "enum": ["active", "planned", "icebox", "done"],
        "default": "planned",
        "description": "Column to place task in"
      },
      "epic": {
        "type": "string",
        "default": "—",
        "description": "Epic group (optional)"
      }
    },
    "required": ["title"],
    "additionalProperties": false
  }
}
```

```json
{
  "type": "function",
  "name": "kanban_move",
  "description": "Move existing task to different column.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "Task ID to move"
      },
      "column": {
        "type": "string",
        "enum": ["active", "planned", "icebox", "done"],
        "description": "New column"
      }
    },
    "required": ["task_id", "column"],
    "additionalProperties": false
  }
}
```

```json
{
  "type": "function",
  "name": "kanban_update",
  "description": "Update task fields, including the full subtasks list.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "Parent task ID"
      },
      "subtasks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "text": { "type": "string" },
            "done": { "type": "boolean" },
            "description": { "type": "string" }
          }
        }
      }
    },
    "required": ["task_id", "subtasks"],
    "additionalProperties": false
  }
}
```

## Usage Examples

```bash
# List all tasks (JSON)
python kanban.py list --json

# List only active tasks
python kanban.py list --col active --json

# Show task details
python kanban.py show 014

# Add new task
python kanban.py add "New function" --col planned --epic "Faza 6"

# Move task to different column
python kanban.py move 014 active

# Update subtasks
python kanban.py update 014 '{"subtasks":[{"done":true,"text":"Research"},{"done":false,"text":"Implementation"}]}'
```

## Kanban Columns

- `active` - in progress (max 1-2 tasks)
- `planned` - planned for implementation
- `icebox` - frozen / nice-to-have
- `done` - completed

## Data Models

### Task
```json
{
  "id": "string",
  "title": "string",
  "column": "active|planned|icebox|done",
  "epic_group": "string",
  "created": "string",
  "subtasks": [
    {
      "done": "boolean",
      "text": "string"
    }
  ]
}
```
