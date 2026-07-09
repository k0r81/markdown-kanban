const fs = require('fs').promises;
const path = require('path');

const BACKLOG = path.join(process.cwd(), 'backlog');
const COLS = ['active', 'planned', 'icebox', 'done'];
const STATUS_MAP = {
  active: 'in_progress',
  planned: 'planned',
  icebox: 'icebox',
  done: 'done'
};
const VIEW_FIELDS = {
  summary: ['id', 'title', 'column', 'epic_group', 'created', 'progress'],
  planning: [
    'id',
    'title',
    'column',
    'epic_group',
    'created',
    'progress',
    'description',
    'specs',
    'acceptance_criteria',
    'test_cases'
  ],
  execution: [
    'id',
    'title',
    'column',
    'epic_group',
    'created',
    'progress',
    'description',
    'specs',
    'acceptance_criteria',
    'test_cases',
    'subtasks'
  ],
  full: [
    'id',
    'title',
    'column',
    'epic_group',
    'created',
    'progress',
    'description',
    'specs',
    'acceptance_criteria',
    'test_cases',
    'subtasks',
    'notes'
  ]
};

function createKanbanError(code, message, hint, details = {}, retryable = false, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.hint = hint;
  error.details = details;
  error.retryable = retryable;
  error.status = status;
  return error;
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function stripTitlePrefix(title) {
  return String(title || '').replace(/^[\w.-]+:\s*/, '').trim();
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeSubtasks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((subtask, idx) => ({
    id: normalizeString(subtask && subtask.id, `st-${idx + 1}`),
    text: normalizeString(subtask && subtask.text),
    done: Boolean(subtask && subtask.done),
    description: normalizeString(subtask && subtask.description)
  })).filter((subtask) => subtask.text);
}

function withLegacyTaskAlias(task) {
  return {
    ...task,
    tasks: task.subtasks.map((subtask) => ({
      id: subtask.id,
      text: subtask.text,
      done: subtask.done,
      description: subtask.description
    }))
  };
}

function normalizeTask(task) {
  const normalized = {
    id: normalizeString(task.id),
    title: stripTitlePrefix(task.title || task.id),
    column: COLS.includes(task.column) ? task.column : 'planned',
    epic_group: normalizeString(task.epic_group, '—') || '—',
    created: normalizeString(task.created) || todayIso(),
    description: normalizeString(task.description),
    specs: normalizeString(task.specs),
    acceptance_criteria: normalizeStringArray(task.acceptance_criteria),
    test_cases: normalizeStringArray(task.test_cases),
    subtasks: normalizeSubtasks(task.subtasks || task.tasks),
    notes: normalizeString(task.notes)
  };

  return withLegacyTaskAlias(normalized);
}

function serializeTask(task) {
  const normalized = normalizeTask(task);
  return {
    id: normalized.id,
    title: normalized.title,
    column: normalized.column,
    epic_group: normalized.epic_group,
    created: normalized.created,
    description: normalized.description,
    specs: normalized.specs,
    acceptance_criteria: normalized.acceptance_criteria,
    test_cases: normalized.test_cases,
    subtasks: normalized.subtasks,
    notes: normalized.notes
  };
}

function getProgress(task) {
  const total = task.subtasks.length;
  const done = task.subtasks.filter((subtask) => subtask.done).length;
  return { done, total };
}

function pickFields(task, fieldNames) {
  const picked = {};

  for (const field of fieldNames) {
    if (field === 'progress') {
      picked.progress = getProgress(task);
      continue;
    }
    if (field === 'tasks') {
      picked.tasks = task.tasks;
      continue;
    }
    if (field in task) {
      picked[field] = task[field];
    }
  }

  return picked;
}

function shapeTask(task, options = {}) {
  const normalized = normalizeTask(task);
  const fields = Array.isArray(options.fields) && options.fields.length > 0
    ? options.fields
    : (VIEW_FIELDS[options.view || 'full'] || VIEW_FIELDS.full);

  return pickFields(normalized, fields);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(text, headings) {
  for (const heading of headings) {
    const regex = new RegExp(`^## ${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=^## |\\s*$)`, 'm');
    const match = text.match(regex);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

function parseListSection(sectionText) {
  if (!sectionText) return [];
  return sectionText
    .split('\n')
    .map((line) => line.match(/^[-*]\s+(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .filter(Boolean);
}

async function ensureBacklogDir() {
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    await fs.mkdir(colDir, { recursive: true });
  }
}

async function parseMarkdownTask(filePath, column) {
  const text = await fs.readFile(filePath, 'utf-8');
  const titleMatch = text.match(/^# (.+)$/m);
  const epicMatch = text.match(/^\*\*Epic:\*\*\s*(.+)$/m);
  const createdMatch = text.match(/^\*\*Created:\*\*\s*(.+)$/m);

  const subtasks = [];
  const taskRegex = /^- \[([ x])\] (.+)$/gm;
  let taskMatch;
  while ((taskMatch = taskRegex.exec(text)) !== null) {
    subtasks.push({
      id: `st-${subtasks.length + 1}`,
      done: taskMatch[1] === 'x',
      text: taskMatch[2].trim(),
      description: ''
    });
  }

  return normalizeTask({
    id: path.basename(filePath, '.md'),
    title: titleMatch ? titleMatch[1] : path.basename(filePath, '.md'),
    column,
    epic_group: epicMatch ? epicMatch[1].trim() : '—',
    created: createdMatch ? createdMatch[1].trim() : todayIso(),
    description: extractSection(text, ['Opis', 'Description']),
    specs: extractSection(text, ['Specs', 'Specyfikacja']),
    acceptance_criteria: parseListSection(extractSection(text, ['Acceptance Criteria', 'Kryteria Akceptacji'])),
    test_cases: parseListSection(extractSection(text, ['Test Cases', 'Przypadki Testowe'])),
    subtasks,
    notes: extractSection(text, ['Notes'])
  });
}

async function parseJsonTask(filePath, column) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch (error) {
    throw createKanbanError(
      'PARSE_ERROR',
      `Task file ${path.basename(filePath)} could not be parsed`,
      'Fix the JSON syntax or restore the file from version control',
      { file: filePath, reason: error.message },
      false,
      500
    );
  }

  return normalizeTask({
    ...data,
    id: data.id || path.basename(filePath, '.json'),
    column: column || data.column
  });
}

async function parseEpic(filePath, column) {
  if (filePath.endsWith('.json')) {
    return parseJsonTask(filePath, column);
  }
  return parseMarkdownTask(filePath, column);
}

async function allEpics() {
  const epics = [];

  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      const taskFiles = files
        .filter((file) => file.endsWith('.json') || file.endsWith('.md'))
        .sort((left, right) => {
          const leftBase = path.basename(left, path.extname(left));
          const rightBase = path.basename(right, path.extname(right));
          if (leftBase !== rightBase) return leftBase.localeCompare(rightBase);
          return left.endsWith('.json') ? -1 : 1;
        });
      const seen = new Set();

      for (const file of taskFiles) {
        const taskId = path.basename(file, path.extname(file));
        if (seen.has(taskId)) continue;
        seen.add(taskId);

        try {
          epics.push(await parseEpic(path.join(colDir, file), col));
        } catch (error) {
          console.error(`  parse error ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return epics;
}

async function findFile(epicId) {
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      const candidates = files
        .filter((file) => (file.endsWith('.json') || file.endsWith('.md'))
          && path.basename(file, path.extname(file)) === epicId)
        .sort((left, right) => (left.endsWith('.json') ? -1 : 1));
      if (candidates[0]) {
        return path.join(colDir, candidates[0]);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function getTask(taskId) {
  const filePath = await findFile(taskId);
  if (!filePath) {
    throw createKanbanError(
      'TASK_NOT_FOUND',
      `Task ${taskId} was not found`,
      'Call kanban_read with operation=list to discover valid task ids',
      { task_id: taskId },
      false,
      404
    );
  }

  const column = path.basename(path.dirname(filePath));
  return parseEpic(filePath, column);
}

async function writeTask(task, previousFilePath = null) {
  const normalized = normalizeTask(task);
  await ensureBacklogDir();

  const nextFilePath = path.join(BACKLOG, normalized.column, `${normalized.id}.json`);
  await fs.writeFile(nextFilePath, JSON.stringify(serializeTask(normalized), null, 2) + '\n', 'utf-8');

  if (previousFilePath && path.resolve(previousFilePath) !== path.resolve(nextFilePath)) {
    await fs.unlink(previousFilePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  return parseJsonTask(nextFilePath, normalized.column);
}

async function migrateAll(options = {}) {
  await ensureBacklogDir();
  const migrated = [];
  const errors = [];

  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    let files;
    try {
      files = await fs.readdir(colDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }

    const mdFiles = files
      .filter((file) => file.endsWith('.md'))
      .map((file) => ({
        name: file,
        taskId: path.basename(file, '.md')
      }));

    for (const { name, taskId } of mdFiles) {
      const mdPath = path.join(colDir, name);
      const jsonPath = path.join(colDir, `${taskId}.json`);

      try {
        const task = await parseMarkdownTask(mdPath, col);

        if (options.dryRun) {
          migrated.push({ id: taskId, from: mdPath, to: jsonPath });
          continue;
        }

        await writeTask(task);
        await fs.unlink(mdPath).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        migrated.push({ id: taskId, from: mdPath, to: jsonPath });
      } catch (error) {
        errors.push({ file: mdPath, reason: error.message });
      }
    }
  }

  return { migrated, errors };
}

async function nextPiNumber() {
  const ids = [];

  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      for (const file of files) {
        const match = file.match(/^PI-(\d+)/);
        if (match) ids.push(parseInt(match[1], 10));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function validateColumn(column, fieldName = 'column') {
  if (!COLS.includes(column)) {
    throw createKanbanError(
      'INVALID_COLUMN',
      `Column ${column} is not valid`,
      `Use one of: ${COLS.join(', ')}`,
      { [fieldName]: column, valid_columns: COLS },
      false,
      400
    );
  }
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw createKanbanError(
      'VALIDATION_ERROR',
      'patch must be an object',
      'Send a JSON object with only the fields you want to update',
      { patch },
      false,
      400
    );
  }
}

async function doCreate(title, column = 'planned', epicGroup = '—', extra = {}) {
  if (!normalizeString(title)) {
    throw createKanbanError(
      'MISSING_REQUIRED_FIELD',
      'title is required',
      'Provide a non-empty title when creating a task',
      { field: 'title' },
      false,
      400
    );
  }

  validateColumn(column, 'col');

  const nextId = await nextPiNumber();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 25);
  const task = normalizeTask({
    id: `PI-${String(nextId).padStart(3, '0')}-${slug || 'task'}`,
    title,
    column,
    epic_group: epicGroup || '—',
    created: todayIso(),
    description: extra.description,
    specs: extra.specs,
    acceptance_criteria: extra.acceptance_criteria,
    test_cases: extra.test_cases,
    subtasks: extra.subtasks,
    notes: extra.notes
  });

  return writeTask(task);
}

async function updateTask(taskId, patch) {
  validatePatch(patch);

  const previousFilePath = await findFile(taskId);
  if (!previousFilePath) {
    throw createKanbanError(
      'TASK_NOT_FOUND',
      `Task ${taskId} was not found`,
      'Call kanban_read with operation=list to discover valid task ids',
      { task_id: taskId },
      false,
      404
    );
  }

  const current = await parseEpic(previousFilePath, path.basename(path.dirname(previousFilePath)));
  const next = { ...current };

  if (patch.column !== undefined) {
    validateColumn(patch.column);
    next.column = patch.column;
  }
  if (patch.title !== undefined) {
    const title = normalizeString(patch.title);
    if (!title) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'title must be a non-empty string',
        'Send a non-empty title or omit the field',
        { field: 'title' },
        false,
        400
      );
    }
    next.title = title;
  }
  if (patch.epic_group !== undefined) next.epic_group = normalizeString(patch.epic_group, '—') || '—';
  if (patch.description !== undefined) next.description = normalizeString(patch.description);
  if (patch.specs !== undefined) next.specs = normalizeString(patch.specs);
  if (patch.acceptance_criteria !== undefined) {
    if (!Array.isArray(patch.acceptance_criteria)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'acceptance_criteria must be an array of strings',
        'Send acceptance_criteria as an array',
        { field: 'acceptance_criteria' },
        false,
        400
      );
    }
    next.acceptance_criteria = patch.acceptance_criteria;
  }
  if (patch.test_cases !== undefined) {
    if (!Array.isArray(patch.test_cases)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'test_cases must be an array of strings',
        'Send test_cases as an array',
        { field: 'test_cases' },
        false,
        400
      );
    }
    next.test_cases = patch.test_cases;
  }
  if (patch.subtasks !== undefined || patch.tasks !== undefined) {
    const subtasks = patch.subtasks !== undefined ? patch.subtasks : patch.tasks;
    if (!Array.isArray(subtasks)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'subtasks must be an array',
        'Send subtasks as an array of objects',
        { field: 'subtasks' },
        false,
        400
      );
    }
    next.subtasks = subtasks;
  }
  if (patch.notes !== undefined) next.notes = normalizeString(patch.notes);

  return writeTask(next, previousFilePath);
}

async function doMove(epicId, target) {
  try {
    await updateTask(epicId, { column: target });
    return true;
  } catch (error) {
    if (error.code === 'TASK_NOT_FOUND' || error.code === 'INVALID_COLUMN') {
      return false;
    }
    throw error;
  }
}

async function doToggle(epicId, idx) {
  try {
    const task = await getTask(epicId);
    if (!Number.isInteger(idx) || idx < 0 || idx >= task.subtasks.length) {
      throw createKanbanError(
        'INVALID_SUBTASK_INDEX',
        `Subtask index ${idx} is not valid for task ${epicId}`,
        'Read the task first and use an index between 0 and subtasks.length - 1',
        { task_id: epicId, idx, total_subtasks: task.subtasks.length },
        false,
        400
      );
    }

    const subtasks = task.subtasks.map((subtask, subtaskIdx) => ({
      ...subtask,
      done: subtaskIdx === idx ? !subtask.done : subtask.done
    }));
    await updateTask(epicId, { subtasks });
    return true;
  } catch (error) {
    if (error.code === 'TASK_NOT_FOUND' || error.code === 'INVALID_SUBTASK_INDEX') {
      return false;
    }
    throw error;
  }
}

async function doUpdate(epicId, newTitle, newTasks) {
  try {
    const patch = {};
    if (newTitle !== null) patch.title = newTitle;
    if (newTasks !== null) patch.subtasks = newTasks;
    await updateTask(epicId, patch);
    return true;
  } catch (error) {
    if (error.code === 'TASK_NOT_FOUND' || error.code === 'VALIDATION_ERROR') {
      return false;
    }
    throw error;
  }
}

module.exports = {
  ensureBacklogDir,
  parseEpic,
  allEpics,
  findFile,
  getTask,
  shapeTask,
  updateTask,
  migrateAll,
  doMove,
  doToggle,
  doUpdate,
  doCreate,
  createKanbanError,
  getProgress,
  COLS,
  STATUS_MAP,
  VIEW_FIELDS
};
