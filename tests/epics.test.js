const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function callMcp(root, request) {
  const serverPath = path.join(__dirname, '..', 'mcp-server.js');
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: root,
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf-8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `MCP exited ${result.status}`);
  }
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const payload = JSON.parse(lines[lines.length - 1]);
  const text = payload.result && payload.result.content && payload.result.content[0]
    ? payload.result.content[0].text
    : undefined;
  return { envelope: payload, text, parsed: text ? JSON.parse(text) : undefined };
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-epics-'));
  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));

  const epic = await kanban.doCreateEpic('Auth rewrite', {
    description: 'OIDC login initiative',
    goals: 'Users sign in via OIDC',
    in_scope: ['login'],
    out_of_scope: ['billing']
  });
  assert.strictEqual(epic.id, 'E001');
  assert.strictEqual(epic.title, 'Auth rewrite');

  const taskA = await kanban.doCreate('Login page', 'planned', 'E001', {
    description: 'Build login UI'
  });
  assert.strictEqual(taskA.epic_id, 'E001');
  assert.strictEqual(taskA.epic_group, 'Auth rewrite');

  const taskB = await kanban.doCreate('Session store', 'active', 'Auth rewrite', {
    description: 'Persist sessions'
  });
  assert.strictEqual(taskB.epic_id, 'E001');

  const tasks = await kanban.allTasks();
  const shaped = kanban.shapeEpic(epic, tasks, { view: 'full' });
  assert.strictEqual(shaped.status, 'active');
  assert.strictEqual(shaped.progress.tasks_total, 2);
  assert.strictEqual(shaped.progress.tasks_active, 1);
  assert.strictEqual(shaped.progress.tasks_planned, 1);
  assert.strictEqual(shaped.tasks.length, 2);
  assert.ok(shaped.description.includes('OIDC'));

  await kanban.updateTask(taskA.id, { column: 'done' });
  await kanban.updateTask(taskB.id, { column: 'done' });
  const afterDone = kanban.shapeEpic(await kanban.getEpicEntity('E001'), await kanban.allTasks(), { view: 'summary' });
  assert.strictEqual(afterDone.status, 'done');
  assert.strictEqual(afterDone.progress.tasks_done, 2);

  await kanban.updateEpicEntity('E001', { title: 'Auth v2' });
  const renamedChild = await kanban.getTask(taskA.id);
  assert.strictEqual(renamedChild.epic_group, 'Auth v2');

  // Migration from legacy epic_group labels
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-epic-mig-'));
  process.chdir(legacyRoot);
  delete require.cache[require.resolve(path.join(__dirname, '..', 'kanban.js'))];
  const kanban2 = require(path.join(__dirname, '..', 'kanban.js'));
  await kanban2.ensureBacklogDir();
  const planned = path.join(legacyRoot, 'backlog', 'planned');
  await fs.writeFile(path.join(planned, '010.json'), JSON.stringify({
    id: '010',
    title: 'Legacy task',
    column: 'planned',
    epic_group: 'Phase Legacy',
    created: '2026-01-01',
    subtasks: []
  }, null, 2));

  const mig = await kanban2.migrateEpicGroups();
  assert.ok(mig.created.some((item) => item.title === 'Phase Legacy'));
  const migratedTask = await kanban2.getTask('010');
  assert.ok(migratedTask.epic_id);
  assert.strictEqual(migratedTask.epic_group, 'Phase Legacy');

  // MCP surface
  const mcpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-epic-mcp-'));
  process.chdir(mcpRoot);
  const createdEpic = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'epic_create',
        title: 'MCP Epic',
        description: 'From MCP',
        goals: 'Ship it'
      }
    }
  });
  assert.strictEqual(typeof createdEpic.text, 'string');
  assert.strictEqual(createdEpic.parsed.id, 'E001');
  assert.strictEqual(createdEpic.parsed.title, 'MCP Epic');

  const listed = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list_epics', view: 'summary' }
    }
  });
  assert.ok(Array.isArray(listed.parsed));
  assert.strictEqual(listed.parsed[0].id, 'E001');
  assert.strictEqual(listed.parsed[0].status, 'empty');

  const taskViaMcp = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'create',
        title: 'Child task',
        epic: 'E001',
        col: 'planned',
        description: 'under epic'
      }
    }
  });
  assert.strictEqual(taskViaMcp.parsed.epic_id, 'E001');

  const shown = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'show_epic', epic_id: 'E001', view: 'full' }
    }
  });
  assert.strictEqual(shown.parsed.id, 'E001');
  assert.strictEqual(shown.parsed.progress.tasks_total, 1);
  assert.strictEqual(shown.parsed.tasks[0].title, 'Child task');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
