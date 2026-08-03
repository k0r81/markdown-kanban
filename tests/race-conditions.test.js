const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

async function listTaskFiles(root) {
  const backlog = path.join(root, 'backlog');
  const found = [];
  for (const col of ['active', 'planned', 'icebox', 'done']) {
    const dir = path.join(backlog, col);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files) {
      if (file.startsWith('.') || (!file.endsWith('.json') && !file.endsWith('.md'))) continue;
      found.push({
        col,
        file,
        id: path.basename(file, path.extname(file)),
        path: path.join(dir, file)
      });
    }
  }
  return found;
}

async function listEpicFiles(root) {
  const dir = path.join(root, 'backlog', 'epics');
  try {
    return (await fs.readdir(dir)).filter((f) => !f.startsWith('.') && f.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function assertUnique(values, label) {
  const set = new Set(values);
  assert.strictEqual(
    set.size,
    values.length,
    `${label} must be unique, got duplicates: ${values.join(', ')}`
  );
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-race-'));
  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));
  await kanban.ensureBacklogDir();

  // ── 1. Concurrent task creates: unique ids, no lost files ─────────────────
  const CREATE_N = 20;
  const created = await Promise.all(
    Array.from({ length: CREATE_N }, (_, i) =>
      kanban.doCreate(`Race task ${i}`, i % 2 === 0 ? 'planned' : 'active', '—', {
        description: `concurrent ${i}`
      })
    )
  );
  assert.strictEqual(created.length, CREATE_N);
  assertUnique(created.map((t) => t.id), 'task ids from concurrent create');
  const filesAfterCreate = await listTaskFiles(tempRoot);
  assert.strictEqual(filesAfterCreate.length, CREATE_N, 'one file per created task');
  assertUnique(filesAfterCreate.map((f) => f.id), 'on-disk task ids after concurrent create');
  const listed = await kanban.allTasks();
  assert.strictEqual(listed.length, CREATE_N);
  assertUnique(listed.map((t) => t.id), 'allTasks ids after concurrent create');

  // ── 2. Concurrent epic creates: unique E### ids ───────────────────────────
  const EPIC_N = 12;
  const epics = await Promise.all(
    Array.from({ length: EPIC_N }, (_, i) =>
      kanban.doCreateEpic(`Race epic ${i}`, {
        description: `epic ${i}`,
        goals: 'unique ids'
      })
    )
  );
  assert.strictEqual(epics.length, EPIC_N);
  assertUnique(epics.map((e) => e.id), 'epic ids from concurrent create');
  const epicFiles = await listEpicFiles(tempRoot);
  assert.strictEqual(epicFiles.length, EPIC_N);
  assertUnique(epicFiles.map((f) => path.basename(f, '.json')), 'on-disk epic ids');

  // ── 3. Concurrent move of same task: single file, readable task ───────────
  const mover = await kanban.doCreate('Move race', 'planned', '—', {
    description: 'will be moved concurrently'
  });
  const targets = ['active', 'done', 'icebox', 'active', 'done'];
  await Promise.all(targets.map((col) => kanban.doMove(mover.id, col)));

  const moverFiles = (await listTaskFiles(tempRoot)).filter((f) => f.id === mover.id);
  assert.strictEqual(
    moverFiles.length,
    1,
    `task ${mover.id} must exist in exactly one column after concurrent moves, found: ${
      moverFiles.map((f) => f.col).join(', ') || 'none'
    }`
  );
  const afterMove = await kanban.getTask(mover.id);
  assert.strictEqual(afterMove.id, mover.id);
  assert.ok(kanban.COLS.includes(afterMove.column));
  assert.strictEqual(afterMove.column, moverFiles[0].col);

  // ── 4. Concurrent updates on same task: last-write-wins, no crash, valid JSON ─
  const shared = await kanban.doCreate('Update race', 'planned', '—', {
    description: 'base',
    notes: '0'
  });
  const UPDATE_N = 16;
  await Promise.all(
    Array.from({ length: UPDATE_N }, (_, i) =>
      kanban.updateTask(shared.id, {
        notes: `n-${i}`,
        description: `d-${i}`,
        title: `Update race ${i}`
      })
    )
  );
  const afterUpdates = await kanban.getTask(shared.id);
  assert.ok(afterUpdates.title.startsWith('Update race'));
  assert.ok(typeof afterUpdates.notes === 'string');
  assert.ok(typeof afterUpdates.description === 'string');
  const sharedFiles = (await listTaskFiles(tempRoot)).filter((f) => f.id === shared.id);
  assert.strictEqual(sharedFiles.length, 1, 'update race must not duplicate files');
  JSON.parse(await fs.readFile(sharedFiles[0].path, 'utf-8'));

  // ── 5. Concurrent create + move mix: board stays consistent ───────────────
  const seed = await kanban.doCreate('Seed mix', 'planned', '—', { description: 'seed' });
  await Promise.all([
    kanban.doCreate('Mix A', 'planned', '—', { description: 'a' }),
    kanban.doCreate('Mix B', 'active', '—', { description: 'b' }),
    kanban.doMove(seed.id, 'active'),
    kanban.doMove(seed.id, 'done'),
    kanban.doCreate('Mix C', 'icebox', '—', { description: 'c' }),
    kanban.updateTask(seed.id, { title: 'Seed mix final' })
  ]);

  const allFiles = await listTaskFiles(tempRoot);
  const ids = allFiles.map((f) => f.id);
  assertUnique(ids, 'on-disk task ids after mixed concurrent ops');
  const all = await kanban.allTasks();
  assert.strictEqual(all.length, allFiles.length, 'allTasks count matches files');
  assertUnique(all.map((t) => t.id), 'allTasks ids after mixed ops');

  for (const task of all) {
    const matches = allFiles.filter((f) => f.id === task.id);
    assert.strictEqual(matches.length, 1, `task ${task.id} file count`);
    assert.strictEqual(matches[0].col, task.column, `task ${task.id} column matches path`);
  }

  // ── 6. Concurrent create under same new epic title (resolve createIfMissing) ─
  const epicTitle = 'Shared race epic';
  const linked = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      kanban.doCreate(`Child ${i}`, 'planned', epicTitle, { description: `child ${i}` })
    )
  );
  const linkEpicIds = [...new Set(linked.map((t) => t.epic_id).filter(Boolean))];
  assert.strictEqual(
    linkEpicIds.length,
    1,
    `concurrent createIfMissing should resolve to one epic, got: ${linkEpicIds.join(', ')}`
  );
  for (const task of linked) {
    assert.strictEqual(task.epic_id, linkEpicIds[0]);
    assert.strictEqual(task.epic_group, epicTitle);
  }

  // ── 7. Concurrent delete of distinct tasks while listing ──────────────────
  const doomed = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      kanban.doCreate(`Doomed ${i}`, 'planned', '—', { description: `d${i}` })
    )
  );
  const beforeDeleteCount = (await kanban.allTasks()).length;
  await Promise.all([
    ...doomed.map((t) => kanban.deleteTask(t.id)),
    kanban.allTasks(),
    kanban.allTasks()
  ]);
  const afterDelete = await kanban.allTasks();
  assert.strictEqual(afterDelete.length, beforeDeleteCount - doomed.length);
  for (const t of doomed) {
    assert.ok(!afterDelete.some((x) => x.id === t.id));
  }

  console.log('✓ race-conditions tests passed');
}

run().catch((error) => {
  console.error('✗ race-conditions tests failed');
  console.error(error);
  process.exit(1);
});
