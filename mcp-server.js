#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const kanban = require("./kanban.js");

const COLS = kanban.COLS;

const server = new Server(
  {
    name: "markdown-kanban",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "kanban_read",
        description: "Read tasks from kanban board. Can list all tasks, filter by column/epic, or get details of a specific task.",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["list", "show"],
              description: "Operation to perform: 'list' for all tasks (with optional filters), 'show' for specific task details",
              default: "list"
            },
            task_id: {
              type: "string",
              description: "Task ID (required for 'show' operation, e.g. 'PI-014-google-calendar')"
            },
            col: {
              type: "string",
              enum: COLS,
              description: "Optionally filter by column (active|planned|icebox|done) for 'list' operation"
            },
            epic: {
              type: "string",
              description: "Optionally filter by epic group name for 'list' operation"
            }
          }
        }
      },
      {
        name: "kanban_create",
        description: "Create a new task on the kanban board.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of new task"
            },
            col: {
              type: "string",
              enum: COLS,
              default: "planned",
              description: "Column to place task in (active|planned|icebox|done)"
            },
            epic: {
              type: "string",
              default: "—",
              description: "Epic group name (optional)"
            }
          },
          required: ["title"]
        }
      },
      {
        name: "kanban_update",
        description: "Update existing tasks on kanban board. Can move tasks between columns, toggle subtask completion, or update task details.",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["move", "toggle", "update"],
              description: "Operation to perform: 'move' to change column, 'toggle' to complete subtask, 'update' to change title/tasks"
            },
            task_id: {
              type: "string",
              description: "Task ID to update"
            },
            column: {
              type: "string",
              enum: COLS,
              description: "New column (required for 'move' operation)"
            },
            idx: {
              type: "integer",
              description: "Subtask index (required for 'toggle' operation, starting from 0)"
            },
            title: {
              type: "string",
              description: "New task title (optional for 'update' operation)"
            },
            tasks: {
              type: "array",
              description: "New subtask list (optional for 'update' operation)",
              items: {
                type: "object",
                properties: {
                  done: { type: "boolean" },
                  text: { type: "string" }
                }
              }
            }
          },
          required: ["operation", "task_id"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    let result;
    
    switch (name) {
      case "kanban_read": {
        const operation = args.operation || "list";
        
        if (operation === "list") {
          const epics = await kanban.allEpics();
          
          let filtered = epics;
          if (args.col) {
            filtered = filtered.filter(e => e.column === args.col);
          }
          if (args.epic) {
            filtered = filtered.filter(e => e.epic_group === args.epic);
          }
          
          result = filtered;
        } else if (operation === "show") {
          if (!args.task_id) {
            throw new Error("task_id is required for 'show' operation");
          }
          
          const filePath = await kanban.findFile(args.task_id);
          if (!filePath) {
            throw new Error(`Task not found: ${args.task_id}`);
          }
          
          const col = COLS.find(c => filePath.includes(c)) || "planned";
          result = await kanban.parseEpic(filePath, col);
        } else {
          throw new Error(`Unknown operation: ${operation}`);
        }
        break;
      }
      
      case "kanban_create": {
        result = await kanban.doCreate(
          args.title,
          args.col || "planned",
          args.epic || "—"
        );
        if (!result) {
          throw new Error("Failed to create task");
        }
        break;
      }
      
      case "kanban_update": {
        const operation = args.operation;
        
        if (operation === "move") {
          const success = await kanban.doMove(args.task_id, args.column);
          if (!success) {
            throw new Error(`Failed to move task: ${args.task_id}`);
          }
          result = { success: true, message: `Moved ${args.task_id} to ${args.column}` };
        } else if (operation === "toggle") {
          const success = await kanban.doToggle(args.task_id, args.idx);
          if (!success) {
            throw new Error(`Failed to toggle subtask: ${args.task_id}[${args.idx}]`);
          }
          
          const filePath = await kanban.findFile(args.task_id);
          if (filePath) {
            const col = COLS.find(c => filePath.includes(c)) || "planned";
            result = await kanban.parseEpic(filePath, col);
          } else {
            result = { success: true };
          }
        } else if (operation === "update") {
          const success = await kanban.doUpdate(
            args.task_id,
            args.title !== undefined ? args.title : null,
            args.tasks !== undefined ? args.tasks : null
          );
          if (!success) {
            throw new Error(`Failed to update task: ${args.task_id}`);
          }
          
          const filePath = await kanban.findFile(args.task_id);
          if (filePath) {
            const col = COLS.find(c => filePath.includes(c)) || "planned";
            result = await kanban.parseEpic(filePath, col);
          } else {
            result = { success: true };
          }
        } else {
          throw new Error(`Unknown operation: ${operation}`);
        }
        break;
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message })
        }
      ],
      isError: true
    };
  }
});

async function main() {
  await kanban.ensureBacklogDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("markdown-kanban MCP server running");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});