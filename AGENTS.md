# AGENTS.md - Guide for AI Coding Agents

This document provides build commands, testing procedures, and code style guidelines for working with the markdown-kanban codebase.

## Build & Development Commands

### Available Scripts
```bash
# Start web GUI (opens http://localhost:5500)
npm start
# or
node bin/kanban.js serve

# Start web GUI on custom port
node bin/kanban.js serve 8080

# Run MCP server
npm run mcp
# or
node mcp-server.js

# Run tests (lists tasks in JSON format)
npm test
# or
node bin/kanban.js list --json

# Initialize backlog structure
node bin/kanban.js init
```

### Testing
The project uses a simple test command that verifies the CLI works:
```bash
npm test
```

**Single test verification:**
```bash
# Test MCP server tools list
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.js

# Test kanban_read tool
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kanban_read","arguments":{"operation":"list"}}}' | node mcp-server.js

# Test CLI list
node bin/kanban.js list --json
```

### Installation & Setup
```bash
# Install dependencies
npm install

# Install globally for CLI access
npm install -g .
```

## Code Style Guidelines

### File Structure
```
markdown-kanban/
├── bin/              # CLI executables
│   ├── kanban.js      # Main CLI with web server
│   └── kanban-cmd.js  # Alternative CLI (symlink to kanban.js)
├── kanban.js          # Core business logic module
├── mcp-server.js      # MCP server implementation
├── index.js           # Main entry point (module exports)
├── index.html         # Web GUI
├── backlog/           # Task storage (gitignored)
└── examples/          # Usage examples
```

### Imports

**Use CommonJS require statements:**
```javascript
const fs = require('fs').promises;
const path = require('path');
const kanban = require('./kanban.js');
```

**Standard library imports:**
```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
```

**External package imports:**
```javascript
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
```

**Destructure imports from external packages:**
```javascript
const { Server, StdioServerTransport } = require("@modelcontextprotocol/sdk");
```

### Formatting

**Indentation:** 2 spaces (no tabs)

**Line length:** Aim for under 100 characters when practical

**Semicolons:** Required at end of statements

**Quotes:** Single quotes for strings and keys, double quotes for JSON
```javascript
const title = 'Task title';
const filePath = path.join(__dirname, 'file.js');
console.log(JSON.stringify(data, null, 2));  // Double quotes in JSON
```

**Trailing commas:** Omit in objects/arrays unless needed for formatting
```javascript
const config = {
  name: "markdown-kanban",
  version: "1.0.0"
};
```

### Types

**No TypeScript** - This is a pure JavaScript project

**Common type patterns:**
```javascript
// Arrays
const epics = [];
const COLS = ["active", "planned", "icebox", "done"];

// Objects
const task = { done: false, text: "Description" };
const STATUS_MAP = { active: "in_progress", planned: "planned" };

// Functions (implicitly typed)
async function parseEpic(filePath, column) {
  // ...
}

// Callbacks
function shortId(epicId) {
  const match = epicId.match(/^(PI-\d+[\w.]*|BUG-\d+|CHORE-\d+)/);
  return match ? match[1] : epicId;
}
```

### Naming Conventions

**Constants:** UPPER_SNAKE_CASE
```javascript
const BACKLOG = path.join(__dirname, 'backlog');
const COLS = ["active", "planned", "icebox", "done"];
const STATUS_MAP = { active: "in_progress" };
```

**Functions:** camelCase
```javascript
function parseEpic(filePath, column) { }
async function ensureBacklogDir() { }
function displayTitle(epic) { }
```

**Variables:** camelCase
```javascript
const filePath = await findFile(taskId);
const col = COLS.find(c => c === 'active');
let filtered = epics;
```

**Classes/Modules:** PascalCase (not used in this project, but for reference)
```javascript
class KanbanServer { }
```

**Private/internal functions:** prefix with underscore if needed (not commonly used)
```javascript
function _normalizePath(p) { }
```

### Error Handling

**Use try/catch for async operations that might fail:**
```javascript
async function allEpics() {
  const epics = [];
  
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    try {
      const files = await fs.readdir(colDir);
      // Process files...
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;  // Re-throw if not ENOENT
    }
  }
  
  return epics;
}
```

**Handle expected error codes:**
- `ENOENT` - File/directory not found (ignore)
- Other errors - log and continue, or re-throw

**In CLI context:**
```javascript
async function cliShow(taskId) {
  const filePath = await kanban.findFile(taskId);
  if (!filePath) {
    console.error(`✗ Nie znaleziono: ${taskId}`);
    process.exit(1);
  }
  // ...
}
```

**In MCP server context:**
```javascript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    // Process request
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: error.message }) }],
      isError: true
    };
  }
});
```

**Never crash silently - always provide feedback:**
- Use `console.error()` for errors
- Use `console.log()` for normal output
- Use `process.exit(1)` for fatal CLI errors

### Async/Await Patterns

**Prefer async/await over callbacks:**
```javascript
async function ensureBacklogDir() {
  for (const col of COLS) {
    const colDir = path.join(BACKLOG, col);
    await fs.mkdir(colDir, { recursive: true });
  }
}
```

**Handle async in loops:**
```javascript
for (const col of COLS) {
  const colDir = path.join(BACKLOG, col);
  const files = await fs.readdir(colDir);  // await inside loop
  // Process each file
}
```

### File Operations

**Use fs.promises for async operations:**
```javascript
const fs = require('fs').promises;

await fs.mkdir(dir, { recursive: true });
await fs.readFile(filePath, 'utf-8');
await fs.writeFile(filePath, content, 'utf-8');
await fs.readdir(dir);
await fs.rename(oldPath, newPath);
```

**Use fs.existsSync for synchronous checks:**
```javascript
if (!fs.existsSync(readme)) {
  await fs.promises.writeFile(readme, content, 'utf-8');
}
```

**Always use path.join() for cross-platform paths:**
```javascript
const BACKLOG = path.join(__dirname, 'backlog');
const filePath = path.join(BACKLOG, col, fileName);
```

**Use path.basename() and path.dirname() for path manipulation:**
```javascript
const fileName = path.basename(filePath, '.md');  // Remove extension
const dirName = path.dirname(filePath);
```

### Console Output

**CLI output:**
- Normal messages: `console.log()`
- Errors: `console.error()`  
- Exit on error: `process.exit(1)`

**MCP server:**
- Use `console.error()` for server logs (visible only in stderr)
- Return errors in response, don't log them

**Examples:**
```javascript
// CLI
console.log('✓ Task created');
console.error('✗ Task not found');
process.exit(1);

// MCP server
console.error("markdown-kanban MCP server running");
```

### Comments

**Minimal comments preferred** - code should be self-documenting

**Use JSDoc for module exports when helpful:**
```javascript
/**
 * markdown-kanban - Markdown-based Kanban board
 * 
 * This package provides a local Kanban board with web GUI, CLI, and MCP server.
 * Tasks are stored as Markdown files in a `backlog/` directory.
 * 
 * @module markdown-kanban
 */
```

**Section separators for large files:**
```javascript
// ── Section name ──────────────────────────────────────────────────────────────

function someFunction() {
  // ...
}
```

### Regular Expressions

**Use regex flags appropriately:**
- `m` - multiline: match across multiple lines
- `g` - global: find all matches
- `i` - case insensitive (not commonly needed)

**Examples:**
```javascript
const titleMatch = text.match(/^# (.+)$/m);  // Match first header line
const taskRegex = /^- \[([ x])\] (.+)$/gm;  // Find all task items

let match;
while ((match = taskRegex.exec(text)) !== null) {
  tasks.push({
    done: match[1] === 'x',
    text: match[2]
  });
}
```

### Module Exports

**Use module.exports for CommonJS:**
```javascript
const kanban = require('./kanban.js');

module.exports = {
  kanban,
  // OR export individual functions
  ensureBacklogDir,
  parseEpic,
  allEpics
};
```

**Default exports (not used here but for reference):**
```javascript
module.exports = function() { };
```

### CLI Argument Parsing

**Process.argv provides arguments:**
```javascript
const args = process.argv.slice(2);  // Skip node and script path
const cmd = args[0];
const param1 = args[1];

// Example: node bin/kanban.js move PI-001 done
// args[0] = "move"
// args[1] = "PI-001"
// args[2] = "done"
```

**Parse optional flags:**
```javascript
let colFilter = null;
let asJson = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--col' && args[i + 1]) {
    colFilter = args[++i];
  } else if (args[i] === '--json') {
    asJson = true;
  }
}
```

### MCP Server Patterns

**Tool definitions:**
```javascript
{
  name: "tool_name",
  description: "Clear description of what this tool does",
  inputSchema: {
    type: "object",
    properties: {
      param_name: {
        type: "string",
        description: "Description of parameter"
      }
    },
    required: ["param_name"]
  }
}
```

**Tool handlers:**
```javascript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case "tool_name":
      // Process tool
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
  
  return {
    content: [{ type: "text", text: JSON.stringify(result) }]
  };
});
```

## Best Practices

1. **Always validate inputs** - especially from CLI arguments
2. **Handle async errors** - never let async operations fail silently
3. **Use const by default** - use let only when reassignment is needed
4. **Prefer fs.promises** - over callback-based fs operations
5. **Use path.join()** - never concatenate paths with + or /
6. **Keep functions small** - aim for 20-30 lines max
7. **Return early on errors** - reduce nesting
8. **Use descriptive variable names** - avoid single letters except in loop counters
9. **Test MCP tools** - use JSON RPC messages to verify functionality
10. **Check for existing files** - before writing to avoid overwrites when unintended

## Version Management

Update `package.json` version on changes:
```bash
# Major: incompatible API changes
npm version major

# Minor: new features, backwards compatible
npm version minor

# Patch: bug fixes, backwards compatible
npm version patch
```

**Manual version update** (if npm version doesn't work):
```bash
# Edit package.json and update "version" field
# Example: "version": "1.2.0" → "version": "1.3.0"
```

Always update CHANGELOG.md with version changes:
```bash
# Add new section with date
## [1.3.0] - 2026-03-XX

### Added
- New feature description

### Changed
- Modified existing functionality

### Fixed
- Bug fix description
```

## Git Workflow

**Commit changes with proper messages:**
```bash
# Check status
git status

# Add changes
git add -A

# Commit with descriptive message (follows these patterns):
git commit -m "Add feature: description"
git commit -m "Fix bug: description" 
git commit -m "Update docs: description"
git commit -m "Refactor: description"
git commit -m "Release v1.2.0 - brief description"

# Push to origin
git push origin master
```

**Commit message patterns:**
- `Add feature:` - new functionality
- `Fix bug:` - bug fix
- `Update docs:` - documentation changes
- `Refactor:` - code restructuring
- `Release vX.Y.Z:` - version releases

**Complete workflow for releases:**
```bash
# 1. Update version in package.json
npm version patch  # or minor/major

# 2. Update CHANGELOG.md with version details
# (manually edit CHANGELOG.md)

# 3. Commit changes
git add package.json CHANGELOG.md
git commit -m "Release v1.3.0 - Add new feature"

# 4. Push to remote
git push origin master
```

**Multiple files commit pattern:**
```bash
# Add all changes
git add -A

# Commit all changes together
git commit -m "Add MCP tools and update documentation

- Added 3 unified MCP tools (read, create, update)
- Updated README.md with new tool names
- Updated CHANGELOG.md with v1.2.0 details
- Enhanced documentation for LLM agents"
```

Branch: `master` (not `main`)

## Testing Your Changes

After making changes, verify:
1. CLI works: `node bin/kanban.js list --json`
2. Web GUI starts: `node bin/kanban.js serve` (Ctrl+C to stop)
3. MCP server tools: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.js`
4. All three tools work: kanban_read, kanban_create, kanban_update

## Common Patterns to Avoid

❌ Don't use synchronous file operations in async contexts
```javascript
// Bad
const content = fs.readFileSync(path);  // Blocking
// Good
const content = await fs.readFile(path);
```

❌ Don't concatenate paths manually
```javascript
// Bad
const path = __dirname + '/backlog';
// Good
const path = path.join(__dirname, 'backlog');
```

❌ Don't ignore error codes
```javascript
// Bad
try { await fs.mkdir(dir); } catch (e) { }
// Good
try { await fs.mkdir(dir); } catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
```

❌ Don't use console.log for errors in MCP server
```javascript
// Bad
console.log('Error:', error);
// Good
return { content: [{ text: JSON.stringify({ error: error.message }) }], isError: true };
```

## Getting Help

- README.md: https://github.com/k0r81/markdown-kanban#readme
- LLM Agents Guide: LLM_AGENTS.md
- MCP Server Guide: LLM_AGENTS.md
- Issues: https://github.com/k0r81/markdown-kanban/issues