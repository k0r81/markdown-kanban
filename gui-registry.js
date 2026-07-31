const fs = require('fs').promises;
const path = require('path');

const BACKLOG = path.join(process.cwd(), 'backlog');
const GUI_PORT_FILE = '.kanbango-gui.json';
const GUI_PORT_MIN = 5510;
const GUI_PORT_MAX = 5999;
const GUI_PORT_SPAN = GUI_PORT_MAX - GUI_PORT_MIN + 1;

function createGuiError(code, message, hint, details = {}, retryable = false, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.hint = hint;
  error.details = details;
  error.retryable = retryable;
  error.status = status;
  return error;
}

function guiPortFilePath() {
  return path.join(BACKLOG, GUI_PORT_FILE);
}

function projectLabel(cwd = process.cwd()) {
  const fromEnv = process.env.KANBANGO_PROJECT_NAME;
  if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).trim()) {
    return String(fromEnv).trim();
  }
  const base = path.basename(String(cwd || '').replace(/[/\\]+$/, ''));
  return base || 'kanban';
}

function hashCwdToPort(cwd = process.cwd()) {
  let hash = 0;
  const input = String(cwd);
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return GUI_PORT_MIN + (Math.abs(hash) % GUI_PORT_SPAN);
}

function normalizeGuiPort(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function resolvePreferredGuiPort(explicitPort) {
  if (explicitPort !== undefined && explicitPort !== null && explicitPort !== '') {
    const fromArg = normalizeGuiPort(explicitPort);
    if (fromArg) return fromArg;
  }

  const fromEnv = normalizeGuiPort(process.env.KANBANGO_GUI_PORT);
  if (fromEnv) return fromEnv;

  return hashCwdToPort(process.cwd());
}

function isPidAlive(pid) {
  const n = Number.parseInt(pid, 10);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureBacklogDir() {
  await fs.mkdir(BACKLOG, { recursive: true });
}

async function writeGuiPortFile({ port, pid = process.pid } = {}) {
  const normalizedPort = normalizeGuiPort(port);
  if (!normalizedPort) {
    throw createGuiError(
      'VALIDATION_ERROR',
      'Invalid GUI port',
      'Use an integer between 1 and 65535',
      { port },
      false,
      400
    );
  }

  await ensureBacklogDir();
  const cwd = process.cwd();
  const data = {
    port: normalizedPort,
    pid,
    url: `http://localhost:${normalizedPort}`,
    cwd,
    project: projectLabel(cwd),
    started_at: new Date().toISOString()
  };
  await fs.writeFile(guiPortFilePath(), JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

async function readGuiPortFile() {
  try {
    const raw = await fs.readFile(guiPortFilePath(), 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !normalizeGuiPort(data.port)) return null;
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

async function clearGuiPortFile({ pid, force = false } = {}) {
  const info = await readGuiPortFile();
  if (!info) return false;
  if (!force && pid !== undefined && info.pid !== pid) return false;
  if (!force && pid === undefined && info.pid !== process.pid) return false;

  try {
    await fs.unlink(guiPortFilePath());
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function discoverRunningGui() {
  const info = await readGuiPortFile();
  if (!info || !isPidAlive(info.pid)) {
    if (info) await clearGuiPortFile({ force: true });
    return null;
  }
  return {
    status: 'running',
    port: info.port,
    pid: info.pid,
    url: info.url || `http://localhost:${info.port}`,
    cwd: info.cwd,
    project: info.project || projectLabel(info.cwd),
    started_at: info.started_at
  };
}

module.exports = {
  projectLabel,
  hashCwdToPort,
  normalizeGuiPort,
  resolvePreferredGuiPort,
  isPidAlive,
  writeGuiPortFile,
  readGuiPortFile,
  clearGuiPortFile,
  discoverRunningGui,
  guiPortFilePath,
  GUI_PORT_MIN,
  GUI_PORT_MAX
};
