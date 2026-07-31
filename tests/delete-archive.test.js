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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-del-'));
  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));

  const live = await kanban.doCreateEpic('Live initiative', {
    description: 'active work',
    goals: 'ship'
  });
  const doneEpic = await kanban.doCreateEpic('Finished initiative', {
    description: 'all done',
    goals: 'done'
  });
  const junk = await kanban.doCreateEpic('Junk epic', {
    description: 'delete me',
    goals: 'gone'
  });

  const tLive = await kanban.doCreate('Live task', 'planned', live.id, {
    description: 'work'
  });
  const tDoneA = await kanban.doCreate('Done A', 'done', doneEpic.id, {
    description: 'a'
  });
  const tDoneB = await kanban.doCreate('Done B', 'done', doneEpic.id, {
    description: 'b'
  });
  const tJunk = await kanban.doCreate('Junk task', 'planned', junk.id, {
    description: 'trash'
  });
  const orphan = await kanban.doCreate('Orphan', 'planned', '—', {
    description: 'no epic'
  });

  // Done epic auto-hidden from default list_epics + its tasks from default list
  let tasks = await kanban.allTasks();
  let epics = await kanban.listEpicEntities();
  let shaped = epics.map((e) => kanban.shapeEpic(e, tasks, { view: 'summary' }));
  let liveList = kanban.filterShapedEpics(shaped, {});
  assert.ok(liveList.some((e) => e.id === live.id));
  assert.ok(!liveList.some((e) => e.id === doneEpic.id), 'done epic hidden by default');
  assert.strictEqual(shaped.find((e) => e.id === doneEpic.id).status, 'done');

  const withDone = kanban.filterShapedEpics(shaped, { include_done: true });
  assert.ok(withDone.some((e) => e.id === doneEpic.id));

  let agentTasks = kanban.filterTasksForList(tasks, epics, {});
  assert.ok(!agentTasks.some((t) => t.id === tDoneA.id), 'tasks under done epic hidden for agents');
  assert.ok(agentTasks.some((t) => t.id === tLive.id));
  assert.ok(agentTasks.some((t) => t.id === orphan.id));

  const guiTasks = kanban.filterTasksForList(tasks, epics, { live_only: false });
  assert.ok(guiTasks.some((t) => t.id === tDoneA.id), 'GUI still shows done-epic tasks');

  // Archive hides epic + its tasks from default lists
  await kanban.archiveEpic(live.id);
  tasks = await kanban.allTasks();
  epics = await kanban.listEpicEntities();
  shaped = epics.map((e) => kanban.shapeEpic(e, tasks, { view: 'summary' }));
  liveList = kanban.filterShapedEpics(shaped, {});
  assert.ok(!liveList.some((e) => e.id === live.id));
  assert.strictEqual(shaped.find((e) => e.id === live.id).status, 'archived');
  assert.strictEqual(shaped.find((e) => e.id === live.id).archived, true);

  const filteredTasks = kanban.filterTasksForList(tasks, epics, {});
  assert.ok(!filteredTasks.some((t) => t.id === tLive.id), 'task under archived epic hidden');
  assert.ok(filteredTasks.some((t) => t.id === orphan.id));
  assert.ok(filteredTasks.some((t) => t.id === tJunk.id));

  const withArchived = kanban.filterShapedEpics(shaped, { include_archived: true });
  assert.ok(withArchived.some((e) => e.id === live.id));
  const tasksWithArchived = kanban.filterTasksForList(tasks, epics, { include_archived: true });
  assert.ok(tasksWithArchived.some((t) => t.id === tLive.id));

  // Unarchive restores
  await kanban.unarchiveEpic(live.id);
  epics = await kanban.listEpicEntities();
  tasks = await kanban.allTasks();
  shaped = epics.map((e) => kanban.shapeEpic(e, tasks, { view: 'summary' }));
  liveList = kanban.filterShapedEpics(shaped, {});
  assert.ok(liveList.some((e) => e.id === live.id));
  assert.strictEqual(shaped.find((e) => e.id === live.id).archived, false);

  // show by id still works for archived
  await kanban.archiveEpic(live.id);
  const shown = await kanban.getEpicEntity(live.id);
  assert.strictEqual(shown.archived, true);
  const shownTask = await kanban.getTask(tLive.id);
  assert.strictEqual(shownTask.epic_id, live.id);

  // delete single task
  const delTask = await kanban.deleteTask(orphan.id);
  assert.strictEqual(delTask.ok, true);
  assert.strictEqual(delTask.task_id, orphan.id);
  let threw = false;
  try {
    await kanban.getTask(orphan.id);
  } catch (error) {
    threw = true;
    assert.strictEqual(error.code, 'TASK_NOT_FOUND');
  }
  assert.ok(threw);

  // epic_delete cascades
  const delEpic = await kanban.deleteEpic(junk.id);
  assert.strictEqual(delEpic.ok, true);
  assert.strictEqual(delEpic.epic_id, junk.id);
  assert.strictEqual(delEpic.deleted_task_count, 1);
  assert.strictEqual(delEpic.deleted_tasks[0].task_id, tJunk.id);

  threw = false;
  try {
    await kanban.getEpicEntity(junk.id);
  } catch (error) {
    threw = true;
    assert.strictEqual(error.code, 'EPIC_NOT_FOUND');
  }
  assert.ok(threw);

  threw = false;
  try {
    await kanban.getTask(tJunk.id);
  } catch (error) {
    threw = true;
    assert.strictEqual(error.code, 'TASK_NOT_FOUND');
  }
  assert.ok(threw);

  // MCP surface
  const mcpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-del-mcp-'));
  process.chdir(mcpRoot);

  const created = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'epic_create',
        title: 'MCP Archive Me',
        description: 'ctx',
        goals: 'g'
      }
    }
  });
  assert.strictEqual(created.parsed.id, 'E001');

  callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'create',
        title: 'Child',
        epic: 'E001',
        col: 'planned',
        description: 'c'
      }
    }
  });

  const archived = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: { action: 'epic_archive', epic_id: 'E001', return: 'summary' }
    }
  });
  assert.strictEqual(archived.parsed.status, 'archived');
  assert.strictEqual(archived.parsed.archived, true);

  const listDefault = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list_epics', view: 'summary' }
    }
  });
  assert.ok(Array.isArray(listDefault.parsed));
  assert.strictEqual(listDefault.parsed.length, 0);

  const listArch = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list_epics', include_archived: true, view: 'summary' }
    }
  });
  assert.strictEqual(listArch.parsed.length, 1);

  const listTasks = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list', view: 'summary' }
    }
  });
  assert.strictEqual(listTasks.parsed.length, 0);

  const deleted = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: { action: 'epic_delete', epic_id: 'E001' }
    }
  });
  assert.strictEqual(deleted.parsed.ok, true);
  assert.strictEqual(deleted.parsed.deleted_task_count, 1);

  const afterDel = callMcp(mcpRoot, {
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list_epics', include_archived: true }
    }
  });
  assert.strictEqual(afterDel.parsed.length, 0);

  // status=done filter via MCP
  const mcp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-del-mcp2-'));
  process.chdir(mcp2);
  callMcp(mcp2, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: { action: 'epic_create', title: 'Doneish', description: 'd', goals: 'g' }
    }
  });
  const child = callMcp(mcp2, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'create',
        title: 'Finish me',
        epic: 'E001',
        col: 'done',
        description: 'x'
      }
    }
  });
  assert.ok(child.parsed.task_number || child.parsed.id);

  const liveOnly = callMcp(mcp2, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list_epics' }
    }
  });
  assert.strictEqual(liveOnly.parsed.length, 0);

  const doneOnly = callMcp(mcp2, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'list_epics', status: 'done' }
    }
  });
  assert.strictEqual(doneOnly.parsed.length, 1);
  assert.strictEqual(doneOnly.parsed[0].status, 'done');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
