const fs = require('fs').promises;
const path = require('path');
const kanban = require('./kanban.js');

function planError(code, message, hint, details = {}) {
  return kanban.createKanbanError(code, message, hint, details, false, 400);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectTestRunner(projectRoot = process.cwd()) {
  const override = String(process.env.OPENCODE_TEST_COMMAND || '').trim();
  if (override) return { command: override, reason: 'OPENCODE_TEST_COMMAND override' };

  if (await exists(path.join(projectRoot, 'Cargo.toml'))) {
    return { command: 'cargo test', reason: 'Cargo.toml detected' };
  }
  if (await exists(path.join(projectRoot, 'go.mod'))) {
    return { command: 'go test ./...', reason: 'go.mod detected' };
  }
  if (await exists(path.join(projectRoot, 'pyproject.toml'))
    || await exists(path.join(projectRoot, 'pytest.ini'))) {
    return { command: 'python -m pytest', reason: 'Python test configuration detected' };
  }

  const packagePath = path.join(projectRoot, 'package.json');
  if (await exists(packagePath)) {
    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
    } catch (error) {
      throw planError('TEST_RUNNER_ERROR', 'package.json could not be parsed',
        'Fix package.json before creating a plan', { reason: error.message });
    }
    if (pkg.scripts && pkg.scripts.test) {
      const lockfiles = [
        ['pnpm-lock.yaml', 'pnpm test'],
        ['yarn.lock', 'yarn test'],
        ['bun.lockb', 'bun test'],
        ['bun.lock', 'bun test']
      ];
      for (const [lockfile, command] of lockfiles) {
        if (await exists(path.join(projectRoot, lockfile))) {
          return { command, reason: `${lockfile} and package.json test script detected` };
        }
      }
      return { command: 'npm test', reason: 'package.json test script detected' };
    }
  }

  throw planError('NO_TEST_RUNNER', 'No supported test runner was found',
    'Add a supported project manifest or set OPENCODE_TEST_COMMAND', { project_root: projectRoot });
}

function planSubtasks(implementationSteps) {
  const steps = [
    'Write tests',
    'Run tests and confirm red',
    ...implementationSteps,
    'Run tests and confirm green'
  ];
  return steps.map((text, index) => ({ id: `st-${index + 1}`, text, done: false, description: '' }));
}

function result(task, extra = {}) {
  return {
    ok: true,
    task_id: task.id,
    subtasks: task.subtasks,
    ...extra
  };
}

async function create(payload = {}) {
  if (!payload.title || typeof payload.title !== 'string') {
    throw planError('MISSING_REQUIRED_FIELD', 'title is required', 'Provide the accepted plan title', { field: 'title' });
  }
  const implementationSteps = Array.isArray(payload.steps) ? payload.steps.filter(Boolean).map(String) : [];
  const runner = await detectTestRunner(payload.project_root || process.cwd());
  const task = await kanban.doCreate(payload.title, payload.column || 'planned', payload.epic || '—', {
    description: payload.description,
    specs: payload.specs,
    in_scope: payload.in_scope,
    out_of_scope: payload.out_of_scope,
    acceptance_criteria: payload.acceptance_criteria,
    test_cases: payload.test_cases,
    subtasks: planSubtasks(implementationSteps),
    notes: payload.notes,
    plan: { runner, status: 'active' },
    evidence: []
  });
  return result(task, { runner });
}

async function advance(payload = {}) {
  const task = await kanban.getTask(payload.task_id);
  const index = payload.index !== undefined ? Number(payload.index)
    : task.subtasks.findIndex((subtask) => !subtask.done);
  if (!Number.isInteger(index) || index < 0 || index >= task.subtasks.length) {
    throw planError('INVALID_SUBTASK_INDEX', 'No valid plan step was provided',
      'Provide the zero-based index of an incomplete subtask', { index, total_subtasks: task.subtasks.length });
  }
  const subtasks = task.subtasks.map((subtask, subtaskIndex) => ({
    ...subtask,
    done: subtaskIndex === index ? true : subtask.done
  }));
  const updated = await kanban.updateTask(task.id, { subtasks });
  return result(updated, { current_step: updated.subtasks.findIndex((subtask) => !subtask.done) });
}

async function evidence(payload = {}) {
  const required = ['diff', 'test_command', 'stdout', 'stderr', 'exit_code'];
  for (const field of required) {
    if (payload[field] === undefined) {
      throw planError('MISSING_REQUIRED_FIELD', `${field} is required`,
        'Provide diff, test_command, stdout, stderr, and exit_code', { field });
    }
  }
  if (!Number.isInteger(payload.exit_code)) {
    throw planError('VALIDATION_ERROR', 'exit_code must be an integer',
      'Use the process exit code from the test command', { field: 'exit_code' });
  }
  const task = await kanban.getTask(payload.task_id);
  const entry = {
    diff: String(payload.diff),
    test_command: String(payload.test_command),
    stdout: String(payload.stdout),
    stderr: String(payload.stderr),
    exit_code: payload.exit_code,
    created: new Date().toISOString()
  };
  const updated = await kanban.updateTask(task.id, { evidence: [...task.evidence, entry] });
  return result(updated, { evidence: entry });
}

async function done(payload = {}) {
  const task = await kanban.getTask(payload.task_id);
  const incomplete = task.subtasks.filter((subtask) => !subtask.done);
  if (incomplete.length > 0) {
    throw planError('PLAN_INCOMPLETE', 'Plan has incomplete subtasks',
      'Advance every plan step before marking the workflow done', { incomplete });
  }
  const updated = await kanban.updateTask(task.id, { column: 'done', plan: { ...task.plan, status: 'done' } });
  return result(updated, { status: 'done' });
}

async function status(taskId) {
  const task = await kanban.getTask(taskId);
  return result(task, { status: task.plan && task.plan.status || 'active', evidence: task.evidence });
}

module.exports = { detectTestRunner, create, advance, evidence, done, status };
