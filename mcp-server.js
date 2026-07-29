#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { spawn } = require('child_process');
const path = require('path');
const pkg = require('./package.json');
const kanban = require('./kanban.js');
const plan = require('./plan.js');
const guiRegistry = require('./gui-registry.js');
const playbook = require('./agent-playbook.js');

const COLS = kanban.COLS;
const READ_VIEWS = Object.keys(kanban.VIEW_FIELDS);
const GUI_READY_TIMEOUT_MS = 8000;
const GUI_READY_POLL_MS = 50;
let guiProcess = null;
let guiPort = null;

function normalizePort(value) {
  return guiRegistry.normalizeGuiPort(value);
}

function ownsGuiProcess() {
  return Boolean(guiProcess && guiProcess.exitCode === null);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envFlagEnabled(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

async function waitForGuiReady(pid, timeoutMs = GUI_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (guiProcess && guiProcess.pid === pid && guiProcess.exitCode !== null) {
      throw invalidRequest(
        'GUI process exited before becoming ready',
        'Check whether another process holds the port or inspect MCP stderr',
        { pid }
      );
    }

    const info = await guiRegistry.discoverRunningGui();
    if (info && info.pid === pid) return info;

    await sleep(GUI_READY_POLL_MS);
  }

  throw invalidRequest(
    'Timed out waiting for GUI to publish its port',
    'Retry kanban_gui start or set KANBANGO_GUI_PORT to a free port',
    { pid, timeout_ms: timeoutMs }
  );
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

function serializeResult(result) {
  if (typeof result === 'string') return result;

  const text = JSON.stringify(result, null, 2);
  if (typeof text === 'string') return text;

  throw kanban.createKanbanError(
    'INTERNAL_ERROR',
    'Tool completed without a response payload',
    'This is a server bug. Inspect the MCP handler for the requested tool/action.',
    { result_type: typeof result },
    true,
    500
  );
}

function textResponse(result, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: serializeResult(result)
      }
    ],
    ...(isError ? { isError: true } : {})
  };
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
  if (port !== undefined && port !== null && port !== '' && !normalizePort(port)) {
    throw invalidRequest('Invalid port', 'Use an integer between 1 and 65535', { port });
  }

  if (ownsGuiProcess() && guiPort) {
    return {
      status: 'already_running',
      owned: true,
      port: guiPort,
      pid: guiProcess.pid,
      url: `http://localhost:${guiPort}`
    };
  }

  const existing = await guiRegistry.discoverRunningGui();
  if (existing) {
    return {
      status: 'already_running',
      owned: false,
      port: existing.port,
      pid: existing.pid,
      url: existing.url
    };
  }

  const desiredPort = guiRegistry.resolvePreferredGuiPort(port);
  await kanban.ensureBacklogDir();

  const scriptPath = path.join(__dirname, 'bin', 'kanban.js');
  guiProcess = spawn(process.execPath, [scriptPath, 'serve', String(desiredPort)], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true,
    detached: false
  });

  const childPid = guiProcess.pid;
  guiProcess.on('exit', () => {
    if (guiProcess && guiProcess.pid === childPid) {
      guiProcess = null;
      guiPort = null;
    }
  });

  const ready = await waitForGuiReady(childPid);
  guiPort = ready.port;

  return {
    status: 'started',
    owned: true,
    port: ready.port,
    pid: ready.pid,
    url: ready.url
  };
}

async function stopGuiServer() {
  if (ownsGuiProcess()) {
    const port = guiPort;
    const pid = guiProcess.pid;
    guiProcess.kill();

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const still = await guiRegistry.discoverRunningGui();
      if (!still || still.pid !== pid) break;
      await sleep(50);
    }

    await guiRegistry.clearGuiPortFile({ force: true });
    guiProcess = null;
    guiPort = null;
    return { status: 'stopping', owned: true, port, pid };
  }

  guiProcess = null;
  guiPort = null;

  const discovered = await guiRegistry.discoverRunningGui();
  if (!discovered) {
    return { status: 'not_running' };
  }

  return {
    status: 'external_running',
    owned: false,
    port: discovered.port,
    pid: discovered.pid,
    url: discovered.url,
    hint: 'GUI was not started by this MCP process; stop refused. Stop it from the owning terminal or kill that PID manually.'
  };
}

async function guiStatus() {
  if (ownsGuiProcess() && guiPort) {
    return {
      status: 'running',
      owned: true,
      port: guiPort,
      pid: guiProcess.pid,
      url: `http://localhost:${guiPort}`
    };
  }

  guiProcess = null;
  guiPort = null;

  const discovered = await guiRegistry.discoverRunningGui();
  if (!discovered) {
    return { status: 'not_running' };
  }

  return {
    status: 'external_running',
    owned: false,
    port: discovered.port,
    pid: discovered.pid,
    url: discovered.url,
    cwd: discovered.cwd,
    started_at: discovered.started_at
  };
}

const server = new Server(
  {
    name: 'kanbango',
    version: pkg.version
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
        description: playbook.TOOL_DESCRIPTIONS.kanban_read,
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['list', 'show', 'help'],
              description: 'list=scan board; show=one task (needs task_id); help=token playbook (no board I/O)',
              default: 'list'
            },
            task_id: {
              type: 'string',
              description: "Required for show. Numeric id: '014' or '14'."
            },
            col: {
              type: 'string',
              enum: COLS,
              description: 'Filter list by column (saves tokens — prefer this)'
            },
            epic: {
              type: 'string',
              description: 'Filter list by epic group'
            },
            view: {
              type: 'string',
              enum: READ_VIEWS,
              description: 'summary=board scan (default); planning=scope/AC; execution=+subtasks; full=everything. Prefer smallest that works.'
            },
            fields: {
              type: 'array',
              description: 'Exact fields only (overrides view). Use when you need 1–2 fields.',
              items: { type: 'string' }
            }
          },
          additionalProperties: false
        }
      },
      {
        name: 'kanban_manage',
        description: playbook.TOOL_DESCRIPTIONS.kanban_manage,
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'move', 'update', 'plan_create', 'plan_advance', 'plan_evidence', 'plan_done', 'plan_status'],
              description: 'create|move|update daily; plan_* only for accepted multi-step work with tests'
            },
            title: {
              type: 'string',
              description: 'Required for create and plan_create'
            },
            col: {
              type: 'string',
              enum: COLS,
              default: 'planned',
              description: 'create column, or update shortcut for column'
            },
            epic: {
              type: 'string',
              default: '—',
              description: 'Epic group (create/update/plan_create)'
            },
            description: {
              type: 'string',
              description: 'Why/context (recommended on create)'
            },
            specs: {
              type: 'string',
              description: 'Technical constraints (recommended on create)'
            },
            in_scope: {
              type: 'array',
              description: 'In-scope bullets (recommended on create)',
              items: { type: 'string' }
            },
            out_of_scope: {
              type: 'array',
              description: 'Out-of-scope bullets (recommended on create)',
              items: { type: 'string' }
            },
            acceptance_criteria: {
              type: 'array',
              description: 'Done criteria (recommended on create)',
              items: { type: 'string' }
            },
            test_cases: {
              type: 'array',
              description: 'Verification scenarios',
              items: { type: 'string' }
            },
            subtasks: {
              type: 'array',
              description: 'Full subtask list replace on update (send complete array, not a single toggle)',
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
              description: 'Freeform notes'
            },
            task_id: {
              type: 'string',
              description: "Required for move/update/plan_* except plan_create. '014' or '14'."
            },
            column: {
              type: 'string',
              enum: COLS,
              description: 'Target column for move (not col)'
            },
            patch: {
              type: 'object',
              description: 'Bulk update object; merged with top-level field shortcuts'
            },
            return: {
              type: 'string',
              enum: ['none', 'summary', 'full'],
              description: 'move/update response size. Prefer none. Default summary. create always returns full task once.'
            },
            index: {
              type: 'integer',
              description: 'plan_advance: subtask index; omit = first incomplete'
            },
            steps: {
              type: 'array',
              items: { type: 'string' },
              description: 'plan_create: implementation steps between red/green test steps'
            },
            project_root: {
              type: 'string',
              description: 'plan_create: root for test-runner detect (default cwd)'
            },
            diff: {
              type: 'string',
              description: 'plan_evidence: short diff or summary (not whole repo)'
            },
            test_command: {
              type: 'string',
              description: 'plan_evidence: exact command run'
            },
            stdout: {
              type: 'string',
              description: 'plan_evidence: test stdout (truncate to last ~2KB if huge)'
            },
            stderr: {
              type: 'string',
              description: 'plan_evidence: test stderr (truncate if huge)'
            },
            exit_code: {
              type: 'integer',
              description: 'plan_evidence: process exit code'
            }
          },
          required: ['action'],
          additionalProperties: false
        }
      },
      {
        name: 'kanban_gui',
        description: playbook.TOOL_DESCRIPTIONS.kanban_gui,
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['start', 'stop', 'status'],
              description: 'start | stop (owned only) | status'
            },
            port: {
              type: 'integer',
              description: 'Optional start port; else KANBANGO_GUI_PORT or stable 5510-5999'
            }
          },
          required: ['action'],
          additionalProperties: false
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

        if (operation === 'help') {
          result = playbook.playbookHelpPayload();
          break;
        }

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
            'Use one of: list, show, help',
            { operation }
          );
        }
        break;
      }

      case 'kanban_manage': {
        const action = args.action;
        const returnShape = normalizeReturnShape(args.return);

        switch (action) {
          case 'create': {
            const createPayload = {
              description: args.description,
              specs: args.specs,
              in_scope: args.in_scope,
              out_of_scope: args.out_of_scope,
              acceptance_criteria: args.acceptance_criteria,
              test_cases: args.test_cases,
              subtasks: args.subtasks,
              notes: args.notes
            };
            const created = await kanban.doCreate(args.title, args.col || 'planned', args.epic || '—', createPayload);
            const shaped = kanban.shapeTask(created, { view: 'full' });
            const warnings = kanban.createFieldWarnings(createPayload);
            result = warnings.length > 0
              ? { ...shaped, warnings, missing_recommended: kanban.missingRecommendedCreateFields(createPayload) }
              : shaped;
            break;
          }

          case 'move': {
            if (!args.task_id) {
              throw invalidRequest(
                "task_id is required for 'move'",
                'Provide a task ID',
                { action }
              );
            }
            if (!args.column) {
              throw invalidRequest(
                "column is required for 'move'",
                'Provide one target column',
                { action }
              );
            }
            const updated = await kanban.updateTask(args.task_id, { column: args.column });
            result = formatTaskResult(updated, returnShape);
            break;
          }

          case 'update': {
            if (!args.task_id) {
              throw invalidRequest(
                "task_id is required for 'update'",
                'Provide a task ID',
                { action }
              );
            }
            const patch = args.patch ? { ...args.patch } : {};
            if (args.title !== undefined) patch.title = args.title;
            if (args.description !== undefined) patch.description = args.description;
            if (args.specs !== undefined) patch.specs = args.specs;
            if (args.in_scope !== undefined) patch.in_scope = args.in_scope;
            if (args.out_of_scope !== undefined) patch.out_of_scope = args.out_of_scope;
            if (args.acceptance_criteria !== undefined) patch.acceptance_criteria = args.acceptance_criteria;
            if (args.test_cases !== undefined) patch.test_cases = args.test_cases;
            if (args.subtasks !== undefined) patch.subtasks = args.subtasks;
            if (args.notes !== undefined) patch.notes = args.notes;
            if (args.epic !== undefined) patch.epic_group = args.epic;
            if (args.col !== undefined) patch.column = args.col;
            const updated = await kanban.updateTask(args.task_id, patch);
            result = formatTaskResult(updated, returnShape);
            break;
          }

          case 'plan_create': {
            result = await plan.create(args);
            const planWarnings = kanban.createFieldWarnings(args);
            if (planWarnings.length > 0 && result && typeof result === 'object') {
              result = {
                ...result,
                warnings: planWarnings,
                missing_recommended: kanban.missingRecommendedCreateFields(args)
              };
            }
            break;
          }
          case 'plan_advance':
            result = await plan.advance({ task_id: args.task_id, index: args.index });
            break;
          case 'plan_evidence':
            result = await plan.evidence(args);
            break;
          case 'plan_done':
            result = await plan.done({ task_id: args.task_id });
            break;
          case 'plan_status':
            result = await plan.status(args.task_id);
            break;

          default:
            throw invalidRequest(
              `Unknown action: ${action}`,
              'Use create, move, update, plan_create, plan_advance, plan_evidence, plan_done, or plan_status',
              { action }
            );
        }
        break;
      }

      case 'kanban_gui': {
        const action = args.action;

        switch (action) {
          case 'start': {
            result = await startGuiServer(args.port);
            break;
          }
          case 'stop': {
            result = await stopGuiServer();
            break;
          }
          case 'status': {
            result = await guiStatus();
            break;
          }
          default:
            throw invalidRequest(
              `Unknown action: ${action}`,
              'Use one of: start, stop, status',
              { action }
            );
        }
        break;
      }

      default:
        throw invalidRequest(`Unknown tool: ${name}`, 'Call tools/list to discover available tools', { name });
    }

    return textResponse(result);
  } catch (error) {
    return textResponse(serializeError(error), true);
  }
});

async function maybeAutoStartGui() {
  if (!envFlagEnabled('KANBANGO_AUTO_GUI')) return null;

  try {
    const result = await startGuiServer();
    console.error(`kanbango GUI ${result.status}: ${result.url}`);
    return result;
  } catch (error) {
    console.error(`kanbango GUI auto-start failed: ${error.message}`);
    return null;
  }
}

function installGuiShutdownHooks() {
  let shuttingDown = false;

  async function shutdownOwnedGui() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!ownsGuiProcess()) return;
    try {
      await stopGuiServer();
    } catch {
      // best-effort
    }
  }

  process.once('exit', () => {
    if (ownsGuiProcess()) {
      try {
        guiProcess.kill();
      } catch {
        // ignore
      }
    }
  });
  process.once('SIGINT', () => {
    shutdownOwnedGui().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    shutdownOwnedGui().finally(() => process.exit(0));
  });
}

async function main() {
  await kanban.ensureBacklogDir();
  installGuiShutdownHooks();
  await maybeAutoStartGui();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('kanbango MCP server running');
}

module.exports = {
  serializeError,
  serializeResult,
  textResponse,
  startGuiServer,
  stopGuiServer,
  guiStatus,
  resolvePreferredGuiPort: guiRegistry.resolvePreferredGuiPort,
  playbook,
  server,
  main
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
}
