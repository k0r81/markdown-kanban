#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { spawn } = require('child_process');
const path = require('path');
const kanban = require('./kanban.js');

const COLS = kanban.COLS;
const READ_VIEWS = Object.keys(kanban.VIEW_FIELDS);
let guiProcess = null;
let guiPort = null;

function normalizePort(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function serializeError(error) {
  return {
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
      hint: error.hint || 'Inspect the request payload and try again',
      details: error.details || {},
      retryable: Boolean(error.retryable)
    }
  };
}

function invalidRequest(message, hint, details) {
  return kanban.createKanbanError('VALIDATION_ERROR', message, hint, details, false, 400);
}

function normalizeReturnShape(returnShape) {
  if (returnShape === undefined) return 'summary';
  if (!['none', 'summary', 'full'].includes(returnShape)) {
    throw invalidRequest(
      `Unsupported return value: ${returnShape}`,
      'Use one of: none, summary, full',
      { return: returnShape }
    );
  }
  return returnShape;
}

function normalizeReadOptions(args, defaultView) {
  if (args.fields !== undefined) {
    if (!Array.isArray(args.fields) || args.fields.length === 0) {
      throw invalidRequest(
        'fields must be a non-empty array when provided',
        'Pass fields like ["title", "description"] or omit the field',
        { fields: args.fields }
      );
    }

    return { fields: args.fields };
  }

  const view = args.view || defaultView;
  if (!READ_VIEWS.includes(view)) {
    throw invalidRequest(
      `Unsupported view: ${view}`,
      `Use one of: ${READ_VIEWS.join(', ')}`,
      { view }
    );
  }

  return { view };
}

function formatTaskResult(task, returnShape) {
  if (returnShape === 'none') return { ok: true };
  return kanban.shapeTask(task, { view: returnShape === 'full' ? 'full' : 'summary' });
}

async function startGuiServer(port) {
  const desiredPort = normalizePort(port ?? 5500);
  if (!desiredPort) {
    throw invalidRequest('Invalid port', 'Use an integer between 1 and 65535', { port });
  }

  if (guiProcess && guiProcess.exitCode === null) {
    return {
      status: 'already_running',
      port: guiPort,
      url: `http://localhost:${guiPort}`
    };
  }

  await kanban.ensureBacklogDir();

  const scriptPath = path.join(__dirname, 'bin', 'kanban.js');
  guiProcess = spawn(process.execPath, [scriptPath, 'serve', String(desiredPort)], {
    stdio: 'ignore',
    windowsHide: true
  });
  guiPort = desiredPort;

  guiProcess.on('exit', () => {
    guiProcess = null;
    guiPort = null;
  });

  return {
    status: 'started',
    port: desiredPort,
    pid: guiProcess.pid,
    url: `http://localhost:${desiredPort}`
  };
}

function stopGuiServer() {
  if (!guiProcess || guiProcess.exitCode !== null) {
    guiProcess = null;
    guiPort = null;
    return { status: 'not_running' };
  }

  guiProcess.kill();
  return { status: 'stopping', port: guiPort };
}

function guiStatus() {
  if (!guiProcess || guiProcess.exitCode !== null) {
    return { status: 'not_running' };
  }
  return { status: 'running', port: guiPort, pid: guiProcess.pid, url: `http://localhost:${guiPort}` };
}

const server = new Server(
  {
    name: 'kanbango',
    version: '2.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'kanban_read',
        description: 'Read tasks from kanban board with compact views or explicit fields.',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['list', 'show'],
              description: "Operation to perform: 'list' for all tasks, 'show' for a specific task",
              default: 'list'
            },
            task_id: {
              type: 'string',
              description: "Task ID (required for 'show' operation, e.g. 'PI-014-google-calendar')"
            },
            col: {
              type: 'string',
              enum: COLS,
              description: 'Optional column filter for list'
            },
            epic: {
              type: 'string',
              description: 'Optional epic group filter for list'
            },
            view: {
              type: 'string',
              enum: READ_VIEWS,
              description: 'Preset response view. Defaults to summary.'
            },
            fields: {
              type: 'array',
              description: 'Explicit fields to return. When provided, fields override view.',
              items: { type: 'string' }
            }
          }
        }
      },
      {
        name: 'kanban_create',
        description: 'Create a new task on the kanban board with optional rich planning fields.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Title of new task'
            },
            col: {
              type: 'string',
              enum: COLS,
              default: 'planned',
              description: 'Column to place task in (active|planned|icebox|done)'
            },
            epic: {
              type: 'string',
              default: '—',
              description: 'Epic group name (optional)'
            },
            description: {
              type: 'string',
              description: 'High-level context and implementation plan'
            },
            specs: {
              type: 'string',
              description: 'Technical constraints, APIs, and edge cases'
            },
            acceptance_criteria: {
              type: 'array',
              description: 'What must be true for the task to be complete',
              items: { type: 'string' }
            },
            test_cases: {
              type: 'array',
              description: 'Test case scenarios verifying acceptance criteria',
              items: { type: 'string' }
            },
            subtasks: {
              type: 'array',
              description: 'Optional subtask list',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  text: { type: 'string' },
                  done: { type: 'boolean' },
                  description: { type: 'string' }
                }
              }
            },
            notes: {
              type: 'string',
              description: 'Optional freeform notes'
            }
          },
          required: ['title']
        }
      },
      {
        name: 'kanban_update',
        description: 'Move tasks, toggle subtasks, or apply patch-style updates with configurable response size.',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['move', 'toggle', 'update'],
              description: "'move' changes column, 'toggle' flips one subtask, 'update' applies a patch"
            },
            task_id: {
              type: 'string',
              description: 'Task ID to update'
            },
            column: {
              type: 'string',
              enum: COLS,
              description: "New column for 'move'"
            },
            idx: {
              type: 'integer',
              description: "Subtask index for 'toggle'"
            },
            patch: {
              type: 'object',
              description: "Patch payload for 'update'"
            },
            title: {
              type: 'string',
              description: 'Backward-compatible title update shortcut'
            },
            tasks: {
              type: 'array',
              description: 'Backward-compatible subtask update shortcut',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  done: { type: 'boolean' },
                  text: { type: 'string' },
                  description: { type: 'string' }
                }
              }
            },
            return: {
              type: 'string',
              enum: ['none', 'summary', 'full'],
              description: 'Returned payload size after update. Defaults to summary.'
            }
          },
          required: ['operation', 'task_id']
        }
      },
      {
        name: 'kanban_gui_start',
        description: 'Start the web GUI server for the kanban board.',
        inputSchema: {
          type: 'object',
          properties: {
            port: {
              type: 'integer',
              description: 'Port for the GUI server (default 5500)'
            }
          }
        }
      },
      {
        name: 'kanban_gui_stop',
        description: 'Stop the web GUI server if it is running.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'kanban_gui_status',
        description: 'Get status of the web GUI server.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result;

    switch (name) {
      case 'kanban_read': {
        const operation = args.operation || 'list';
        const readOptions = normalizeReadOptions(args, 'summary');

        if (operation === 'list') {
          let tasks = await kanban.allEpics();
          if (args.col) {
            tasks = tasks.filter((task) => task.column === args.col);
          }
          if (args.epic) {
            tasks = tasks.filter((task) => task.epic_group === args.epic);
          }

          result = tasks.map((task) => kanban.shapeTask(task, readOptions));
        } else if (operation === 'show') {
          if (!args.task_id) {
            throw invalidRequest(
              "task_id is required for 'show' operation",
              'Provide the task id you want to inspect',
              { operation }
            );
          }

          result = kanban.shapeTask(await kanban.getTask(args.task_id), readOptions);
        } else {
          throw invalidRequest(
            `Unknown operation: ${operation}`,
            'Use one of: list, show',
            { operation }
          );
        }
        break;
      }

      case 'kanban_create': {
        const created = await kanban.doCreate(args.title, args.col || 'planned', args.epic || '—', {
          description: args.description,
          specs: args.specs,
          acceptance_criteria: args.acceptance_criteria,
          subtasks: args.subtasks,
          notes: args.notes
        });
        result = kanban.shapeTask(created, { view: 'full' });
        break;
      }

      case 'kanban_update': {
        const operation = args.operation;
        const returnShape = normalizeReturnShape(args.return);

        if (operation === 'move') {
          if (!args.column) {
            throw invalidRequest(
              "column is required for 'move'",
              'Provide one target column',
              { operation }
            );
          }
          const updated = await kanban.updateTask(args.task_id, { column: args.column });
          result = formatTaskResult(updated, returnShape);
        } else if (operation === 'toggle') {
          if (!Number.isInteger(args.idx)) {
            throw invalidRequest(
              "idx is required for 'toggle'",
              'Provide a zero-based subtask index',
              { operation, idx: args.idx }
            );
          }
          const current = await kanban.getTask(args.task_id);
          if (args.idx < 0 || args.idx >= current.subtasks.length) {
            throw kanban.createKanbanError(
              'INVALID_SUBTASK_INDEX',
              `Subtask index ${args.idx} is not valid for task ${args.task_id}`,
              'Read the task first and use an index between 0 and subtasks.length - 1',
              { task_id: args.task_id, idx: args.idx, total_subtasks: current.subtasks.length },
              false,
              400
            );
          }

          const subtasks = current.subtasks.map((subtask, idx) => ({
            ...subtask,
            done: idx === args.idx ? !subtask.done : subtask.done
          }));
          const updated = await kanban.updateTask(args.task_id, { subtasks });
          result = formatTaskResult(updated, returnShape);
        } else if (operation === 'update') {
          const patch = args.patch ? { ...args.patch } : {};
          if (args.title !== undefined) patch.title = args.title;
          if (args.tasks !== undefined) patch.subtasks = args.tasks;
          const updated = await kanban.updateTask(args.task_id, patch);
          result = formatTaskResult(updated, returnShape);
        } else {
          throw invalidRequest(
            `Unknown operation: ${operation}`,
            'Use one of: move, toggle, update',
            { operation }
          );
        }
        break;
      }

      case 'kanban_gui_start': {
        result = await startGuiServer(args.port);
        break;
      }

      case 'kanban_gui_stop': {
        result = stopGuiServer();
        break;
      }

      case 'kanban_gui_status': {
        result = guiStatus();
        break;
      }

      default:
        throw invalidRequest(`Unknown tool: ${name}`, 'Call tools/list to discover available tools', { name });
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(serializeError(error), null, 2)
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
  console.error('kanbango MCP server running');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
