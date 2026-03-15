#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// Find Python executable
function findPython() {
  const pyCommands = os.platform() === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  
  for (const cmd of pyCommands) {
    try {
      const result = require('child_process').spawnSync(cmd, ['--version'], { stdio: 'ignore' });
      if (result.status === 0) {
        return cmd;
      }
    } catch (e) {
      continue;
    }
  }
  throw new Error('Python not found. Please install Python 3.7+');
}

// Main execution
const python = findPython();
const scriptPath = path.join(__dirname, '..', 'kanban.py');
const args = process.argv.slice(2);

const child = spawn(python, [scriptPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Error running kanban.py:', err.message);
  process.exit(1);
});
