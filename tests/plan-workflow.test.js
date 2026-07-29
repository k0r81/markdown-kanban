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
  const text = payload.result && payload.result.content && payload.result.content[0]
    ? payload.result.content[0].text
    : undefined;

  return {
    envelope: payload,
    text,
    parsed: text ? JSON.parse(text) : undefined
  };
}

function runCli(root, args) {
  const cliPath = path.join(__dirname, '..', 'bin', 'kanban.js');
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf-8'
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function run() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbango-plan-'));
  process.chdir(tempRoot);

  const kanban = require(path.join(__dirname, '..', 'kanban.js'));
  const plan = require(path.join(__dirname, '..', 'plan.js'));

  console.log('Testing detectTestRunner...');

  // 1. Env override
  process.env.OPENCODE_TEST_COMMAND = 'npm run test:unit';
  let runner = await plan.detectTestRunner(tempRoot);
  assert.strictEqual(runner.command, 'npm run test:unit');
  assert.strictEqual(runner.reason, 'OPENCODE_TEST_COMMAND override');
  delete process.env.OPENCODE_TEST_COMMAND;

  // 2. Cargo.toml
  const cargoPath = path.join(tempRoot, 'Cargo.toml');
  await fs.writeFile(cargoPath, '[package]\nname = "test"', 'utf-8');
  runner = await plan.detectTestRunner(tempRoot);
  assert.strictEqual(runner.command, 'cargo test');
  assert.strictEqual(runner.reason, 'Cargo.toml detected');
  await fs.unlink(cargoPath);

  // 3. go.mod
  const goModPath = path.join(tempRoot, 'go.mod');
  await fs.writeFile(goModPath, 'module test', 'utf-8');
  runner = await plan.detectTestRunner(tempRoot);
  assert.strictEqual(runner.command, 'go test ./...');
  assert.strictEqual(runner.reason, 'go.mod detected');
  await fs.unlink(goModPath);

  // 4. pyproject.toml
  const pyprojectPath = path.join(tempRoot, 'pyproject.toml');
  await fs.writeFile(pyprojectPath, '[tool.pytest]', 'utf-8');
  runner = await plan.detectTestRunner(tempRoot);
  assert.strictEqual(runner.command, 'python -m pytest');
  assert.strictEqual(runner.reason, 'Python test configuration detected');
  await fs.unlink(pyprojectPath);

  // 5. package.json script test
  const pkgPath = path.join(tempRoot, 'package.json');
  await fs.writeFile(pkgPath, JSON.stringify({ scripts: { test: 'jest' } }), 'utf-8');
  runner = await plan.detectTestRunner(tempRoot);
  assert.strictEqual(runner.command, 'npm test');
  assert.strictEqual(runner.reason, 'package.json test script detected');

  // 6. package.json + pnpm-lock.yaml
  const pnpmLockPath = path.join(tempRoot, 'pnpm-lock.yaml');
  await fs.writeFile(pnpmLockPath, '', 'utf-8');
  runner = await plan.detectTestRunner(tempRoot);
  assert.strictEqual(runner.command, 'pnpm test');
  assert.strictEqual(runner.reason, 'pnpm-lock.yaml and package.json test script detected');
  await fs.unlink(pnpmLockPath);

  // 7. No test runner throws error
  await fs.unlink(pkgPath);
  await assert.rejects(
    () => plan.detectTestRunner(tempRoot),
    (err) => err.code === 'NO_TEST_RUNNER'
  );

  console.log('Testing plan module workflow directly...');

  // Mock a package.json so plan.create finds a runner
  await fs.writeFile(pkgPath, JSON.stringify({ scripts: { test: 'node test.js' } }), 'utf-8');

  // plan.create
  const planResult = await plan.create({
    title: 'Test plan task',
    description: 'This is a description',
    steps: ['Step A', 'Step B'],
    project_root: tempRoot
  });

  assert.strictEqual(planResult.ok, true);
  assert.strictEqual(planResult.task_id, '001');
  assert.strictEqual(planResult.subtasks.length, 5); // Write tests, Run red, Step A, Step B, Run green
  assert.deepStrictEqual(planResult.subtasks.map(s => s.text), [
    'Write tests',
    'Run tests and confirm red',
    'Step A',
    'Step B',
    'Run tests and confirm green'
  ]);
  assert.strictEqual(planResult.runner.command, 'npm test');

  // plan.status
  let statusResult = await plan.status('001');
  assert.strictEqual(statusResult.status, 'active');
  assert.strictEqual(statusResult.evidence.length, 0);

  // plan.advance
  let advanceResult = await plan.advance({ task_id: '001' });
  assert.strictEqual(advanceResult.subtasks[0].done, true);
  assert.strictEqual(advanceResult.subtasks[1].done, false);
  assert.strictEqual(advanceResult.current_step, 1);

  // plan.advance specific index
  advanceResult = await plan.advance({ task_id: '001', index: 2 }); // Advance "Step A"
  assert.strictEqual(advanceResult.subtasks[2].done, true);
  assert.strictEqual(advanceResult.subtasks[1].done, false);

  // plan.evidence
  let evidenceResult = await plan.evidence({
    task_id: '001',
    diff: '+++ file.js',
    test_command: 'npm test',
    stdout: 'Tests run',
    stderr: '',
    exit_code: 0
  });
  assert.strictEqual(evidenceResult.ok, true);
  assert.strictEqual(evidenceResult.evidence.diff, '+++ file.js');
  assert.strictEqual(evidenceResult.evidence.exit_code, 0);

  // plan.evidence missing fields validation
  await assert.rejects(
    () => plan.evidence({ task_id: '001', diff: '+++' }),
    (err) => err.code === 'MISSING_REQUIRED_FIELD'
  );

  // plan.done (fails because some steps are still false)
  await assert.rejects(
    () => plan.done({ task_id: '001' }),
    (err) => err.code === 'PLAN_INCOMPLETE'
  );

  // complete remaining steps
  await plan.advance({ task_id: '001', index: 1 }); // Run red
  await plan.advance({ task_id: '001', index: 3 }); // Step B
  await plan.advance({ task_id: '001', index: 4 }); // Run green

  // plan.done succeeds now
  const doneResult = await plan.done({ task_id: '001' });
  assert.strictEqual(doneResult.status, 'done');

  const finalTask = await kanban.getTask('001');
  assert.strictEqual(finalTask.column, 'done');
  assert.strictEqual(finalTask.plan.status, 'done');

  console.log('Testing CLI plan commands...');

  // Setup fresh task
  await fs.unlink(path.join(tempRoot, 'backlog', 'done', '001.json'));

  const cliCreate = runCli(tempRoot, [
    'plan',
    'create',
    '--json',
    JSON.stringify({
      title: 'CLI plan task',
      steps: ['CLI step'],
      project_root: tempRoot
    })
  ]);
  assert.strictEqual(cliCreate.status, 0);
  const cliCreateData = JSON.parse(cliCreate.stdout);
  assert.strictEqual(cliCreateData.ok, true);
  assert.strictEqual(cliCreateData.task_id, '001');
  assert.strictEqual(cliCreateData.subtasks.length, 4); // Write, Run red, CLI step, Run green

  const cliStatus = runCli(tempRoot, [
    'plan',
    'status',
    '--json',
    JSON.stringify({ task_id: '001' })
  ]);
  assert.strictEqual(cliStatus.status, 0);
  const cliStatusData = JSON.parse(cliStatus.stdout);
  assert.strictEqual(cliStatusData.status, 'active');

  console.log('Testing MCP plan actions...');

  // Clear backlog
  await fs.unlink(path.join(tempRoot, 'backlog', 'planned', '001.json'));

  // Test MCP tools list to check plan schemas exist
  const listRes = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  });
  const manageTool = listRes.envelope.result.tools.find(t => t.name === 'kanban_manage');
  assert.ok(manageTool);
  assert.ok(manageTool.inputSchema.properties.action.enum.includes('plan_create'));

  // MCP plan_create
  const mcpCreate = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'plan_create',
        title: 'MCP plan task',
        steps: ['MCP step'],
        project_root: tempRoot
      }
    }
  });
  assert.strictEqual(mcpCreate.envelope.result.isError, undefined);
  assert.strictEqual(mcpCreate.parsed.ok, true);
  assert.strictEqual(mcpCreate.parsed.task_id, '001');

  // MCP plan_status
  const mcpStatus = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'plan_status',
        task_id: '001'
      }
    }
  });
  assert.strictEqual(mcpStatus.parsed.status, 'active');

  // MCP plan_advance
  const mcpAdvance = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'plan_advance',
        task_id: '001'
      }
    }
  });
  assert.strictEqual(mcpAdvance.parsed.subtasks[0].done, true);

  // MCP plan_evidence
  const mcpEvidence = callMcp(tempRoot, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'kanban_manage',
      arguments: {
        action: 'plan_evidence',
        task_id: '001',
        diff: '+++ file.js',
        test_command: 'npm test',
        stdout: 'Green',
        stderr: '',
        exit_code: 0
      }
    }
  });
  assert.strictEqual(mcpEvidence.parsed.evidence.diff, '+++ file.js');

  console.log('✓ All plan-workflow tests passed successfully!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
