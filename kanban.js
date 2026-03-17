const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const BACKLOG = path.join(process.cwd(), 'backlog');
const COLS = ["active", "planned", "icebox", "done"];
const STATUS_MAP = {
  active: "in_progress",
  planned: "planned",
  icebox: "icebox",
  done: "done",
};

async function ensureBacklogDir() {
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    await fs.mkdir(colDir, { recursive: true });
  }
}

async function parseEpic(filePath, column) {
  const text = await fs.readFile(filePath, 'utf-8');
  
  const titleMatch = text.match(/^# (.+)$/m);
  const epicMatch = text.match(/^\*\*Epic:\*\*\s*(.+)$/m);
  const createdMatch = text.match(/^\*\*Created:\*\*\s*(.+)$/m);
  
  const tasks = [];
  const taskRegex = /^- \[([ x])\] (.+)$/gm;
  let taskMatch;
  while ((taskMatch = taskRegex.exec(text)) !== null) {
    tasks.push({
      done: taskMatch[1] === 'x',
      text: taskMatch[2]
    });
  }
  
  const rawGroup = epicMatch ? epicMatch[1].trim() : '—';
  const epicGroup = (rawGroup && rawGroup !== '—') ? rawGroup : '—';
  
  return {
    id: path.basename(filePath, '.md'),
    title: titleMatch ? titleMatch[1] : path.basename(filePath, '.md'),
    column,
    tasks,
    epic_group: epicGroup,
    created: createdMatch ? createdMatch[1].trim() : null,
  };
}

async function allEpics() {
  const epics = [];
  
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      const mdFiles = files.filter(f => f.endsWith('.md')).sort();
      
      for (const file of mdFiles) {
        try {
          const filePath = path.join(colDir, file);
          const epic = await parseEpic(filePath, col);
          epics.push(epic);
        } catch (e) {
          console.error(`  ⚠ parse error ${file}: ${e}`);
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  
  return epics;
}

async function findFile(epicId) {
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      for (const file of files) {
        if (file.endsWith('.md') && path.basename(file, '.md') === epicId) {
          return path.join(colDir, file);
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return null;
}

async function doMove(epicId, target) {
  if (!COLS.includes(target)) return false;
  
  const filePath = await findFile(epicId);
  if (!filePath) return false;
  
  const newFilePath = path.join(BACKLOG, target, path.basename(filePath));
  await fs.rename(filePath, newFilePath);
  
  let text = await fs.readFile(newFilePath, 'utf-8');
  text = text.replace(/\*\*Status:\*\* \S+/, `**Status:** ${STATUS_MAP[target]}`);
  await fs.writeFile(newFilePath, text, 'utf-8');
  
  return true;
}

async function doToggle(epicId, idx) {
  const filePath = await findFile(epicId);
  if (!filePath) return false;
  
  let text = await fs.readFile(filePath, 'utf-8');
  
  const taskRegex = /^- \[([ x])\] .+$/gm;
  let match;
  const tasks = [];
  while ((match = taskRegex.exec(text)) !== null) {
    tasks.push({
      start: match.index,
      end: match.index + match[0].length,
      checkboxPos: match.index + 3,
      current: match[1],
    });
  }
  
  if (idx >= tasks.length) return false;
  
  const task = tasks[idx];
  const newChar = task.current === ' ' ? 'x' : ' ';
  text = text.substring(0, task.checkboxPos) + newChar + text.substring(task.checkboxPos + 1);
  
  await fs.writeFile(filePath, text, 'utf-8');
  return true;
}

async function doUpdate(epicId, newTitle, newTasks) {
  const filePath = await findFile(epicId);
  if (!filePath) return false;
  
  let text = await fs.readFile(filePath, 'utf-8');
  
  if (newTitle !== null) {
    text = text.replace(/^# (.+)$/m, (match) => {
      const full = match;
      const prefix = /^([\w.-]+:\s*)/.exec(full);
      return prefix ? `# ${prefix[1]}${newTitle}` : `# ${newTitle}`;
    }, 1);
  }
  
  if (newTasks !== null) {
    const taskText = newTasks
      .filter(t => t.text && t.text.trim())
      .map(t => `- [${t.done ? 'x' : ' '}] ${t.text}`)
      .join('\n');
    
    if (/## Taski\s*\n/.test(text)) {
      text = text.replace(
        /## Taski\s*\n([\s\S]*?)(?=\n## |\s*$)/,
        () => `## Taski\n\n${taskText}\n`
      );
    } else {
      text += `\n\n## Taski\n\n${taskText}\n`;
    }
  }
  
  await fs.writeFile(filePath, text, 'utf-8');
  return true;
}

async function doCreate(title, column, epicGroup = '—') {
  if (!title || !COLS.includes(column)) return null;
  
  let ids = [];
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      for (const file of files) {
        const match = file.match(/^PI-(\d+)/);
        if (match) {
          ids.push(parseInt(match[1]));
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  
  const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 25);
  
  const fileName = `PI-${nextId.toString().padStart(3, '0')}-${slug}.md`;
  const filePath = path.join(BACKLOG, column, fileName);
  
  await ensureBacklogDir();
  
  const today = new Date().toISOString().split('T')[0];
  const content = `# PI-${nextId.toString().padStart(3, '0')}: ${title}

**Status:** ${STATUS_MAP[column]}
**Epic:** ${epicGroup || '—'}
**Created:** ${today}

## Opis
—

## Taski
- [ ] 

## Notes
—
`;
  
  await fs.writeFile(filePath, content, 'utf-8');
  return parseEpic(filePath, column);
}

module.exports = {
  ensureBacklogDir,
  parseEpic,
  allEpics,
  findFile,
  doMove,
  doToggle,
  doUpdate,
  doCreate,
  COLS,
  STATUS_MAP,
};
