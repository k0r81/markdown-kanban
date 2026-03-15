/**
 * markdown-kanban - Markdown-based Kanban board
 * 
 * This package provides a local Kanban board with web GUI, CLI, and MCP server.
 * Tasks are stored as Markdown files in a `backlog/` directory.
 * 
 * @module markdown-kanban
 */

const kanban = require('./kanban.js');

module.exports = {
  kanban,
};
