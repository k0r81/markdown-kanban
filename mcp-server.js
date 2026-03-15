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
        name: "kanban_list",
        description: "Get list of all tasks from kanban. Optionally filter by column or epic group.",
        inputSchema: {
          type: "object",
          properties: {
            col: {
              type: "string",
              enum: COLS,
              description: "Optionally filter by column"
            },
            epic: {
              type: "string",
              description: "Optionally filter by epic group"
            }
          }
        }
      },
      {
        name: "kanban_show",
        description: "Get detailed information about a specific task, including subtask list.",
        inputSchema: {
          type: "object",
          properties: {
            task_id: {
              type: "string",
              description: "Task ID (e.g. 'PI-014-google-calendar')"
            }
          },
          required: ["task_id"]
        }
      },
      {
        name: "kanban_add",
        description: "Create new task in kanban in specified column and optional epic group.",
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
              description: "Column to place task in"
            },
            epic: {
              type: "string",
              default: "—",
              description: "Epic group (optional)"
            }
          },
          required: ["title"]
        }
      },
      {
        name: "kanban_move",
        description: "Move existing task to different column.",
        inputSchema: {
          type: "object",
          properties: {
            task_id: {
              type: "string",
              description: "Task ID to move"
            },
            column: {
              type: "string",
              enum: COLS,
              description: "New column"
            }
          },
          required: ["task_id", "column"]
        }
      },
      {
        name: "kanban_toggle",
        description: "Toggle checkbox state for subtask (done/not done).",
        inputSchema: {
          type: "object",
          properties: {
            task_id: {
              type: "string",
              description: "Parent task ID"
            },
            idx: {
              type: "integer",
              description: "Subtask index (starting from 0)"
            }
          },
          required: ["task_id", "idx"]
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
      case "kanban_list": {
        const epics = await kanban.allEpics();
        
        let filtered = epics;
        if (args.col) {
          filtered = filtered.filter(e => e.column === args.col);
        }
        if (args.epic) {
          filtered = filtered.filter(e => e.epic_group === args.epic);
        }
        
        result = filtered;
        break;
      }
      
      case "kanban_show": {
        const filePath = await kanban.findFile(args.task_id);
        if (!filePath) {
          throw new Error(`Task not found: ${args.task_id}`);
        }
        
        const col = COLS.find(c => filePath.includes(c)) || "planned";
        result = await kanban.parseEpic(filePath, col);
        break;
      }
      
      case "kanban_add": {
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
      
      case "kanban_move": {
        const success = await kanban.doMove(args.task_id, args.column);
        if (!success) {
          throw new Error(`Failed to move task: ${args.task_id}`);
        }
        result = { success: true, message: `Moved ${args.task_id} to ${args.column}` };
        break;
      }
      
      case "kanban_toggle": {
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