#!/usr/bin/env node

const kanban = require('../kanban.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKLOG = path.join(process.cwd(), 'backlog');
const COLS = kanban.COLS;
const STATUS_MAP = kanban.STATUS_MAP;

function shortId(epicId) {
  const match = epicId.match(/^(PI-\d+[\w.]*|BUG-\d+|CHORE-\d+)/);
  return match ? match[1] : epicId;
}

function displayTitle(epic) {
  return epic.title.replace(/^[\w.-]+:\s*/, '');
}

function mcpCommand(useNpx) {
  if (useNpx) {
    return { command: 'npx', args: ['-y', 'markdown-kanban', 'mcp'] };
  }
  return { command: 'node', args: ['./node_modules/markdown-kanban/mcp-server.js'] };
}

function claudeMcpConfig(useNpx) {
  const cmd = mcpCommand(useNpx);
  return {
    mcpServers: {
      'markdown-kanban': cmd
    }
  };
}

function openCodeMcpConfig(useNpx) {
  const cmd = useNpx
    ? ['npx', '-y', 'markdown-kanban', 'mcp']
    : ['node', './node_modules/markdown-kanban/mcp-server.js'];
  
  return {
    '$schema': 'https://opencode.ai/config.json',
    mcp: {
      'markdown-kanban': {
        type: 'local',
        command: cmd,
        enabled: true
      }
    }
  };
}

async function writeJsonConfig(filePath, data, force) {
  if (fs.existsSync(filePath) && !force) {
    return { status: 'skipped' };
  }
  
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(data, null, 2) + '\n',
    'utf-8'
  );
  
  return { status: 'written' };
}

async function cliInit() {
  await kanban.ensureBacklogDir();
  const readme = path.join(BACKLOG, 'README.md');
  
  if (!fs.existsSync(readme)) {
    await fs.promises.writeFile(readme, 
      '# Backlog\n\nUtworzony przez kanban.js\n\n'
      + '## Struktura\n'
      + '- `active/`  — w trakcie (max 1-2)\n'
      + '- `planned/` — zaplanowane\n'
      + '- `icebox/`  — zamrożone / nice-to-have\n'
      + '- `done/`    — ukończone\n',
      'utf-8'
    );
  }
  
  console.log(`✓ Backlog w: ${BACKLOG}`);
}

async function cliMcpInit(options) {
  const useNpx = options.useNpx;
  const force = options.force;
  const onlyClaude = options.onlyClaude;
  const onlyOpenCode = options.onlyOpenCode;
  const cwd = process.cwd();
  
  const targets = [];
  if (!onlyOpenCode) {
    targets.push({
      label: '.mcp.json (Claude Code)',
      filePath: path.join(cwd, '.mcp.json'),
      data: claudeMcpConfig(useNpx)
    });
  }
  if (!onlyClaude) {
    targets.push({
      label: 'opencode.json (OpenCode)',
      filePath: path.join(cwd, 'opencode.json'),
      data: openCodeMcpConfig(useNpx)
    });
  }
  
  for (const target of targets) {
    const result = await writeJsonConfig(target.filePath, target.data, force);
    if (result.status === 'skipped') {
      console.log(`• Pominięto ${target.label} (już istnieje)`);
    } else {
      console.log(`✓ Utworzono ${target.label}`);
    }
  }
  
  if (!force) {
    console.log('  (użyj --force, aby nadpisać istniejące pliki)');
  }
}

async function cliList(colFilter, epicFilter, asJson) {
  const epics = await kanban.allEpics();
  
  let filtered = epics;
  if (colFilter) {
    filtered = filtered.filter(e => e.column === colFilter);
  }
  if (epicFilter) {
    filtered = filtered.filter(e => e.epic_group === epicFilter);
  }
  
  if (asJson) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }
  
  if (filtered.length === 0) {
    console.log('(brak)');
    return;
  }
  
  for (const e of filtered) {
    const total = e.tasks.length;
    const done = e.tasks.filter(t => t.done).length;
    const prog = total ? `${done}/${total}` : '—';
    const title = displayTitle(e).substring(0, 42);
    console.log(
      `  ${e.column.padEnd(8)}  ${shortId(e.id).padEnd(8)}  ${title.padEnd(43)}  ${prog.padStart(5)}  [${e.epic_group}]`
    );
  }
}

async function cliShow(taskId) {
  const filePath = await kanban.findFile(taskId);
  if (!filePath) {
    console.error(`✗ Nie znaleziono: ${taskId}`);
    process.exit(1);
  }
  
  const col = COLS.find(c => filePath.includes(c)) || '?';
  const epic = await kanban.parseEpic(filePath, col);
  
  console.log(`ID:      ${shortId(epic.id)}`);
  console.log(`Plik:    ${filePath}`);
  console.log(`Tytuł:   ${displayTitle(epic)}`);
  console.log(`Kolumna: ${epic.column}`);
  console.log(`Epik:    ${epic.epic_group}`);
  console.log(`Worzono: ${epic.created || '—'}`);
  
  if (epic.tasks.length > 0) {
    console.log('Subtaski:');
    for (let i = 0; i < epic.tasks.length; i++) {
      const t = epic.tasks[i];
      const mark = t.done ? 'x' : ' ';
      console.log(`  [${i}] [${mark}] ${t.text}`);
    }
  }
}

async function cliMove(taskId, column) {
  const success = await kanban.doMove(taskId, column);
  if (success) {
    console.log(`✓ ${shortId(taskId)} → ${column}`);
  } else {
    console.error(`✗ Nie znaleziono: ${taskId}`);
    process.exit(1);
  }
}

async function cliAdd(title, column, epicGroup) {
  const epic = await kanban.doCreate(title, column, epicGroup);
  if (epic) {
    console.log(`✓ Utworzono ${shortId(epic.id)} w ${column}  [${epic.epic_group}]`);
    console.log(`  Plik: ${path.join(BACKLOG, column, epic.id + '.md')}`);
  } else {
    console.error('✗ Błąd tworzenia');
    process.exit(1);
  }
}

async function cliToggle(taskId, idx) {
  const success = await kanban.doToggle(taskId, idx);
  if (!success) {
    console.error(`✗ Nie znaleziono: ${taskId} subtask ${idx}`);
    process.exit(1);
  }
  
  const filePath = await kanban.findFile(taskId);
  if (filePath) {
    const col = COLS.find(c => filePath.includes(c)) || '?';
    const epic = await kanban.parseEpic(filePath, col);
    if (idx < epic.tasks.length) {
      const t = epic.tasks[idx];
      const mark = t.done ? '✓' : '○';
      console.log(`  [${idx}] ${mark} ${t.text}`);
    }
  }
}

async function serveWeb(port) {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = decodeURIComponent(url.pathname);
    
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
    } else if (path === '/api/board') {
      const epics = await kanban.allEpics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(epics));
    } else if (path === '/api/epics' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const epic = await kanban.doCreate(
          body.title || '',
          body.column || 'planned',
          body.epic_group || '—'
        );
        if (epic) {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(epic));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad params' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'PATCH') {
      const pathMatch = path.match(/^\/api\/epics\/([^/]+)\/move$/);
      if (pathMatch) {
        const epicId = pathMatch[1];
        const body = await readBody(req);
        const success = await kanban.doMove(epicId, body.column || '');
        if (success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
        }
        return;
      }
      
      const toggleMatch = path.match(/^\/api\/epics\/([^/]+)\/tasks\/(\d+)$/);
      if (toggleMatch) {
        const epicId = toggleMatch[1];
        const idx = parseInt(toggleMatch[2]);
        const success = await kanban.doToggle(epicId, idx);
        if (success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad index' }));
        }
        return;
      }
      
      const updateMatch = path.match(/^\/api\/epics\/([^/]+)$/);
      if (updateMatch) {
        const epicId = updateMatch[1];
        const body = await readBody(req);
        const ok = await kanban.doUpdate(
          epicId,
          body.title !== undefined ? body.title : null,
          body.tasks !== undefined ? body.tasks : null
        );
        if (ok) {
          const filePath = await kanban.findFile(epicId);
          if (filePath) {
            const col = COLS.find(c => filePath.includes(c)) || 'planned';
            const epic = await kanban.parseEpic(filePath, col);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(epic));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
        }
        return;
      }
      
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
  
  server.listen(port, 'localhost', () => {
    console.log(`\x1b[1;32m→ Kanban GUI: http://localhost:${port}\x1b[0m`);
    console.log(`  Backlog:   ${BACKLOG}`);
    console.log('  Ctrl+C żeby zamknąć');
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (!cmd || cmd === 'serve') {
    const port = parseInt(args[1] || '5500');
    await serveWeb(port);
  } else if (cmd === 'init') {
    await cliInit();
  } else if (cmd === 'mcp-init') {
    let useNpx = false;
    let onlyClaude = false;
    let onlyOpenCode = false;
    let force = false;
    
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--npx') {
        useNpx = true;
      } else if (args[i] === '--claude') {
        onlyClaude = true;
      } else if (args[i] === '--opencode') {
        onlyOpenCode = true;
      } else if (args[i] === '--force') {
        force = true;
      }
    }
    
    if (onlyClaude && onlyOpenCode) {
      onlyClaude = false;
      onlyOpenCode = false;
    }
    
    await cliMcpInit({ useNpx, onlyClaude, onlyOpenCode, force });
  } else if (cmd === 'list') {
    let colFilter = null;
    let epicFilter = null;
    let asJson = false;
    
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--col' && args[i + 1]) {
        colFilter = args[++i];
      } else if (args[i] === '--epic' && args[i + 1]) {
        epicFilter = args[++i];
      } else if (args[i] === '--json') {
        asJson = true;
      }
    }
    
    await cliList(colFilter, epicFilter, asJson);
  } else if (cmd === 'show' && args[1]) {
    await cliShow(args[1]);
  } else if (cmd === 'move' && args[1] && args[2]) {
    await cliMove(args[1], args[2]);
  } else if (cmd === 'add' && args[1]) {
    let column = 'planned';
    let epicGroup = '—';
    
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--col' && args[i + 1]) {
        column = args[++i];
      } else if (args[i] === '--epic' && args[i + 1]) {
        epicGroup = args[++i];
      }
    }
    
    await cliAdd(args[1], column, epicGroup);
  } else if (cmd === 'toggle' && args[1] && args[2]) {
    await cliToggle(args[1], parseInt(args[2]));
  } else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
