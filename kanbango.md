# kanbango — Rename + Migrate Tool Plan

## Phase 1 — Add `migrate` command to `kanban.js`

**New exported function `migrateAll(options)`** in `kanban.js`:
- Walks all 4 columns
- Finds `.md` files, reads via existing `parseMarkdownTask`, writes `.json` via `writeTask`
- `writeTask` already deletes the old `.md` file automatically
- `options.dryRun` — preview only, returns what would migrate
- Returns `{ migrated: [{id, from, to}], errors: [{file, reason}] }`

## Phase 2 — Add `kanban migrate` CLI subcommand

In `bin/kanban.js`:
- `kanban migrate` — runs migration, reports each file converted
- `kanban migrate --dry-run` — preview only

## Phase 3 — Rename everything from `markdown-kanban` → `kanbango`

**Files to update:**

| File | Changes |
|------|---------|
| `package.json` | name → `kanbango`, description → "JSON-first local Kanban board with web GUI, CLI, and MCP server", repo/homepage/bugs URLs → `k0r81/kanbango` |
| `CHANGELOG.md` | Add `[2.0.0]` entry, rename references |
| `bin/kanban.js` | `claudeMcpConfig` and `openCodeMcpConfig` — change `npx markdown-kanban` → `npx kanbango` (lines 26, 42) |
| `README.md` | All `markdown-kanban` → `kanbango`, update description |
| `LLM_AGENTS.md` | Same renames |
| `AGENTS.md` | Same renames |
| `.npmignore` | Check if any path references need updating |

**What stays the same:**
- CLI binary names: `kanban` and `kanban-cmd` — no change
- `backlog/` directory structure
- All internal logic in `kanban.js`, `mcp-server.js`, `index.js`

## Phase 4 — Tag & Publish

1. Bump version to `2.0.0` in `package.json`
2. `git tag v2.0.0 -m "kanbango: rename + migrate tool"`
3. Push tag to GitHub
4. Rename GitHub repo `k0r81/markdown-kanban` → `k0r81/kanbango` (manual, via GitHub UI)
5. `npm publish` — first publish as `kanbango`

## Phase 5 — Verify

- `npm search kanbango` to confirm it's live
- Check download page at `https://www.npmjs.com/package/kanbango`