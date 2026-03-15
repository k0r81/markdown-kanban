// Example usage of markdown-kanban as a Node.js module

const kanban = require('markdown-kanban');
const { spawn } = require('child_process');

// Helper function to run kanban commands
function runKanbanCommand(args) {
  return new Promise((resolve, reject) => {
    const python = kanban.findPython();
    const script = kanban.getScriptPath();
    
    const child = spawn(python, [script, ...args], {
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

// Example: List all tasks
async function listAllTasks() {
  try {
    const result = await runKanbanCommand(['list', '--json']);
    const tasks = JSON.parse(result);
    console.log('All tasks:', tasks);
    return tasks;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example: Add a new task
async function addTask(title, column = 'planned', epic = '—') {
  try {
    const result = await runKanbanCommand(['add', title, '--col', column, '--epic', epic]);
    console.log('Task added:', result);
    return result;
  } catch (error) {
    console.error('Error adding task:', error.message);
  }
}

// Example usage
if (require.main === module) {
  // Run as standalone script
  (async () => {
    await listAllTasks();
    await addTask('Example task from Node.js');
  })();
}

module.exports = {
  listAllTasks,
  addTask,
  runKanbanCommand
};
