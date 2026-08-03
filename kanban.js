const fs = require('fs').promises;
const path = require('path');

const BACKLOG = path.join(process.cwd(), 'backlog');
const EPICS_DIR = path.join(BACKLOG, 'epics');
const COLS = ['active', 'planned', 'icebox', 'done'];
const STATUS_MAP = {
  active: 'in_progress',
  planned: 'planned',
  icebox: 'icebox',
  done: 'done'
};
const VIEW_FIELDS = {
  summary: ['task_number', 'title', 'column', 'epic_id', 'epic_group', 'created', 'progress'],
  planning: [
    'task_number',
    'title',
    'column',
    'epic_id',
    'epic_group',
    'created',
    'progress',
    'description',
    'specs',
    'in_scope',
    'out_of_scope',
    'acceptance_criteria',
    'test_cases'
  ],
  execution: [
    'task_number',
    'title',
    'column',
    'epic_id',
    'epic_group',
    'created',
    'progress',
    'description',
    'specs',
    'in_scope',
    'out_of_scope',
    'acceptance_criteria',
    'test_cases',
    'subtasks'
  ],
  full: [
    'task_number',
    'title',
    'column',
    'epic_id',
    'epic_group',
    'created',
    'progress',
    'description',
    'specs',
    'in_scope',
    'out_of_scope',
    'acceptance_criteria',
    'test_cases',
    'subtasks',
    'notes'
  ]
};

const EPIC_VIEW_FIELDS = {
  summary: ['id', 'title', 'created', 'status', 'archived', 'progress'],
  planning: [
    'id',
    'title',
    'created',
    'status',
    'archived',
    'progress',
    'description',
    'goals',
    'in_scope',
    'out_of_scope'
  ],
  full: [
    'id',
    'title',
    'created',
    'status',
    'archived',
    'progress',
    'description',
    'goals',
    'in_scope',
    'out_of_scope',
    'notes',
    'tasks'
  ]
};

const LIVE_EPIC_STATUSES = ['empty', 'planned', 'active'];

// Hard-required on create: title only (keeps GUI/CLI quick-add usable).
// Strongly recommended for agent/planned work — missing ones yield warnings, not errors.
const RECOMMENDED_CREATE_FIELDS = [
  'description',
  'specs',
  'in_scope',
  'out_of_scope',
  'acceptance_criteria'
];

const RECOMMENDED_EPIC_CREATE_FIELDS = [
  'description',
  'goals',
  'in_scope',
  'out_of_scope'
];

function createKanbanError(code, message, hint, details = {}, retryable = false, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.hint = hint;
  error.details = details;
  error.retryable = retryable;
  error.status = status;
  return error;
}

// Serialize board mutations so concurrent create/move/update cannot race on ids or paths.
let mutationTail = Promise.resolve();

function withBoardLock(fn) {
  const run = mutationTail.then(() => fn());
  mutationTail = run.then(() => undefined, () => undefined);
  return run;
}

function isTaskOrEpicDataFile(file) {
  if (!file || file.startsWith('.')) return false;
  return file.endsWith('.json') || file.endsWith('.md');
}

async function writeFileAtomic(filePath, payload, { exclusive = false } = {}) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await fs.writeFile(tempPath, payload, 'utf-8');
  try {
    if (exclusive) {
      // Atomic create-if-absent: never exposes an empty final path to readers.
      await fs.link(tempPath, filePath);
      await fs.unlink(tempPath).catch(() => undefined);
    } else {
      await fs.rename(tempPath, filePath);
    }
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
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

function extractTaskNumber(taskId) {
  const match = normalizeString(taskId).match(/^(?:[A-Z]+-)?(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function isPresentCreateField(field, value) {
  if (
    field === 'description'
    || field === 'specs'
    || field === 'notes'
    || field === 'goals'
  ) {
    return Boolean(normalizeString(value));
  }
  if (
    field === 'in_scope' ||
    field === 'out_of_scope' ||
    field === 'acceptance_criteria' ||
    field === 'test_cases' ||
    field === 'subtasks'
  ) {
    if (field === 'subtasks') return normalizeSubtasks(value).length > 0;
    return normalizeStringArray(value).length > 0;
  }
  return value !== undefined && value !== null && value !== '';
}

function missingRecommendedCreateFields(payload = {}) {
  return RECOMMENDED_CREATE_FIELDS.filter((field) => !isPresentCreateField(field, payload[field]));
}

function missingRecommendedEpicCreateFields(payload = {}) {
  return RECOMMENDED_EPIC_CREATE_FIELDS.filter((field) => !isPresentCreateField(field, payload[field]));
}

function createFieldWarnings(payload = {}) {
  const missing = missingRecommendedCreateFields(payload);
  if (missing.length === 0) return [];
  return [
    `Strongly recommended fields missing: ${missing.join(', ')}. ` +
      'Fill them on create (or via update) so scope and done-criteria are explicit.'
  ];
}

function createEpicFieldWarnings(payload = {}) {
  const missing = missingRecommendedEpicCreateFields(payload);
  if (missing.length === 0) return [];
  return [
    `Strongly recommended epic fields missing: ${missing.join(', ')}. ` +
      'Fill them so agents get initiative context and boundaries.'
  ];
}

function normalizeEpicId(value) {
  const raw = normalizeString(value);
  if (!raw || raw === '—') return null;
  const match = raw.match(/^E0*(\d+)$/i);
  if (match) return `E${String(parseInt(match[1], 10)).padStart(3, '0')}`;
  return null;
}

function isBlankEpicRef(value) {
  const raw = normalizeString(value);
  return !raw || raw === '—';
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

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    diff: normalizeString(item && item.diff),
    test_command: normalizeString(item && item.test_command),
    stdout: normalizeString(item && item.stdout),
    stderr: normalizeString(item && item.stderr),
    exit_code: Number.isInteger(item && item.exit_code) ? item.exit_code : null,
    created: normalizeString(item && item.created) || todayIso()
  }));
}

function normalizePlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    runner: value.runner && typeof value.runner === 'object' ? value.runner : null,
    status: ['active', 'done'].includes(value.status) ? value.status : 'active'
  };
}

function normalizeTask(task) {
  const id = normalizeString(task.id);
  const epicId = normalizeEpicId(task.epic_id);
  const epicGroup = normalizeString(task.epic_group, '—') || '—';
  const normalized = {
    id,
    title: stripTitlePrefix(task.title || id),
    column: COLS.includes(task.column) ? task.column : 'planned',
    epic_id: epicId,
    epic_group: epicId ? (epicGroup === '—' ? epicId : epicGroup) : (epicGroup === '—' ? '—' : epicGroup),
    created: normalizeString(task.created) || todayIso(),
    description: normalizeString(task.description),
    specs: normalizeString(task.specs),
    in_scope: normalizeStringArray(task.in_scope),
    out_of_scope: normalizeStringArray(task.out_of_scope),
    acceptance_criteria: normalizeStringArray(task.acceptance_criteria),
    test_cases: normalizeStringArray(task.test_cases),
    subtasks: normalizeSubtasks(task.subtasks),
    notes: normalizeString(task.notes),
    plan: normalizePlan(task.plan),
    evidence: normalizeEvidence(task.evidence),
    task_number: extractTaskNumber(id)
  };

  return normalized;
}

function serializeTask(task) {
  const normalized = normalizeTask(task);
  return {
    id: normalized.id,
    title: normalized.title,
    column: normalized.column,
    epic_id: normalized.epic_id,
    epic_group: normalized.epic_group,
    created: normalized.created,
    description: normalized.description,
    specs: normalized.specs,
    in_scope: normalized.in_scope,
    out_of_scope: normalized.out_of_scope,
    acceptance_criteria: normalized.acceptance_criteria,
    test_cases: normalized.test_cases,
    subtasks: normalized.subtasks,
    notes: normalized.notes,
    plan: normalized.plan,
    evidence: normalized.evidence,
    task_number: normalized.task_number
  };
}

function normalizeEpic(epic) {
  const id = normalizeEpicId(epic && epic.id) || normalizeString(epic && epic.id);
  return {
    id,
    title: stripTitlePrefix((epic && epic.title) || id),
    created: normalizeString(epic && epic.created) || todayIso(),
    description: normalizeString(epic && epic.description),
    goals: normalizeString(epic && epic.goals),
    in_scope: normalizeStringArray(epic && epic.in_scope),
    out_of_scope: normalizeStringArray(epic && epic.out_of_scope),
    notes: normalizeString(epic && epic.notes),
    archived: Boolean(epic && epic.archived)
  };
}

function serializeEpic(epic) {
  const normalized = normalizeEpic(epic);
  return {
    id: normalized.id,
    title: normalized.title,
    created: normalized.created,
    description: normalized.description,
    goals: normalized.goals,
    in_scope: normalized.in_scope,
    out_of_scope: normalized.out_of_scope,
    notes: normalized.notes,
    archived: normalized.archived
  };
}

function deriveEpicStatus(tasks, epic) {
  if (epic && epic.archived) return 'archived';
  if (!tasks || tasks.length === 0) return 'empty';
  if (tasks.some((task) => task.column === 'active')) return 'active';
  if (tasks.every((task) => task.column === 'done')) return 'done';
  return 'planned';
}

function isLiveEpic(epicOrShaped) {
  if (!epicOrShaped) return false;
  if (epicOrShaped.archived) return false;
  if (epicOrShaped.status) return LIVE_EPIC_STATUSES.includes(epicOrShaped.status);
  return true;
}

function getEpicProgress(tasks) {
  const progress = {
    tasks_total: tasks.length,
    tasks_done: 0,
    tasks_active: 0,
    tasks_planned: 0,
    tasks_icebox: 0
  };
  for (const task of tasks) {
    if (task.column === 'done') progress.tasks_done += 1;
    else if (task.column === 'active') progress.tasks_active += 1;
    else if (task.column === 'planned') progress.tasks_planned += 1;
    else if (task.column === 'icebox') progress.tasks_icebox += 1;
  }
  return progress;
}

function pickEpicFields(epicPayload, fieldNames) {
  const picked = {};
  for (const field of fieldNames) {
    if (field in epicPayload) {
      picked[field] = epicPayload[field];
    }
  }
  return picked;
}

function shapeEpic(epic, tasks = [], options = {}) {
  const normalized = normalizeEpic(epic);
  const childTasks = tasks.filter((task) => task.epic_id === normalized.id);
  const payload = {
    ...normalized,
    status: deriveEpicStatus(childTasks, normalized),
    progress: getEpicProgress(childTasks),
    tasks: childTasks.map((task) => shapeTask(task, { view: 'summary' }))
  };
  const fields = Array.isArray(options.fields) && options.fields.length > 0
    ? options.fields
    : (EPIC_VIEW_FIELDS[options.view || 'full'] || EPIC_VIEW_FIELDS.full);
  return pickEpicFields(payload, fields);
}

function filterShapedEpics(shapedEpics, options = {}) {
  const statusFilter = normalizeString(options.status).toLowerCase() || null;
  if (statusFilter) {
    return shapedEpics.filter((epic) => epic.status === statusFilter);
  }

  // live_only=false: human/GUI board — everything except archived unless include_archived
  if (options.live_only === false) {
    if (options.include_archived) return shapedEpics;
    return shapedEpics.filter((epic) => !epic.archived);
  }

  // Default (agents): only empty|planned|active
  const includeArchived = Boolean(options.include_archived);
  const includeDone = Boolean(options.include_done);

  return shapedEpics.filter((epic) => {
    if (epic.archived) return includeArchived;
    if (epic.status === 'done') return includeDone || includeArchived;
    return isLiveEpic(epic);
  });
}

function archivedEpicIdSet(epics) {
  const set = new Set();
  for (const epic of epics) {
    if (epic.archived) set.add(epic.id);
  }
  return set;
}

function nonLiveEpicIdSet(epics, tasks, options = {}) {
  const includeArchived = Boolean(options.include_archived);
  const includeDone = Boolean(options.include_done);
  if (includeArchived && includeDone) return new Set();

  const hidden = new Set();
  for (const epic of epics) {
    const childTasks = tasks.filter((task) => task.epic_id === epic.id);
    const status = deriveEpicStatus(childTasks, epic);
    if (status === 'archived' && !includeArchived) hidden.add(epic.id);
    else if (status === 'done' && !includeDone && !includeArchived) hidden.add(epic.id);
  }
  return hidden;
}

function filterTasksForList(tasks, epics, options = {}) {
  // Explicit epic filter (show that epic's tasks) is applied by caller after this.
  // Default agent list: hide tasks under done/archived epics.
  if (options.include_archived && options.include_done) return tasks;
  // GUI path: hide only archived-epic tasks (done epics still show done cards)
  if (options.live_only === false) {
    if (options.include_archived) return tasks;
    const archivedIds = archivedEpicIdSet(epics);
    if (archivedIds.size === 0) return tasks;
    return tasks.filter((task) => !task.epic_id || !archivedIds.has(task.epic_id));
  }

  const hiddenIds = nonLiveEpicIdSet(epics, tasks, options);
  if (hiddenIds.size === 0) return tasks;
  return tasks.filter((task) => !task.epic_id || !hiddenIds.has(task.epic_id));
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
  await fs.mkdir(EPICS_DIR, { recursive: true });
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
    in_scope: parseListSection(extractSection(text, ['In Scope', 'W Zakresie'])),
    out_of_scope: parseListSection(extractSection(text, ['Out of Scope', 'Poza Zakresem'])),
    acceptance_criteria: parseListSection(extractSection(text, ['Acceptance Criteria', 'Kryteria Akceptacji'])),
    test_cases: parseListSection(extractSection(text, ['Test Cases', 'Przypadki Testowe'])),
    subtasks,
    notes: extractSection(text, ['Notes'])
  });
}

async function parseJsonTask(filePath, column) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw createKanbanError(
      'PARSE_ERROR',
      `Task file ${path.basename(filePath)} could not be read`,
      'Fix permissions or restore the file from version control',
      { file: filePath, reason: error.message },
      false,
      500
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
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
        .filter((file) => isTaskOrEpicDataFile(file))
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
          // File may vanish between readdir and read under concurrent delete.
          if (error.code === 'ENOENT') continue;
          console.error(`  parse error ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return epics;
}

async function allTasks() {
  return allEpics();
}

function epicFilePath(epicId) {
  return path.join(EPICS_DIR, `${epicId}.json`);
}

async function nextEpicNumber() {
  await ensureBacklogDir();
  const ids = [];
  try {
    const files = await fs.readdir(EPICS_DIR);
    for (const file of files) {
      if (!isTaskOrEpicDataFile(file)) continue;
      const match = file.match(/^E0*(\d+)\.json$/i);
      if (match) ids.push(parseInt(match[1], 10));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

async function parseJsonEpic(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw createKanbanError(
      'PARSE_ERROR',
      `Epic file ${path.basename(filePath)} could not be read`,
      'Fix permissions or restore the file from version control',
      { file: filePath, reason: error.message },
      false,
      500
    );
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw createKanbanError(
      'PARSE_ERROR',
      `Epic file ${path.basename(filePath)} could not be parsed`,
      'Fix the JSON syntax or restore the file from version control',
      { file: filePath, reason: error.message },
      false,
      500
    );
  }
  return normalizeEpic({
    ...data,
    id: data.id || path.basename(filePath, '.json')
  });
}

async function listEpicEntities() {
  await ensureBacklogDir();
  const epics = [];
  try {
    const files = (await fs.readdir(EPICS_DIR))
      .filter((file) => isTaskOrEpicDataFile(file) && file.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right));
    for (const file of files) {
      try {
        epics.push(await parseJsonEpic(path.join(EPICS_DIR, file)));
      } catch (error) {
        console.error(`  parse error ${file}: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return epics;
}

async function writeEpic(epic, { exclusive = false } = {}) {
  const normalized = normalizeEpic(epic);
  if (!normalizeEpicId(normalized.id)) {
    throw createKanbanError(
      'VALIDATION_ERROR',
      'epic id must look like E001',
      'Use an epic id such as E001',
      { epic_id: normalized.id },
      false,
      400
    );
  }
  await ensureBacklogDir();
  const filePath = epicFilePath(normalized.id);
  const payload = JSON.stringify(serializeEpic(normalized), null, 2) + '\n';
  await writeFileAtomic(filePath, payload, { exclusive });
  return parseJsonEpic(filePath);
}

async function getEpicEntity(epicId) {
  const id = normalizeEpicId(epicId) || normalizeString(epicId);
  if (!id) {
    throw createKanbanError(
      'EPIC_NOT_FOUND',
      `Epic ${epicId} was not found`,
      'Call kanban_read with operation=list_epics to discover valid epic ids',
      { epic_id: epicId },
      false,
      404
    );
  }
  const filePath = epicFilePath(normalizeEpicId(id) || id);
  try {
    return await parseJsonEpic(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'PARSE_ERROR') {
      if (error.code === 'PARSE_ERROR') throw error;
      throw createKanbanError(
        'EPIC_NOT_FOUND',
        `Epic ${epicId} was not found`,
        'Call kanban_read with operation=list_epics to discover valid epic ids',
        { epic_id: epicId },
        false,
        404
      );
    }
    throw error;
  }
}

async function findEpicsByTitle(title) {
  const needle = normalizeString(title).toLowerCase();
  if (!needle) return [];
  const epics = await listEpicEntities();
  return epics.filter((epic) => epic.title.toLowerCase() === needle);
}

async function resolveEpicRef(ref, options = {}) {
  if (isBlankEpicRef(ref)) {
    return { epic_id: null, epic_group: '—' };
  }

  const asId = normalizeEpicId(ref);
  if (asId) {
    const epic = await getEpicEntity(asId);
    return { epic_id: epic.id, epic_group: epic.title };
  }

  const matches = await findEpicsByTitle(ref);
  if (matches.length === 1) {
    return { epic_id: matches[0].id, epic_group: matches[0].title };
  }
  if (matches.length > 1) {
    throw createKanbanError(
      'AMBIGUOUS_EPIC',
      `Multiple epics titled "${normalizeString(ref)}"`,
      'Use an epic id (E001) instead of the title',
      { title: normalizeString(ref), epic_ids: matches.map((epic) => epic.id) },
      false,
      400
    );
  }

  if (options.createIfMissing) {
    const created = options.skipLock
      ? await createEpicRecord(normalizeString(ref), {})
      : await doCreateEpic(normalizeString(ref), {});
    return { epic_id: created.id, epic_group: created.title };
  }

  throw createKanbanError(
    'EPIC_NOT_FOUND',
    `Epic "${normalizeString(ref)}" was not found`,
    'Create it with epic_create or pass an existing epic id/title',
    { epic: normalizeString(ref) },
    false,
    404
  );
}

async function createEpicRecord(title, extra = {}) {
  if (!normalizeString(title)) {
    throw createKanbanError(
      'MISSING_REQUIRED_FIELD',
      'title is required',
      'Provide a non-empty title when creating an epic',
      { field: 'title' },
      false,
      400
    );
  }

  for (let attempt = 0; attempt < 32; attempt++) {
    const nextId = await nextEpicNumber();
    const epic = normalizeEpic({
      id: `E${String(nextId).padStart(3, '0')}`,
      title,
      created: todayIso(),
      description: extra.description,
      goals: extra.goals,
      in_scope: extra.in_scope,
      out_of_scope: extra.out_of_scope,
      notes: extra.notes
    });
    try {
      return await writeEpic(epic, { exclusive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw createKanbanError(
    'CREATE_CONFLICT',
    'Could not allocate a unique epic id',
    'Retry the create operation',
    { title },
    true,
    409
  );
}

async function doCreateEpic(title, extra = {}) {
  return withBoardLock(() => createEpicRecord(title, extra));
}

async function updateEpicEntity(epicId, patch) {
  validatePatch(patch);
  return withBoardLock(async () => {
    const current = await getEpicEntity(epicId);
    const next = { ...current };

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
    if (patch.description !== undefined) next.description = normalizeString(patch.description);
    if (patch.goals !== undefined) next.goals = normalizeString(patch.goals);
    if (patch.in_scope !== undefined) {
      if (!Array.isArray(patch.in_scope)) {
        throw createKanbanError(
          'VALIDATION_ERROR',
          'in_scope must be an array of strings',
          'Send in_scope as an array',
          { field: 'in_scope' },
          false,
          400
        );
      }
      next.in_scope = normalizeStringArray(patch.in_scope);
    }
    if (patch.out_of_scope !== undefined) {
      if (!Array.isArray(patch.out_of_scope)) {
        throw createKanbanError(
          'VALIDATION_ERROR',
          'out_of_scope must be an array of strings',
          'Send out_of_scope as an array',
          { field: 'out_of_scope' },
          false,
          400
        );
      }
      next.out_of_scope = normalizeStringArray(patch.out_of_scope);
    }
    if (patch.notes !== undefined) next.notes = normalizeString(patch.notes);
    if (patch.archived !== undefined) next.archived = Boolean(patch.archived);

    const saved = await writeEpic(next);

    if (patch.title !== undefined && saved.title !== current.title) {
      const tasks = await allTasks();
      for (const task of tasks) {
        if (task.epic_id === saved.id && task.epic_group !== saved.title) {
          await updateTaskRecord(task.id, { epic_group: saved.title, _skipEpicResolve: true });
        }
      }
    }

    return saved;
  });
}

async function archiveEpic(epicId) {
  return updateEpicEntity(epicId, { archived: true });
}

async function unarchiveEpic(epicId) {
  return updateEpicEntity(epicId, { archived: false });
}

async function deleteTaskRecord(taskId) {
  const resolvedId = await resolveTaskId(taskId);
  const filePath = await findFile(resolvedId);
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
  const task = await parseEpic(filePath, column);
  await fs.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await removeOtherTaskCopies(task.id, path.join(BACKLOG, '__none__', `${task.id}.json`));

  return {
    ok: true,
    task_id: task.id,
    task_number: task.task_number,
    title: task.title,
    column: task.column
  };
}

async function deleteTask(taskId) {
  return withBoardLock(() => deleteTaskRecord(taskId));
}

async function deleteEpic(epicId) {
  return withBoardLock(async () => {
  const epic = await getEpicEntity(epicId);
  const tasks = await allTasks();
  const children = tasks.filter((task) => task.epic_id === epic.id);
  const deletedTasks = [];

  for (const child of children) {
    const result = await deleteTaskRecord(child.id);
    deletedTasks.push({
      task_id: result.task_id,
      title: result.title,
      column: result.column
    });
  }

  const filePath = epicFilePath(epic.id);
  await fs.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });

  return {
    ok: true,
    epic_id: epic.id,
    title: epic.title,
    deleted_tasks: deletedTasks,
    deleted_task_count: deletedTasks.length
  };
  });
}

async function migrateEpicGroups(options = {}) {
  await ensureBacklogDir();
  const tasks = await allTasks();
  const existing = await listEpicEntities();
  const byTitle = new Map(existing.map((epic) => [epic.title.toLowerCase(), epic]));
  const created = [];
  const linked = [];
  const dryRun = Boolean(options.dryRun);

  const labels = new Set();
  for (const task of tasks) {
    if (!task.epic_id && task.epic_group && task.epic_group !== '—') {
      labels.add(task.epic_group);
    }
  }

  for (const label of labels) {
    const key = label.toLowerCase();
    let epic = byTitle.get(key);
    if (!epic) {
      if (dryRun) {
        created.push({ title: label });
        epic = { id: `(new)`, title: label };
      } else {
        epic = await doCreateEpic(label, {
          description: `Migrated from epic_group label "${label}".`
        });
        created.push({ id: epic.id, title: epic.title });
      }
      byTitle.set(key, epic);
    }
  }

  for (const task of tasks) {
    if (task.epic_id || !task.epic_group || task.epic_group === '—') continue;
    const epic = byTitle.get(task.epic_group.toLowerCase());
    if (!epic || !epic.id || epic.id === '(new)') {
      linked.push({ task_id: task.id, epic_group: task.epic_group, dry_run: true });
      continue;
    }
    if (!dryRun) {
      await updateTask(task.id, {
        epic_id: epic.id,
        epic_group: epic.title,
        _skipEpicResolve: true
      });
    }
    linked.push({ task_id: task.id, epic_id: epic.id, epic_group: epic.title });
  }

  return { created, linked, dry_run: dryRun };
}

function taskMatchesEpicFilter(task, epicFilter) {
  if (isBlankEpicRef(epicFilter)) return true;
  const asId = normalizeEpicId(epicFilter);
  if (asId) return task.epic_id === asId;
  const needle = normalizeString(epicFilter).toLowerCase();
  return task.epic_group.toLowerCase() === needle
    || (task.epic_id && task.epic_id.toLowerCase() === needle);
}

async function findFile(epicId) {
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      const candidates = files
        .filter((file) => isTaskOrEpicDataFile(file)
          && path.basename(file, path.extname(file)) === epicId)
        .sort((left, _right) => (left.endsWith('.json') ? -1 : 1));
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
  const resolvedId = await resolveTaskId(taskId);
  const filePath = await findFile(resolvedId);
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

async function resolveTaskId(input) {
  if (!input) return null;

  const exact = await findFile(String(input));
  if (exact) return String(input);

  const num = parseInt(String(input), 10);
  if (!Number.isFinite(num)) return null;

  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      const rawPattern = new RegExp(`^(?:[A-Z]+-)?${String(num)}(?:-|$)`);
      const paddedPattern = new RegExp(`^(?:[A-Z]+-)?${String(num).padStart(3, '0')}(?:-|$)`);
      const match = files.find((file) => {
        const base = path.basename(file, path.extname(file));
        return rawPattern.test(base) || paddedPattern.test(base + '-');
      });
      if (match) return path.basename(match, path.extname(match));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return String(input);
}

async function removeOtherTaskCopies(taskId, keepPath) {
  const keep = path.resolve(keepPath);
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      for (const file of files) {
        if (!isTaskOrEpicDataFile(file)) continue;
        if (path.basename(file, path.extname(file)) !== taskId) continue;
        const candidate = path.join(colDir, file);
        if (path.resolve(candidate) === keep) continue;
        await fs.unlink(candidate).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function writeTask(task, previousFilePath = null, { exclusive = false } = {}) {
  const normalized = normalizeTask(task);
  await ensureBacklogDir();

  const nextFilePath = path.join(BACKLOG, normalized.column, `${normalized.id}.json`);
  const payload = JSON.stringify(serializeTask(normalized), null, 2) + '\n';
  await writeFileAtomic(nextFilePath, payload, { exclusive });

  if (previousFilePath && path.resolve(previousFilePath) !== path.resolve(nextFilePath)) {
    await fs.unlink(previousFilePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  await removeOtherTaskCopies(normalized.id, nextFilePath);

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
      .filter((file) => isTaskOrEpicDataFile(file) && file.endsWith('.md'))
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

async function nextTaskNumber() {
  const ids = [];

  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      for (const file of files) {
        if (!isTaskOrEpicDataFile(file)) continue;
        const match = file.match(/^(?:[A-Z]+-)?(\d+)/);
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

async function doCreate(title, column = 'planned', epicRef = '—', extra = {}) {
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

  return withBoardLock(async () => {
    let epicLink = { epic_id: null, epic_group: '—' };
    if (!isBlankEpicRef(epicRef)) {
      epicLink = await resolveEpicRef(epicRef, { createIfMissing: true, skipLock: true });
    } else if (extra.epic_id) {
      epicLink = await resolveEpicRef(extra.epic_id, { createIfMissing: false, skipLock: true });
    }

    for (let attempt = 0; attempt < 32; attempt++) {
      const nextId = await nextTaskNumber();
      const task = normalizeTask({
        id: String(nextId).padStart(3, '0'),
        title,
        column,
        epic_id: epicLink.epic_id,
        epic_group: epicLink.epic_group,
        created: todayIso(),
        description: extra.description,
        specs: extra.specs,
        in_scope: extra.in_scope,
        out_of_scope: extra.out_of_scope,
        acceptance_criteria: extra.acceptance_criteria,
        test_cases: extra.test_cases,
        subtasks: extra.subtasks,
        notes: extra.notes,
        plan: extra.plan,
        evidence: extra.evidence
      });
      try {
        return await writeTask(task, null, { exclusive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    throw createKanbanError(
      'CREATE_CONFLICT',
      'Could not allocate a unique task id',
      'Retry the create operation',
      { title },
      true,
      409
    );
  });
}

async function updateTaskRecord(taskId, patch) {
  const resolvedId = await resolveTaskId(taskId);
  const previousFilePath = await findFile(resolvedId);
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
  if (!patch._skipEpicResolve) {
    if (patch.epic_id !== undefined || patch.epic !== undefined || patch.epic_group !== undefined) {
      const ref = patch.epic_id !== undefined
        ? patch.epic_id
        : (patch.epic !== undefined ? patch.epic : patch.epic_group);
      if (isBlankEpicRef(ref)) {
        next.epic_id = null;
        next.epic_group = '—';
      } else {
        const link = await resolveEpicRef(ref, {
          createIfMissing: Boolean(
            patch.epic_group !== undefined && patch.epic_id === undefined && patch.epic === undefined
          ),
          skipLock: true
        });
        next.epic_id = link.epic_id;
        next.epic_group = link.epic_group;
      }
    }
  } else {
    if (patch.epic_id !== undefined) next.epic_id = normalizeEpicId(patch.epic_id);
    if (patch.epic_group !== undefined) next.epic_group = normalizeString(patch.epic_group, '—') || '—';
  }
  if (patch.description !== undefined) next.description = normalizeString(patch.description);
  if (patch.specs !== undefined) next.specs = normalizeString(patch.specs);
  if (patch.in_scope !== undefined) {
    if (!Array.isArray(patch.in_scope)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'in_scope must be an array of strings',
        'Send in_scope as an array',
        { field: 'in_scope' },
        false,
        400
      );
    }
    next.in_scope = patch.in_scope;
  }
  if (patch.out_of_scope !== undefined) {
    if (!Array.isArray(patch.out_of_scope)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'out_of_scope must be an array of strings',
        'Send out_of_scope as an array',
        { field: 'out_of_scope' },
        false,
        400
      );
    }
    next.out_of_scope = patch.out_of_scope;
  }
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
  if (patch.subtasks !== undefined) {
    if (!Array.isArray(patch.subtasks)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'subtasks must be an array',
        'Send subtasks as an array of objects',
        { field: 'subtasks' },
        false,
        400
      );
    }
    next.subtasks = patch.subtasks;
  }
  if (patch.notes !== undefined) next.notes = normalizeString(patch.notes);
  if (patch.plan !== undefined) next.plan = patch.plan;
  if (patch.evidence !== undefined) {
    if (!Array.isArray(patch.evidence)) {
      throw createKanbanError(
        'VALIDATION_ERROR',
        'evidence must be an array',
        'Send evidence as an array of evidence objects',
        { field: 'evidence' },
        false,
        400
      );
    }
    next.evidence = patch.evidence;
  }

  return writeTask(next, previousFilePath);
}

async function updateTask(taskId, patch) {
  validatePatch(patch);
  return withBoardLock(() => updateTaskRecord(taskId, patch));
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
  allTasks,
  findFile,
  getTask,
  shapeTask,
  shapeEpic,
  updateTask,
  migrateAll,
  migrateEpicGroups,
  doMove,
  doToggle,
  doUpdate,
  doCreate,
  doCreateEpic,
  updateEpicEntity,
  archiveEpic,
  unarchiveEpic,
  deleteTask,
  deleteEpic,
  getEpicEntity,
  listEpicEntities,
  resolveEpicRef,
  taskMatchesEpicFilter,
  filterShapedEpics,
  filterTasksForList,
  isLiveEpic,
  createKanbanError,
  createFieldWarnings,
  createEpicFieldWarnings,
  missingRecommendedCreateFields,
  missingRecommendedEpicCreateFields,
  getProgress,
  getEpicProgress,
  deriveEpicStatus,
  resolveTaskId,
  COLS,
  STATUS_MAP,
  VIEW_FIELDS,
  EPIC_VIEW_FIELDS,
  LIVE_EPIC_STATUSES,
  RECOMMENDED_CREATE_FIELDS,
  RECOMMENDED_EPIC_CREATE_FIELDS,
  EPICS_DIR
};
