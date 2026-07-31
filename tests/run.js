const { spawnSync } = require('child_process');
const path = require('path');

function runNode(scriptPath, args, label) {
  const fullPath = path.join(process.cwd(), scriptPath);
  const result = spawnSync(process.execPath, [fullPath, ...(args || [])], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`✗ ${label} failed`);
    process.exit(result.status || 1);
  }
  console.log(`✓ ${label}`);
}

runNode(path.join('bin', 'kanban.js'), ['list', '--json'], 'CLI list');
runNode(path.join('tests', 'update-tasks.test.js'), [], 'Update tasks test');
runNode(path.join('tests', 'read-views.test.js'), [], 'Read views test');
runNode(path.join('tests', 'mcp-server.test.js'), [], 'MCP server test');
runNode(path.join('tests', 'gui-port.test.js'), [], 'GUI port test');
runNode(path.join('tests', 'plan-workflow.test.js'), [], 'Plan workflow test');
runNode(path.join('tests', 'agent-playbook.test.js'), [], 'Agent playbook test');
runNode(path.join('tests', 'epics.test.js'), [], 'Epics test');
runNode(path.join('tests', 'delete-archive.test.js'), [], 'Delete/archive test');
