const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-kanban-'));
  const backlogDir = path.join(tempRoot, 'backlog', 'active');
  await fs.mkdir(backlogDir, { recursive: true });

  const epicId = 'PI-001-test';
  const filePath = path.join(backlogDir, `${epicId}.md`);
  const initial = `# PI-001: Test

**Status:** in_progress
**Epic:** —
**Created:** 2026-03-17

## Opis
—

## Taski
- [ ] Stare 1
- [x] Stare 2

## Notes
—
`;
  await fs.writeFile(filePath, initial, 'utf-8');

  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));

  const newTasks = [
    { text: 'Nowe 1', done: false },
    { text: 'Nowe 2', done: true },
  ];

  const ok = await kanban.doUpdate(epicId, null, newTasks);
  assert.strictEqual(ok, true, 'doUpdate should return true');

  const updated = await fs.readFile(filePath, 'utf-8');
  const taskiMatches = updated.match(/## Taski/g) || [];
  assert.strictEqual(taskiMatches.length, 1, 'Taski section should not duplicate');

  const blockMatch = updated.match(/## Taski\s*\n([\s\S]*?)\n## Notes/);
  assert.ok(blockMatch, 'Taski section should be followed by Notes');
  const taskBlock = blockMatch[1].trim();
  assert.strictEqual(
    taskBlock,
    '- [ ] Nowe 1\n- [x] Nowe 2',
    'Taski section should be replaced, not appended'
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
