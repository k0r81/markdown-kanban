// Example usage of kanbango as a Node.js module

const kanban = require('kanbango');

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
