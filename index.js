/**
 * kanbango - JSON-first Kanban board
 * 
 * This package provides a local Kanban board with web GUI, CLI, and MCP server.
 * Tasks are stored as JSON files in a `backlog/` directory, with Markdown read
 * compatibility during migration.
 * 
 * @module kanbango
 */

const kanban = require('./kanban.js');
const plan = require('./plan.js');
const guiRegistry = require('./gui-registry.js');
const playbook = require('./agent-playbook.js');

module.exports = {
  kanban,
  plan,
  guiRegistry,
  playbook,
};
