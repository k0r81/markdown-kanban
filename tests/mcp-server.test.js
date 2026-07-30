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
  lines.forEach((line) => JSON.parse(line));
  const payload = JSON.parse(lines[lines.length - 1]);
  const text = payload.result && payload.result.content && payload.result.content[0]
    ? payload.result.content[0].text
    : undefined;

  return {
    envelope: payload,
    text,
    parsed: JSON.parse(text)
  };
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-mcp-'));
  process.chdir(tempRoot);
  const kanban = require(path.join(__dirname, '..', 'kanban.js'));
  const mcpServer = require(path.join(__dirname, '..', 'mcp-server.js'));

  assert.throws(
    () => mcpServer.serializeResult(undefined),
    (error) => error && error.code === 'INTERNAL_ERROR' && error.retryable === true,
    'undefined handler results should become structured internal errors'
  );

  const task = await kanban.doCreate('MCP task', 'planned', 'MCP', {
    description: 'Context',
    specs: 'Specs',
    in_scope: ['Core path'],
    out_of_scope: ['Mobile'],
    acceptance_criteria: ['Works'],
    subtasks: [{ text: 'Do it', description: 'Detail' }],
    notes: 'Note'
  });
  assert.deepStrictEqual(task.in_scope, ['Core path']);
  assert.deepStrictEqual(task.out_of_scope, ['Mobile']);
  assert.strictEqual(task.id, '001', 'new task IDs should be numeric and zero-padded');

  const summary = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'show', task_id: task.id, view: 'summary' }
    }
  });
  assert.strictEqual(typeof summary.text, 'string', 'kanban_read should always return textual content');
  assert.deepStrictEqual(
    Object.keys(summary.parsed),
    ['task_number', 'title', 'column', 'epic_id', 'epic_group', 'created', 'progress'],
    'kanban_read summary view should be compact'
  );

  const created = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'create',
        title: 'Created via MCP',
        col: 'planned',
        epic: 'MCP',
        description: 'Created through the MCP contract',
        in_scope: ['MCP create path'],
        out_of_scope: ['GUI-only flows'],
        acceptance_criteria: ['Returns a textual payload']
      }
    }
  });
  assert.strictEqual(typeof created.text, 'string', 'kanban_manage create should always return textual content');
  assert.strictEqual(created.envelope.result.isError, undefined, 'successful create should not be marked as an error');
  assert.strictEqual(created.parsed.title, 'Created via MCP');
  assert.deepStrictEqual(created.parsed.in_scope, ['MCP create path']);
  assert.deepStrictEqual(created.parsed.out_of_scope, ['GUI-only flows']);
  assert.ok(
    created.parsed.warnings && created.parsed.warnings.length > 0,
    'create without all recommended fields should include warnings'
  );
  assert.ok(
    created.parsed.missing_recommended.includes('specs'),
    'missing_recommended should list specs when omitted'
  );

  const fullCreate = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 21,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'create',
        title: 'Fully specified task',
        description: 'Context',
        specs: 'API constraints',
        in_scope: ['Core'],
        out_of_scope: ['Mobile'],
        acceptance_criteria: ['Tests pass']
      }
    }
  });
  assert.strictEqual(fullCreate.parsed.warnings, undefined, 'full create should not warn');
  assert.strictEqual(fullCreate.parsed.missing_recommended, undefined);

  const tasksAfterCreate = await kanban.allTasks();
  assert.strictEqual(
    tasksAfterCreate.filter((taskItem) => taskItem.title === 'Created via MCP').length,
    1,
    'create should persist exactly one task per request'
  );

  const updated = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'update',
        task_id: task.id,
        subtasks: [{ id: 'st-1', text: 'Do it', description: 'Detail', done: true }],
        return: 'summary'
      }
    }
  });
  assert.ok(!('description' in updated.parsed), 'summary return should omit description');
  assert.strictEqual(updated.parsed.progress.done, 1);
  assert.strictEqual(updated.parsed.progress.total, 1);

  const errorResult = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: { action: 'create' }
    }
  });
  assert.strictEqual(typeof errorResult.text, 'string', 'errors should still be returned as textual content');
  assert.strictEqual(errorResult.envelope.result.isError, true, 'invalid requests should be marked as errors');
  assert.strictEqual(errorResult.parsed.error.code, 'MISSING_REQUIRED_FIELD');
  assert.ok(errorResult.parsed.error.hint.includes('title'));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
