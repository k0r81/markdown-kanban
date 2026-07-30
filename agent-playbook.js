/**
 * Single source of truth for agent-facing kanbango usage rules.
 * MCP tool descriptions are built from this module — not from LLM_AGENTS.md.
 * Docs may quote DROP_IN_RULE; keep them in sync by editing here only.
 */

const DROP_IN_RULE = [
  'Kanbango MCP — token rules:',
  '- hierarchy: epic (context) → task (work+plan) → subtasks (steps)',
  '- list: col filter, view=summary; keep task_ids; no full-board re-list after writes',
  '- list_epics / show_epic for initiatives; list tasks with epic=E001 for work',
  '- show: view=execution while coding; full only if needed',
  '- epic_create with description/goals; create tasks with epic=E001 (prefer id)',
  '- create once with description,specs,in_scope,out_of_scope,acceptance_criteria',
  '- move/update: return=none; subtasks=full array replace',
  '- non-trivial: plan_create → plan_advance → plan_evidence (real tests, truncated logs) → plan_done',
  '- gui: status before start; stop only owned; external_running = do not kill'
].join('\n');

const TOOL_DESCRIPTIONS = {
  kanban_read: [
    'Read board. TOKEN RULES: list defaults to view=summary (id/title/col/progress only).',
    'Hierarchy: epic (container/context) → task (work) → subtasks (steps).',
    'Always pass col when possible. Prefer show+view=execution over full.',
    'list_epics/show_epic for initiatives; filter list with epic=E001 or epic title.',
    'Do not re-list the whole board after every write — keep task_id from create/move.',
    'Task IDs numeric ("014"); epic IDs "E001". views: summary|planning|execution|full; fields[] overrides view.',
    'operation=help returns this playbook as short text (no board I/O).'
  ].join(' '),

  kanban_manage: [
    'Write board / plan. TOKEN RULES: one create with all planning fields beats many updates;',
    'after write use return=none (or summary). Do not dump full task unless needed.',
    'Actions: create|move|update (daily); epic_create|epic_update (containers);',
    'plan_create→plan_advance→plan_evidence→plan_done (non-trivial only).',
    'epic_create: title + description/goals/in_scope/out_of_scope. Link tasks via epic=E001.',
    'create/plan_create: title required; also send description,specs,in_scope,out_of_scope,acceptance_criteria',
    '(missing → warnings, not failure). move: task_id+column. update: task_id + fields or subtasks[] full list',
    '(no toggle). plan_evidence needs real test run: diff,test_command,stdout,stderr,exit_code — truncate logs.',
    'Example create: {"action":"create","title":"Ship image","epic":"E001","description":"...","specs":"...",',
    '"in_scope":["CLI"],"out_of_scope":["GUI"],"acceptance_criteria":["npm test passes"],"col":"planned"}'
  ].join(' '),

  kanban_gui: [
    'Web GUI control. Prefer status before start. stop only kills GUI this MCP spawned;',
    'external_running = do not retry kill — use the returned url or leave it.',
    'status: running|external_running|not_running. Rarely needed mid-task — open once if user wants UI.'
  ].join(' ')
};

const MUST_CONTAIN = [
  'TOKEN RULES',
  'view=summary',
  'return=none',
  'plan_create',
  'external_running',
  'subtasks',
  'epic_create'
];

function playbookHelpPayload() {
  return {
    source: 'agent-playbook.js',
    note: 'Canonical rules for agents. Same text drives MCP tool descriptions. LLM_AGENTS.md is human docs only.',
    drop_in_rule: DROP_IN_RULE,
    tools: {
      kanban_read: TOOL_DESCRIPTIONS.kanban_read,
      kanban_manage: TOOL_DESCRIPTIONS.kanban_manage,
      kanban_gui: TOOL_DESCRIPTIONS.kanban_gui
    }
  };
}

module.exports = {
  DROP_IN_RULE,
  TOOL_DESCRIPTIONS,
  MUST_CONTAIN,
  playbookHelpPayload
};
