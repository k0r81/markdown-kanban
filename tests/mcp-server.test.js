const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function callMcp(root, request) {
  const serverPath = path.join(__dirname, '..', 'mcp-server.js');
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: root,
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `MCP server exited with ${result.status}`);
  }

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const payload = JSON.parse(lines[lines.length - 1]);
  return JSON.parse(payload.result.content[0].text);
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-mcp-'));
  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));

  const task = await kanban.doCreate('MCP task', 'planned', 'MCP', {
    description: 'Context',
    specs: 'Specs',
    acceptance_criteria: ['Works'],
    subtasks: [{ text: 'Do it', description: 'Detail' }],
    notes: 'Note'
  });

  const summary = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'show', task_id: task.id, view: 'summary' }
    }
  });
  assert.deepStrictEqual(
    Object.keys(summary),
    ['id', 'title', 'column', 'epic_group', 'created', 'progress'],
    'kanban_read summary view should be compact'
  );

  const updated = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_update',
      arguments: {
        operation: 'update',
        task_id: task.id,
        patch: { description: 'Updated context' },
        return: 'summary'
      }
    }
  });
  assert.ok(!('description' in updated), 'summary return should omit description');

  const errorResult = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'show', task_id: 'PI-999-missing' }
    }
  });
  assert.strictEqual(errorResult.error.code, 'TASK_NOT_FOUND');
  assert.ok(errorResult.error.hint.includes('kanban_read'));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
