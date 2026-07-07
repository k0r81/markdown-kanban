const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-'));
  const backlogDir = path.join(tempRoot, 'backlog', 'active');
  await fs.mkdir(backlogDir, { recursive: true });

  const epicId = 'PI-001-test';
  const markdownPath = path.join(backlogDir, `${epicId}.md`);
  const jsonPath = path.join(backlogDir, `${epicId}.json`);
  const initial = `# PI-001: Test

**Status:** in_progress
**Epic:** —
**Created:** 2026-03-17

## Opis
Legacy markdown task

## Taski
- [ ] Stare 1
- [x] Stare 2

## Notes
Legacy note
`;
  await fs.writeFile(markdownPath, initial, 'utf-8');

  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));

  const newTasks = [
    { text: 'Nowe 1', done: false, description: 'Pierwszy subtask' },
    { text: 'Nowe 2', done: true, description: 'Drugi subtask' }
  ];

  const ok = await kanban.doUpdate(epicId, null, newTasks);
  assert.strictEqual(ok, true, 'doUpdate should return true');

  await assert.rejects(fs.stat(markdownPath), /ENOENT/, 'markdown file should be replaced during migration');

  const updated = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  assert.deepStrictEqual(
    updated.subtasks,
    [
      { id: 'st-1', text: 'Nowe 1', done: false, description: 'Pierwszy subtask' },
      { id: 'st-2', text: 'Nowe 2', done: true, description: 'Drugi subtask' }
    ],
    'subtasks should be written to migrated JSON task file'
  );

  const parsed = await kanban.getTask(epicId);
  assert.strictEqual(parsed.description, 'Legacy markdown task', 'markdown description should survive migration');
  assert.strictEqual(parsed.notes, 'Legacy note', 'markdown notes should survive migration');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
