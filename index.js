/**
 * markdown-kanban - Markdown-based Kanban board
 * 
 * This package provides a local Kanban board with web GUI and CLI.
 * Tasks are stored as Markdown files in a `backlog/` directory.
 * 
 * @module markdown-kanban
 */

const { spawn } = require('child_process');
const path = require('path');

function findPython() {
  const os = require('os');
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

module.exports = {
  findPython,
  getScriptPath: () => path.join(__dirname, 'kanban.py'),
  getCmdScriptPath: () => path.join(__dirname, 'kanban-cmd.py'),
};
