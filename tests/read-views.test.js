const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-views-'));
  const backlogDir = path.join(tempRoot, 'backlog', 'planned');
  await fs.mkdir(backlogDir, { recursive: true });

  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));
  const task = await kanban.doCreate('Read views', 'planned', 'Phase 1', {
    description: 'Planning context',
    specs: 'Technical specs',
    acceptance_criteria: ['One', 'Two'],
    subtasks: [{ text: 'Ship it', description: 'Execution detail' }],
    notes: 'Extra notes'
  });

  const summary = kanban.shapeTask(task, { view: 'summary' });
  assert.deepStrictEqual(
    Object.keys(summary),
    ['id', 'title', 'column', 'epic_group', 'created', 'progress'],
    'summary view should only expose compact fields'
  );

  const planning = kanban.shapeTask(task, { view: 'planning' });
  assert.strictEqual(planning.description, 'Planning context');
  assert.strictEqual(planning.specs, 'Technical specs');
  assert.deepStrictEqual(planning.acceptance_criteria, ['One', 'Two']);
  assert.ok(!('subtasks' in planning), 'planning view should omit subtasks');

  const explicit = kanban.shapeTask(task, { fields: ['title', 'description', 'subtasks'] });
  assert.deepStrictEqual(Object.keys(explicit), ['title', 'description', 'subtasks']);
  assert.strictEqual(explicit.subtasks[0].description, 'Execution detail');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
