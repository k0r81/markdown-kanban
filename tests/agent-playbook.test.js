const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const fs = require('fs').promises;

function callMcp(root, request) {
  const serverPath = path.join(__dirname, '..', 'mcp-server.js');
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: root,
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf-8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `MCP exited ${result.status}`);
  }
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const payload = JSON.parse(lines[lines.length - 1]);
  const text = payload.result && payload.result.content && payload.result.content[0]
    ? payload.result.content[0].text
    : undefined;
  return { envelope: payload, text, parsed: text ? JSON.parse(text) : undefined };
}

async function run() {
  const playbook = require(path.join(__dirname, '..', 'agent-playbook.js'));

  for (const needle of playbook.MUST_CONTAIN) {
    const blob = Object.values(playbook.TOOL_DESCRIPTIONS).join('\n');
    assert.ok(blob.includes(needle), `playbook tools must mention ${needle}`);
  }
  assert.ok(playbook.DROP_IN_RULE.includes('return=none'));
  assert.ok(playbook.DROP_IN_RULE.includes('external_running'));

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-playbook-'));
  process.chdir(tempRoot);

  const listed = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  });
  const tools = listed.envelope.result.tools;
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  assert.strictEqual(
    byName.kanban_read.description,
    playbook.TOOL_DESCRIPTIONS.kanban_read,
    'tools/list kanban_read description must match agent-playbook.js'
  );
  assert.strictEqual(
    byName.kanban_manage.description,
    playbook.TOOL_DESCRIPTIONS.kanban_manage
  );
  assert.strictEqual(
    byName.kanban_gui.description,
    playbook.TOOL_DESCRIPTIONS.kanban_gui
  );
  assert.ok(byName.kanban_read.inputSchema.properties.operation.enum.includes('help'));

  const help = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_read',
      arguments: { operation: 'help' }
    }
  });
  assert.strictEqual(typeof help.text, 'string');
  assert.strictEqual(help.parsed.source, 'agent-playbook.js');
  assert.strictEqual(help.parsed.drop_in_rule, playbook.DROP_IN_RULE);
  assert.deepStrictEqual(help.parsed.tools, playbook.TOOL_DESCRIPTIONS);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
