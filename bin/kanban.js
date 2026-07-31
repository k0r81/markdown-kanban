#!/usr/bin/env node

const kanban = require('../kanban.js');
const plan = require('../plan.js');
const guiRegistry = require('../gui-registry.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKLOG = path.join(process.cwd(), 'backlog');

function shortId(taskId) {
  const match = taskId.match(/^(?:[A-Z]+-)?(\d+)/);
  return match ? match[1] : taskId;
}

function displayTitle(task) {
  return task.title.replace(/^[\w.-]+:\s*/, '');
}

function taskFilePath(task) {
  return path.join(BACKLOG, task.column, `${task.id}.json`);
}

function mcpCommand(useNpx) {
  if (useNpx) {
    return { command: 'npx', args: ['-y', 'kanbango', 'mcp'] };
  }
  return { command: 'node', args: ['./node_modules/kanbango/mcp-server.js'] };
}

function claudeMcpConfig(useNpx) {
  const cmd = mcpCommand(useNpx);
  return {
    mcpServers: {
      'kanbango': cmd
    }
  };
}

function openCodeMcpConfig(useNpx) {
  const cmd = useNpx
    ? ['npx', '-y', 'kanbango', 'mcp']
    : ['node', './node_modules/kanbango/mcp-server.js'];

  return {
    '$schema': 'https://opencode.ai/config.json',
    mcp: {
      'kanbango': {
        type: 'local',
        command: cmd,
        enabled: true
      }
    }
  };
}

async function writeJsonConfig(filePath, data, force) {
  if (fs.existsSync(filePath) && !force) {
    return { status: 'skipped' };
  }

  await fs.promises.writeFile(
    filePath,
    JSON.stringify(data, null, 2) + '\n',
    'utf-8'
  );

  return { status: 'written' };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.status || 500;
  sendJson(res, statusCode, {
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
      hint: error.hint || 'Inspect the request payload and try again',
      details: error.details || {},
      retryable: Boolean(error.retryable)
    }
  });
}

async function cliInit() {
  await kanban.ensureBacklogDir();
  const readme = path.join(BACKLOG, 'README.md');

  if (!fs.existsSync(readme)) {
    await fs.promises.writeFile(
      readme,
      '# Backlog\n\nUtworzony przez kanban.js\n\n'
        + '## Struktura\n'
        + '- `active/`  — w trakcie (max 1-2)\n'
        + '- `planned/` — zaplanowane\n'
        + '- `icebox/`  — zamrozone / nice-to-have\n'
        + '- `done/`    — ukonczone\n'
        + '- `epics/`   — first-class epic containers (context for initiatives)\n',
      'utf-8'
    );
  }

  console.log(`✓ Backlog w: ${BACKLOG}`);
}

async function cliMcpInit(options) {
  const useNpx = options.useNpx;
  const force = options.force;
  const onlyClaude = options.onlyClaude;
  const onlyOpenCode = options.onlyOpenCode;
  const cwd = process.cwd();

  const targets = [];
  if (!onlyOpenCode) {
    targets.push({
      label: '.mcp.json (Claude Code)',
      filePath: path.join(cwd, '.mcp.json'),
      data: claudeMcpConfig(useNpx)
    });
  }
  if (!onlyClaude) {
    targets.push({
      label: 'opencode.json (OpenCode)',
      filePath: path.join(cwd, 'opencode.json'),
      data: openCodeMcpConfig(useNpx)
    });
  }

  for (const target of targets) {
    const result = await writeJsonConfig(target.filePath, target.data, force);
    if (result.status === 'skipped') {
      console.log(`• Pominięto ${target.label} (już istnieje)`);
    } else {
      console.log(`✓ Utworzono ${target.label}`);
    }
  }

  if (!force) {
    console.log('  (użyj --force, aby nadpisać istniejące pliki)');
  }
}

async function cliList(colFilter, epicFilter, asJson, listOptions = {}) {
  await kanban.migrateEpicGroups();
  const epics = await kanban.listEpicEntities();
  let tasks = await kanban.allTasks();

  if (colFilter) {
    tasks = tasks.filter((task) => task.column === colFilter);
  }
  if (epicFilter) {
    tasks = tasks.filter((task) => kanban.taskMatchesEpicFilter(task, epicFilter));
  } else {
    tasks = kanban.filterTasksForList(tasks, epics, listOptions);
  }

  if (asJson) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  if (tasks.length === 0) {
    console.log('(brak)');
    return;
  }

  for (const task of tasks) {
    const progress = kanban.getProgress(task);
    const prog = progress.total ? `${progress.done}/${progress.total}` : '—';
    const title = displayTitle(task).substring(0, 42);
    const epicLabel = task.epic_id
      ? `${task.epic_id}:${task.epic_group}`
      : task.epic_group;
    console.log(
      `  ${task.column.padEnd(8)}  ${shortId(task.id).padEnd(8)}  ${title.padEnd(43)}  ${prog.padStart(5)}  [${epicLabel}]`
    );
  }
}

async function cliShow(taskId) {
  try {
    const task = await kanban.getTask(taskId);
    console.log(`ID:      ${shortId(task.id)}`);
    console.log(`Plik:    ${taskFilePath(task)}`);
    console.log(`Tytuł:   ${displayTitle(task)}`);
    console.log(`Kolumna: ${task.column}`);
    console.log(`Epik:    ${task.epic_id ? `${task.epic_id} (${task.epic_group})` : task.epic_group}`);
    console.log(`Worzono: ${task.created || '—'}`);

    if (task.description) {
      console.log(`Opis:    ${task.description}`);
    }

    if (task.subtasks.length > 0) {
      console.log('Subtaski:');
      for (let i = 0; i < task.subtasks.length; i++) {
        const subtask = task.subtasks[i];
        const mark = subtask.done ? 'x' : ' ';
        console.log(`  [${i}] [${mark}] ${subtask.text}`);
      }
    }
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliEpicList(asJson, listOptions = {}) {
  await kanban.migrateEpicGroups();
  const tasks = await kanban.allTasks();
  const epics = await kanban.listEpicEntities();
  const shaped = kanban.filterShapedEpics(
    epics.map((epic) => kanban.shapeEpic(epic, tasks, { view: 'summary' })),
    listOptions
  );

  if (asJson) {
    console.log(JSON.stringify(shaped, null, 2));
    return;
  }

  if (shaped.length === 0) {
    console.log('(brak epików)');
    return;
  }

  for (const epic of shaped) {
    const p = epic.progress || {};
    const flag = epic.archived ? ' [archived]' : '';
    console.log(
      `  ${epic.id.padEnd(6)}  ${epic.status.padEnd(8)}  ${String(epic.title).substring(0, 40).padEnd(40)}  ${p.tasks_done || 0}/${p.tasks_total || 0} tasks${flag}`
    );
  }
}

async function cliEpicShow(epicId) {
  try {
    await kanban.migrateEpicGroups();
    const link = await kanban.resolveEpicRef(epicId, { createIfMissing: false });
    const epic = await kanban.getEpicEntity(link.epic_id);
    const tasks = await kanban.allTasks();
    const shaped = kanban.shapeEpic(epic, tasks, { view: 'full' });
    console.log(JSON.stringify(shaped, null, 2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliEpicAdd(title, options = {}) {
  try {
    const epic = await kanban.doCreateEpic(title, options);
    console.log(`✓ Epic ${epic.id}: ${epic.title}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliEpicUpdate(epicId, patch) {
  try {
    const epic = await kanban.updateEpicEntity(epicId, patch);
    console.log(`✓ Epic ${epic.id} updated`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliEpicArchive(epicId, archived) {
  try {
    const epic = archived
      ? await kanban.archiveEpic(epicId)
      : await kanban.unarchiveEpic(epicId);
    console.log(`✓ Epic ${epic.id} ${archived ? 'archived' : 'unarchived'}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliEpicDelete(epicId) {
  try {
    const result = await kanban.deleteEpic(epicId);
    console.log(`✓ Deleted epic ${result.epic_id} (+${result.deleted_task_count} tasks)`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliDelete(taskId) {
  try {
    const result = await kanban.deleteTask(taskId);
    console.log(`✓ Deleted task ${shortId(result.task_id)}: ${result.title}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

async function cliMove(taskId, column) {
  const success = await kanban.doMove(taskId, column);
  if (success) {
    console.log(`✓ ${shortId(taskId)} → ${column}`);
  } else {
    console.error(`✗ Nie znaleziono: ${taskId}`);
    process.exit(1);
  }
}

async function cliAdd(title, column, epicGroup) {
  try {
    const task = await kanban.doCreate(title, column, epicGroup);
    console.log(`✓ Utworzono ${shortId(task.id)} w ${column}  [${task.epic_group}]`);
    console.log(`  Plik: ${taskFilePath(task)}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

function injectProjectIntoHtml(html, project) {
  const safe = String(project)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${safe} · Kanban</title>`)
    .replace(/<h1>Donna Kanban<\/h1>/, `<h1>${safe}</h1>`);
}

async function serveWeb(port) {
  const htmlTemplate = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  const project = guiRegistry.projectLabel();
  const html = injectProjectIntoHtml(htmlTemplate, project);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const requestPath = decodeURIComponent(url.pathname);

    try {
      if (requestPath === '/' || requestPath === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (requestPath === '/api/board') {
        await kanban.migrateEpicGroups();
        const includeArchived = url.searchParams.get('include_archived') === 'true';
        const epics = await kanban.listEpicEntities();
        // GUI: show done-epic tasks; only hide archived unless toggled
        const tasks = kanban.filterTasksForList(await kanban.allTasks(), epics, {
          live_only: false,
          include_archived: includeArchived
        });
        sendJson(res, 200, tasks);
        return;
      }

      if (requestPath === '/api/epics' && req.method === 'GET') {
        await kanban.migrateEpicGroups();
        const tasks = await kanban.allTasks();
        const epics = await kanban.listEpicEntities();
        const shaped = epics.map((epic) => kanban.shapeEpic(epic, tasks, { view: 'full' }));
        const includeArchived = url.searchParams.get('include_archived') === 'true';
        const includeDone = url.searchParams.get('include_done') === 'true';
        const status = url.searchParams.get('status') || undefined;
        // GUI default: all non-archived (live + done). Agents use MCP live-only.
        const liveOnly = url.searchParams.get('live_only') === 'true';
        const filtered = kanban.filterShapedEpics(shaped, liveOnly
          ? { include_archived: includeArchived, include_done: includeDone, status }
          : { live_only: false, include_archived: includeArchived, status });
        sendJson(res, 200, filtered);
        return;
      }

      if (requestPath === '/api/epics' && req.method === 'POST') {
        const body = await readBody(req);
        // Real epic container when no task column is provided.
        if (body.column === undefined && body.as_task !== true) {
          const epic = await kanban.doCreateEpic(body.title || '', {
            description: body.description,
            goals: body.goals,
            in_scope: body.in_scope,
            out_of_scope: body.out_of_scope,
            notes: body.notes
          });
          sendJson(res, 201, kanban.shapeEpic(epic, [], { view: 'full' }));
          return;
        }

        const task = await kanban.doCreate(
          body.title || '',
          body.column || 'planned',
          body.epic_id || body.epic || body.epic_group || '—',
          {
            description: body.description,
            specs: body.specs,
            in_scope: body.in_scope,
            out_of_scope: body.out_of_scope,
            acceptance_criteria: body.acceptance_criteria,
            test_cases: body.test_cases,
            subtasks: body.subtasks,
            notes: body.notes
          }
        );
        sendJson(res, 201, task);
        return;
      }

      if (requestPath === '/api/tasks' && req.method === 'POST') {
        const body = await readBody(req);
        const task = await kanban.doCreate(
          body.title || '',
          body.column || 'planned',
          body.epic_id || body.epic || body.epic_group || '—',
          {
            description: body.description,
            specs: body.specs,
            in_scope: body.in_scope,
            out_of_scope: body.out_of_scope,
            acceptance_criteria: body.acceptance_criteria,
            test_cases: body.test_cases,
            subtasks: body.subtasks,
            notes: body.notes
          }
        );
        sendJson(res, 201, task);
        return;
      }

      if (req.method === 'DELETE') {
        const epicDeleteMatch = requestPath.match(/^\/api\/epic-entities\/([^/]+)$/);
        if (epicDeleteMatch) {
          const result = await kanban.deleteEpic(epicDeleteMatch[1]);
          sendJson(res, 200, result);
          return;
        }

        const taskDeleteMatch = requestPath.match(/^\/api\/(?:epics|tasks)\/([^/]+)$/);
        if (taskDeleteMatch) {
          const result = await kanban.deleteTask(taskDeleteMatch[1]);
          sendJson(res, 200, result);
          return;
        }
      }

      if (req.method === 'POST') {
        const epicArchiveMatch = requestPath.match(/^\/api\/epic-entities\/([^/]+)\/(archive|unarchive)$/);
        if (epicArchiveMatch) {
          const epic = epicArchiveMatch[2] === 'archive'
            ? await kanban.archiveEpic(epicArchiveMatch[1])
            : await kanban.unarchiveEpic(epicArchiveMatch[1]);
          sendJson(res, 200, kanban.shapeEpic(epic, await kanban.allTasks(), { view: 'full' }));
          return;
        }
      }

      if (req.method === 'PATCH') {
        const epicUpdateMatch = requestPath.match(/^\/api\/epic-entities\/([^/]+)$/);
        if (epicUpdateMatch) {
          const body = await readBody(req);
          const patch = body.patch ? { ...body.patch } : { ...body };
          delete patch.patch;
          const epic = await kanban.updateEpicEntity(epicUpdateMatch[1], patch);
          sendJson(res, 200, kanban.shapeEpic(epic, await kanban.allTasks(), { view: 'full' }));
          return;
        }

        const moveMatch = requestPath.match(/^\/api\/(?:epics|tasks)\/([^/]+)\/move$/);
        if (moveMatch) {
          const taskId = moveMatch[1];
          const body = await readBody(req);
          const task = await kanban.updateTask(taskId, { column: body.column || '' });
          sendJson(res, 200, task);
          return;
        }

        const toggleMatch = requestPath.match(/^\/api\/(?:epics|tasks)\/([^/]+)\/tasks\/(\d+)$/);
        if (toggleMatch) {
          const taskId = toggleMatch[1];
          const idx = parseInt(toggleMatch[2], 10);
          const current = await kanban.getTask(taskId);
          if (idx < 0 || idx >= current.subtasks.length) {
            throw kanban.createKanbanError(
              'INVALID_SUBTASK_INDEX',
              `Subtask index ${idx} is not valid for task ${taskId}`,
              'Read the task first and use an index between 0 and subtasks.length - 1',
              { task_id: taskId, idx, total_subtasks: current.subtasks.length },
              false,
              400
            );
          }

          const subtasks = current.subtasks.map((subtask, subtaskIdx) => ({
            ...subtask,
            done: subtaskIdx === idx ? !subtask.done : subtask.done
          }));
          const task = await kanban.updateTask(taskId, { subtasks });
          sendJson(res, 200, task);
          return;
        }

        const updateMatch = requestPath.match(/^\/api\/(?:epics|tasks)\/([^/]+)$/);
        if (updateMatch) {
          const taskId = updateMatch[1];
          const body = await readBody(req);
          const patch = body.patch ? { ...body.patch } : {};

          if (body.title !== undefined) patch.title = body.title;
          if (body.description !== undefined) patch.description = body.description;
          if (body.specs !== undefined) patch.specs = body.specs;
          if (body.in_scope !== undefined) patch.in_scope = body.in_scope;
          if (body.out_of_scope !== undefined) patch.out_of_scope = body.out_of_scope;
          if (body.acceptance_criteria !== undefined) patch.acceptance_criteria = body.acceptance_criteria;
          if (body.test_cases !== undefined) patch.test_cases = body.test_cases;
          if (body.subtasks !== undefined) patch.subtasks = body.subtasks;
          if (body.notes !== undefined) patch.notes = body.notes;
          if (body.epic_id !== undefined) patch.epic_id = body.epic_id;
          else if (body.epic !== undefined) patch.epic = body.epic;
          else if (body.epic_group !== undefined) patch.epic_group = body.epic_group;

          const task = await kanban.updateTask(taskId, patch);
          sendJson(res, 200, task);
          return;
        }
      }

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    } catch (error) {
      sendError(res, error);
    }
  });

  const MAX_ATTEMPTS = 10;

  function listenOnce(server, port) {
    return new Promise((resolve, reject) => {
      function onError(err) {
        server.removeListener('listening', onListening);
        reject(err);
      }
      function onListening() {
        server.removeListener('error', onError);
        resolve();
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, 'localhost');
    });
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await listenOnce(server, port + attempt);
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      console.log(`Port ${port + attempt} zajęty, próbuję ${port + attempt + 1}…`);
    }
  }

  if (!server.listening) {
    console.log(`Porty ${port}–${port + MAX_ATTEMPTS - 1} zajęte, próbuję losowy port…`);
    await listenOnce(server, 0);
  }

  const actualPort = server.address().port;
  const portInfo = await guiRegistry.writeGuiPortFile({ port: actualPort, pid: process.pid });

  async function cleanupGuiPortFile() {
    try {
      await guiRegistry.clearGuiPortFile({ pid: process.pid });
    } catch {
      // best-effort cleanup
    }
  }

  server.on('close', () => {
    cleanupGuiPortFile();
  });

  process.once('SIGINT', async () => {
    await cleanupGuiPortFile();
    server.close(() => process.exit(0));
  });
  process.once('SIGTERM', async () => {
    await cleanupGuiPortFile();
    server.close(() => process.exit(0));
  });

  console.log(`\x1b[1;32m→ Kanban GUI: ${portInfo.url}\x1b[0m`);
  console.log(`  Project:   ${portInfo.project || project}`);
  console.log(`  Backlog:   ${BACKLOG}`);
  console.log('  Ctrl+C żeby zamknąć');
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

async function cliMigrate(dryRun) {
  const result = await kanban.migrateAll({ dryRun });

  if (dryRun) {
    console.log(`Found ${result.migrated.length} .md files to migrate:`);
    for (const item of result.migrated) {
      console.log(`  ${item.id}.md → ${item.id}.json`);
    }
    return;
  }

  console.log(`✓ Migrated ${result.migrated.length} tasks from .md → .json`);
  for (const item of result.migrated) {
    console.log(`  ${item.id}.md → ${item.id}.json`);
  }

  if (result.errors.length > 0) {
    console.error(`✗ ${result.errors.length} errors:`);
    for (const err of result.errors) {
      console.error(`  ${err.file}: ${err.reason}`);
    }
  }
}

function parseJsonPayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (error) {
    throw kanban.createKanbanError('INVALID_JSON', 'Payload is not valid JSON',
      'Pass a JSON object after --json', { reason: error.message }, false, 400);
  }
}

async function cliPlan(action, payload) {
  try {
    const handlers = {
      create: plan.create,
      advance: plan.advance,
      evidence: plan.evidence,
      done: plan.done,
      status: (input) => plan.status(input.task_id)
    };
    if (!handlers[action]) throw kanban.createKanbanError('INVALID_PLAN_ACTION', `Unknown plan action: ${action}`,
      'Use create, advance, evidence, done, or status', { action }, false, 400);
    console.log(JSON.stringify(await handlers[action](payload)));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, task_id: payload.task_id || null, subtasks: [], error: {
      code: error.code || 'INTERNAL_ERROR', message: error.message, hint: error.hint || '', details: error.details || {}
    } }));
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === 'serve') {
    const port = guiRegistry.resolvePreferredGuiPort(args[1]);
    await serveWeb(port);
  } else if (cmd === 'init') {
    await cliInit();
  } else if (cmd === 'mcp-init') {
    let useNpx = false;
    let onlyClaude = false;
    let onlyOpenCode = false;
    let force = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--npx') {
        useNpx = true;
      } else if (args[i] === '--claude') {
        onlyClaude = true;
      } else if (args[i] === '--opencode') {
        onlyOpenCode = true;
      } else if (args[i] === '--force') {
        force = true;
      }
    }

    if (onlyClaude && onlyOpenCode) {
      onlyClaude = false;
      onlyOpenCode = false;
    }

    await cliMcpInit({ useNpx, onlyClaude, onlyOpenCode, force });
  } else if (cmd === 'migrate') {
    const dryRun = args.includes('--dry-run');
    await cliMigrate(dryRun);
  } else if (cmd === 'list') {
    let colFilter = null;
    let epicFilter = null;
    let asJson = false;
    let includeArchived = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--col' && args[i + 1]) {
        colFilter = args[++i];
      } else if (args[i] === '--epic' && args[i + 1]) {
        epicFilter = args[++i];
      } else if (args[i] === '--json') {
        asJson = true;
      } else if (args[i] === '--include-archived') {
        includeArchived = true;
      }
    }

    await cliList(colFilter, epicFilter, asJson, { include_archived: includeArchived });
  } else if (cmd === 'epic') {
    const sub = args[1];
    if (sub === 'list') {
      let includeArchived = false;
      let includeDone = false;
      let status;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--include-archived') includeArchived = true;
        else if (args[i] === '--include-done') includeDone = true;
        else if (args[i] === '--all') {
          includeArchived = true;
          includeDone = true;
        } else if (args[i] === '--status' && args[i + 1]) status = args[++i];
      }
      await cliEpicList(args.includes('--json'), {
        include_archived: includeArchived,
        include_done: includeDone,
        status
      });
    } else if (sub === 'show' && args[2]) {
      await cliEpicShow(args[2]);
    } else if (sub === 'add' && args[2]) {
      let description = '';
      let goals = '';
      for (let i = 3; i < args.length; i++) {
        if (args[i] === '--description' && args[i + 1]) description = args[++i];
        else if (args[i] === '--goals' && args[i + 1]) goals = args[++i];
      }
      await cliEpicAdd(args[2], { description, goals });
    } else if (sub === 'update' && args[2] && args[3]) {
      await cliEpicUpdate(args[2], parseJsonPayload(args[3]));
    } else if (sub === 'archive' && args[2]) {
      await cliEpicArchive(args[2], true);
    } else if (sub === 'unarchive' && args[2]) {
      await cliEpicArchive(args[2], false);
    } else if ((sub === 'rm' || sub === 'delete') && args[2]) {
      await cliEpicDelete(args[2]);
    } else {
      console.error('Usage: kanban epic list|show|add|update|archive|unarchive|rm ...');
      process.exit(1);
    }
  } else if (cmd === 'show' && args[1]) {
    await cliShow(args[1]);
  } else if ((cmd === 'rm' || cmd === 'delete') && args[1]) {
    await cliDelete(args[1]);
  } else if (cmd === 'move' && args[1] && args[2]) {
    await cliMove(args[1], args[2]);
  } else if (cmd === 'add' && args[1]) {
    let column = 'planned';
    let epicGroup = '—';

    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--col' && args[i + 1]) {
        column = args[++i];
      } else if (args[i] === '--epic' && args[i + 1]) {
        epicGroup = args[++i];
      }
    }

    await cliAdd(args[1], column, epicGroup);
  } else if (cmd === 'plan' && args[1] && args[2] === '--json') {
    await cliPlan(args[1], parseJsonPayload(args[3]));
  } else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
