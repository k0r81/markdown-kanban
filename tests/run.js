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
