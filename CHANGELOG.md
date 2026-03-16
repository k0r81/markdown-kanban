# Changelog

All notable changes to markdown-kanban will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-16

### Added
- **LLM Agents documentation**: New `LLM_AGENTS.md` with complete guide for AI assistants
- Comprehensive tool examples with request/response patterns
- Usage patterns for common workflows (discovery, creation, progression, epic management)
- Best practices guide for LLM agents
- Error handling documentation

### Improved
- Enhanced README reference to LLM agent documentation
- Better integration instructions for different MCP clients

## [1.1.0] - 2026-03-16

### Changed
- **Major rewrite**: Migrated from Python to pure JavaScript
- Removed Python dependency - now requires only Node.js 16+
- All functionality now works natively in JavaScript
- **Consolidated MCP tools**: Reduced from 5 to 3 universal tools (read, create, update)
- Easier to implement across different MCP clients

### Added
- **MCP server integration**: Full Model Context Protocol support
- 3 unified MCP tools with operation-based approach:
  - `kanban_read` - list tasks, filter, or get details (replaces list+show)
  - `kanban_create` - create new tasks
  - `kanban_update` - move, toggle, or edit tasks (replaces move+toggle)
- Enhanced tool descriptions with more context
- GitHub repository links in package.json

### Improved
- **Better UX**: 3 tools instead of 5, easier to understand at first glance
- Operation-based design allows for future extensibility
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
