# Changelog

All notable changes to markdown-kanban will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-16

### Changed
- **Major rewrite**: Migrated from Python to pure JavaScript
- Removed Python dependency - now requires only Node.js 16+
- All functionality now works natively in JavaScript

### Added
- **MCP server integration**: Full Model Context Protocol support
- 5 MCP tools: `kanban_task_list`, `kanban_task_show`, `kanban_task_create`, `kanban_task_move`, `kanban_subtask_toggle`
- Enhanced tool naming for better clarity and first-time user experience
- GitHub repository links in package.json

### Improved
- Better tool descriptions with more context
- Clearer purpose for each MCP tool
- Updated documentation with MCP configuration examples

### Removed
- Python runtime requirement
- `kanban.py` and `kanban-cmd.py` files (replaced by pure JS)

## [1.0.0] - 2026-03-15

### Added
- Initial release
- Markdown-based Kanban board
- Web GUI with swimlanes
- Full CLI support
- JSON output for AI agents
- Epic grouping
- Subtask progress tracking
- Cross-platform support (Windows, macOS, Linux)
- NPM package support
- `kanban` and `kanban-cmd` commands

### Features
- Four columns: active, planned, icebox, done
- Drag-and-drop interface
- Inline editing
- Real-time checkbox toggling
- Progress bars
- Toast notifications
- Responsive design
