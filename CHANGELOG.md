# Changelog

All notable changes to kanbango will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-07-29

### Breaking
- New task IDs are zero-padded numeric strings (`001`), not `PI-001-slug`
- MCP/CLI `toggle` removed; update the full `subtasks` list via `update`
- Legacy task field alias `tasks` removed; use `subtasks` only
- `kanban_gui` `stop` only stops a GUI **spawned by the current MCP process**. An external GUI returns `status: "external_running"` and is **not** sent SIGTERM (PID-reuse safety)
- `kanban_gui` `status` may return `running` (owned), `external_running` (discovered), or `not_running`

### Added
- Accepted-plan workflow: `plan.js` + CLI `kanban plan <action> --json` + MCP `plan_*` actions on `kanban_manage`
- `gui-registry.js` — GUI port file, preferred port, discover helpers (extracted from `kanban.js`)
- Regression tests for plan workflow and GUI process ownership

### Changed
- Create field policy: only `title` is hard-required; `description`, `specs`, `in_scope`, `out_of_scope`, and `acceptance_criteria` are strongly recommended
- MCP `kanban_manage` create/plan_create returns `warnings` + `missing_recommended` when recommended fields are omitted (still succeeds)
- MCP tool descriptions and LLM agent docs push agents to always fill planning boundaries

## [2.5.0] - 2026-07-27

### Changed
- Create field policy: only `title` is hard-required; `description`, `specs`, `in_scope`, `out_of_scope`, and `acceptance_criteria` are strongly recommended
- MCP `kanban_manage` create/plan_create returns `warnings` + `missing_recommended` when recommended fields are omitted (still succeeds)
- MCP tool descriptions and LLM agent docs push agents to always fill planning boundaries

## [2.4.0] - 2026-07-27

### Added
- Opt-in GUI auto-start with MCP via `KANBANGO_AUTO_GUI=1`
- Stable per-project GUI port (hash of cwd in `5510–5999`), overridable with `KANBANGO_GUI_PORT` or `kanban serve [PORT]`
- `backlog/.kanbango-gui.json` port file so the real URL is always discoverable
- `kanban_gui status` discovers a running GUI even outside the MCP child-process tracker

### Changed
- `kanban serve` default port is no longer hard-coded `5500`; uses preferred/stable port resolution
- `kanban_gui start` waits for the server to publish its actual listen port before returning

## [2.3.0] - 2026-07-27

### Added
- `in_scope` and `out_of_scope` fields (arrays of strings) for task boundaries in planning/execution/full views
- MCP `kanban_manage` create/update support for `in_scope` and `out_of_scope`
- Web GUI edit/view sections for In Scope and Out of Scope (muted styling for exclusions)
- Markdown migrate support for `## In Scope` / `## Out of Scope` (and PL headings)

### Fixed
- HTTP API now forwards `test_cases` on create and update (GUI saves were previously dropped)

## [2.2.0] - 2026-07-09

### Changed
- MCP tools consolidated from 6 to 3:
  - `kanban_create` + `kanban_update` merged into `kanban_manage` with `action` parameter (`create` | `move` | `update`)
  - `kanban_gui_start` + `kanban_gui_stop` + `kanban_gui_status` merged into `kanban_gui` with `action` parameter (`start` | `stop` | `status`)
  - `kanban_read` unchanged
- `kanban_manage` subtask edits now use full list updates via `update`; `toggle` action removed

## [2.1.0] - 2026-07-09

### Added
- `test_cases` field (array of strings) as a first-class task attribute in all views (planning, execution, full)
- `test_cases` parameter in `kanban_create` MCP tool input schema
- Patch support for `test_cases` in `kanban_update` MCP tool
- Markdown parsing of `## Test Cases` / `## Przypadki Testowe` sections

## [2.0.0] - 2026-07-07

### Added
- `kanban migrate` CLI command to convert `.md` task files to `.json`
- `migrateAll()` exported function in the core module

### Changed
- **Breaking rename:** package renamed from `markdown-kanban` to `kanbango`
- All npm/npx references updated to `kanbango`
- MCP server name updated to `kanbango`
- Repository URLs updated to `k0r81/kanbango`

## [1.4.1] - 2026-03-17

### Added
- `npm test` now runs a simple test runner that includes regression tests
- Regression test for updating task lists

### Fixed
- `doUpdate` now replaces the `## Taski` section instead of appending duplicates

## [1.5.0] - 2026-07-07

### Added
- JSON-first task storage with rich task fields: `description`, `specs`, `acceptance_criteria`, `notes`
- Rich subtask descriptions in storage, MCP responses, and the web GUI
- MCP read shaping via `view` presets and explicit `fields`
- Structured MCP error responses with `code`, `message`, `hint`, `details`, and `retryable`
- Regression tests for read shaping, Markdown migration, and MCP responses

### Changed
- New tasks are now written as `.json` files in `backlog/<column>/`
- `kanban_update` supports patch-style updates and compact `return` payloads
- Web GUI editor now supports rich task planning fields and subtask descriptions

### Fixed
- Existing Markdown task files remain readable during transition and are migrated to JSON on write

## [1.3.1] - 2026-03-16

### Added
- `kanban mcp-init` command to generate project MCP configs for Claude Code and OpenCode
- Documentation for MCP per-project automation in README and LLM_AGENTS.md
- MCP GUI control tools: `kanban_gui_start`, `kanban_gui_stop`, `kanban_gui_status`
- README + LLM_AGENTS updates for GUI tools and npm package details

## [1.2.0] - 2026-03-16

### Added
- **LLM Agents documentation**: New `LLM_AGENTS.md` with complete guide for AI assistants
- Comprehensive tool examples with request/response patterns
- Usage patterns for common workflows (discovery, creation, progression, epic management)
- Best practices guide for LLM agents
- Error handling documentation
- **AGENTS.md**: Complete guide for AI coding agents with build/lint/test commands

### Improved
- Enhanced README reference to LLM agent documentation
- Better integration instructions for different MCP clients

### Note
- **npm publish requires 2FA**: Publishing to npm requires two-factor authentication enabled
- Use `npm publish --auth-token YOUR_TOKEN` with an automation token for CI/CD
- Or use OTP (one-time password) with `npm login --auth-type=legacy`

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
