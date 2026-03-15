#!/usr/bin/env python3
"""Kanban board dla backlogu Donny — swimlany + edycja inline.

Użycie:
    python3 kanban.py [PORT]

Domyślny port: 5500. Otwórz http://localhost:5500
"""

import json
import re
import shutil
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote

BACKLOG = Path(__file__).parent / "backlog"
COLS = ["active", "planned", "icebox", "done"]
STATUS_MAP = {
    "active": "in_progress",
    "planned": "planned",
    "icebox": "icebox",
    "done": "done",
}


# ── Data helpers ──────────────────────────────────────────────────────────────


def parse_epic(path: Path, column: str) -> dict:
    text = path.read_text("utf-8")
    title_m = re.search(r"^# (.+)$", text, re.M)
    epic_m = re.search(r"^\*\*Epic:\*\*\s*(.+)$", text, re.M)
    created_m = re.search(r"^\*\*Created:\*\*\s*(.+)$", text, re.M)
    tasks = [
        {"done": m[0] == "x", "text": m[1]}
        for m in re.findall(r"^- \[([ x])\] (.+)$", text, re.M)
    ]
    raw_group = epic_m.group(1).strip() if epic_m else "—"
    epic_group = raw_group if raw_group not in ("", "—") else "—"
    return {
        "id": path.stem,
        "title": title_m.group(1) if title_m else path.stem,
        "column": column,
        "tasks": tasks,
        "epic_group": epic_group,
        "created": created_m.group(1).strip() if created_m else None,
    }


def all_epics() -> list:
    epics = []
    for col in COLS:
        col_dir = BACKLOG / col
        if col_dir.exists():
            for f in sorted(col_dir.glob("*.md")):
                try:
                    epics.append(parse_epic(f, col))
                except Exception as e:
                    print(f"  ⚠ parse error {f.name}: {e}", file=sys.stderr)
    return epics


def find_file(epic_id: str) -> Path | None:
    for col in COLS:
        col_dir = BACKLOG / col
        if col_dir.exists():
            for f in col_dir.glob("*.md"):
                if f.stem == epic_id:
                    return f
    return None


def do_move(epic_id: str, target: str) -> bool:
    if target not in COLS:
        return False
    f = find_file(epic_id)
    if f is None:
        return False
    new_f = BACKLOG / target / f.name
    shutil.move(str(f), str(new_f))
    txt = new_f.read_text("utf-8")
    txt = re.sub(r"\*\*Status:\*\* \S+", f"**Status:** {STATUS_MAP[target]}", txt)
    new_f.write_text(txt, "utf-8")
    return True


def do_toggle(epic_id: str, idx: int) -> bool:
    f = find_file(epic_id)
    if f is None:
        return False
    txt = f.read_text("utf-8")
    tasks = list(re.finditer(r"^- \[([ x])\] .+$", txt, re.M))
    if idx >= len(tasks):
        return False
    m = tasks[idx]
    new_char = "x" if m.group(1) == " " else " "
    new_txt = txt[: m.start(1)] + new_char + txt[m.end(1) :]
    f.write_text(new_txt, "utf-8")
    return True


def do_update(
    epic_id: str, new_title: str | None = None, new_tasks: list | None = None
) -> bool:
    f = find_file(epic_id)
    if f is None:
        return False
    txt = f.read_text("utf-8")

    if new_title is not None:

        def replace_title(m: re.Match) -> str:
            full = m.group(1)
            prefix = re.match(r"^([\w.-]+:\s*)", full)
            return f"# {prefix.group(1)}{new_title}" if prefix else f"# {new_title}"

        txt = re.sub(r"^# (.+)$", replace_title, txt, count=1, flags=re.M)

    if new_tasks is not None:
        if "## Taski" in txt:
            before, rest = txt.split("## Taski", 1)
            lines = rest.split("\n")
            skip = 0
            for i, line in enumerate(lines):
                if line.strip() == "" or re.match(r"^- \[[ x]\]", line):
                    skip = i + 1
                else:
                    break
            remaining = "\n".join(lines[skip:])
            task_text = "\n".join(
                f"- [{'x' if t.get('done') else ' '}] {t['text']}"
                for t in new_tasks
                if t.get("text", "").strip()
            )
            txt = before + "## Taski\n\n" + task_text + "\n\n" + remaining
        else:
            task_text = "\n".join(
                f"- [{'x' if t.get('done') else ' '}] {t['text']}"
                for t in new_tasks
                if t.get("text", "").strip()
            )
            txt += f"\n\n## Taski\n\n{task_text}\n"

    f.write_text(txt, "utf-8")
    return True


def do_create(title: str, column: str, epic_group: str = "—") -> dict | None:
    if not title or column not in COLS:
        return None
    ids = []
    for col in COLS:
        col_dir = BACKLOG / col
        if col_dir.exists():
            for fp in col_dir.glob("PI-*.md"):
                m = re.match(r"PI-(\d+)", fp.stem)
                if m:
                    ids.append(int(m.group(1)))
    next_id = max(ids, default=15) + 1
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:25]
    fname = f"PI-{next_id:03d}-{slug}.md"
    content = (
        f"# PI-{next_id:03d}: {title}\n\n"
        f"**Status:** {STATUS_MAP[column]}\n"
        f"**Epic:** {epic_group or '—'}\n"
        f"**Created:** {date.today()}\n\n"
        f"## Opis\n—\n\n"
        f"## Taski\n- [ ] \n\n"
        f"## Notes\n—\n"
    )
    path = BACKLOG / column / fname
    (BACKLOG / column).mkdir(exist_ok=True)
    path.write_text(content, "utf-8")
    return parse_epic(path, column)


# ── HTTP handler ──────────────────────────────────────────────────────────────


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(self.path.split("?")[0])
        if path in ("/", "/index.html"):
            self._html(HTML)
        elif path == "/api/board":
            self._json(all_epics())
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = unquote(self.path)
        if path == "/api/epics":
            data = self._body()
            epic = do_create(
                data.get("title", ""),
                data.get("column", "planned"),
                data.get("epic_group", "—"),
            )
            if epic:
                self._json(epic, 201)
            else:
                self._json({"error": "bad params"}, 400)
        else:
            self._json({"error": "not found"}, 404)

    def do_PATCH(self):
        path = unquote(self.path)

        # /api/epics/:id/move
        m = re.match(r"^/api/epics/([^/]+)/move$", path)
        if m:
            data = self._body()
            if do_move(m.group(1), data.get("column", "")):
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
            return

        # /api/epics/:id/tasks/:idx  — toggle checkbox
        m = re.match(r"^/api/epics/([^/]+)/tasks/(\d+)$", path)
        if m:
            if do_toggle(m.group(1), int(m.group(2))):
                self._json({"ok": True})
            else:
                self._json({"error": "bad index"}, 400)
            return

        # /api/epics/:id  — update title / task list
        m = re.match(r"^/api/epics/([^/]+)$", path)
        if m:
            data = self._body()
            ok = do_update(
                m.group(1),
                new_title=data.get("title"),
                new_tasks=data.get("tasks"),
            )
            if ok:
                f = find_file(m.group(1))
                if f:
                    col = next((c for c in COLS if f.parent.name == c), "planned")
                    self._json(parse_epic(f, col))
                else:
                    self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
            return

        self._json({"error": "not found"}, 404)

    def _html(self, content: str):
        body = content.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, code: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw)

    def log_message(self, fmt, *args):
        pass


# ── HTML / CSS / JS ───────────────────────────────────────────────────────────

HTML = r"""<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Donna Kanban</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --active:  #e85d04;
  --planned: #2563eb;
  --icebox:  #64748b;
  --done:    #16a34a;
  --bg:      #eef0f3;
  --card:    #ffffff;
  --border:  #dde1e9;
  --text:    #1e293b;
  --muted:   #8fa0b8;
  --radius:  8px;
  --col-w:   repeat(4, 1fr);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Header ── */
header {
  padding: 0 16px;
  height: 44px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  z-index: 30;
}
header h1 { font-size: 14px; font-weight: 700; letter-spacing: -0.2px; }
.hstats    { font-size: 12px; color: var(--muted); }
.hspacer   { flex: 1; }
.btn-new {
  background: var(--planned);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.btn-new:hover { filter: brightness(0.9); }

/* ── New epic form strip ── */
.new-epic-strip {
  background: #fff;
  border-bottom: 1px solid var(--border);
  padding: 8px 16px;
  display: none;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.new-epic-strip.open { display: flex; }
.ne-input {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 5px 9px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  color: var(--text);
}
.ne-input:focus { border-color: var(--planned); }
.ne-title { width: 260px; }
.ne-col   { width: 130px; }
.ne-group { width: 200px; }
.btn-sm {
  border: none; cursor: pointer; border-radius: var(--radius);
  font-size: 11px; padding: 4px 10px; font-weight: 600;
  font-family: inherit;
}
.btn-confirm { background: var(--planned); color: #fff; }
.btn-confirm:hover { filter: brightness(0.9); }
.btn-cancel  { background: #f1f5f9; color: var(--muted); }
.btn-cancel:hover { background: #e2e8f0; }

/* ── Board wrapper ── */
#board-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 16px;
}
#board-wrap::-webkit-scrollbar { width: 5px; }
#board-wrap::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }

/* ── Sticky column headers ── */
.col-headers {
  display: grid;
  grid-template-columns: var(--col-w);
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 20;
  padding: 8px 0 4px;
}
.ch {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ch-count {
  background: rgba(0,0,0,0.07);
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--muted);
  font-weight: 600;
}
.ch.icebox  { color: var(--icebox);  }
.ch.planned { color: var(--planned); }
.ch.active  { color: var(--active);  }
.ch.done    { color: var(--done);    }

/* ── Swimlane ── */
.swimlane {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 6px;
  overflow: hidden;
}
.sl-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
}
.sl-header:hover { background: #f1f5f9; }
.sl-arrow { font-size: 10px; color: var(--muted); transition: transform 0.15s; }
.sl-header.collapsed .sl-arrow { transform: rotate(-90deg); }
.sl-name { font-size: 12px; font-weight: 600; color: var(--text); }
.sl-cnt {
  font-size: 11px;
  color: var(--muted);
  background: #e2e8f0;
  border-radius: 10px;
  padding: 1px 6px;
  font-weight: 600;
}
.sl-progress {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
}

/* ── Swimlane body grid ── */
.sl-body {
  display: grid;
  grid-template-columns: var(--col-w);
  min-height: 60px;
}
.sl-body.hidden { display: none; }

.lane {
  padding: 8px;
  min-height: 56px;
  border-right: 1px solid #f1f5f9;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lane:last-child { border-right: none; }
.lane.col-active  { background: #fefcfb; }
.lane.col-done    { background: #fafdfb; }

/* ── Card ── */
.card {
  background: var(--card);
  border-radius: var(--radius);
  border-left: 4px solid transparent;
  padding: 10px 12px 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.1s;
  position: relative;
}
.card:hover { box-shadow: 0 3px 10px rgba(0,0,0,0.11); }

.card.col-planned { border-left-color: var(--planned); }
.card.col-active  {
  border-left-color: var(--active);
  background: #fffdf9;
  box-shadow: 0 2px 6px rgba(232,93,4,0.10);
}
.card.col-done    { border-left-color: var(--done); opacity: 0.6; }

/* Icebox: tile style */
.card.col-icebox {
  background: #edf0f7;
  border-left: none;
  border-top: 3px solid #8fa0b8;
  border-radius: 10px;
  box-shadow: none;
  padding: 8px 10px 7px;
}
.card.col-icebox:hover { box-shadow: 0 2px 8px rgba(100,116,139,0.15); }

.card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.card-id {
  font-size: 10px; color: var(--muted); font-weight: 700;
  background: rgba(0,0,0,0.05); border-radius: 4px;
  padding: 1px 5px; white-space: nowrap;
}
.card.col-icebox .card-id { background: rgba(100,116,139,0.12); }
.card-title { font-size: 14px; font-weight: 600; line-height: 1.3; word-break: break-word; color: var(--text); }
.card.col-icebox .card-title { font-size: 13px; font-weight: 500; color: #475569; }
.card.col-done .card-title   { text-decoration: line-through; color: var(--muted); }

/* ── Progress bar ── */
.prog-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.prog-bar { flex: 1; height: 4px; background: #dde1e9; border-radius: 2px; overflow: hidden; }
.prog-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.prog-fill.planned { background: var(--planned); }
.prog-fill.active  { background: var(--active);  }
.prog-fill.done    { background: var(--done);    }
.prog-fill.icebox  { background: var(--icebox);  }
.prog-txt { font-size: 10px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── Card action bar ── */
.card-actions {
  display: flex; gap: 4px; margin-top: 8px;
  opacity: 0; transition: opacity 0.12s;
}
.card:hover .card-actions,
.card.open .card-actions,
.card.editing .card-actions { opacity: 1; }

.cbtn {
  border: none; cursor: pointer; border-radius: 5px;
  font-size: 11px; padding: 3px 8px; font-weight: 600;
  font-family: inherit; background: #edf0f5; color: var(--muted);
  transition: background 0.1s, color 0.1s;
}
.cbtn:hover { background: #dde4f0; color: var(--text); }

/* Arrow move buttons */
.cbtn.arr {
  padding: 3px 9px;
  font-size: 13px;
  line-height: 1;
}
.cbtn.arr:hover { background: #d0d8f0; color: var(--planned); }
.card.col-active .cbtn.arr:hover { background: #ffe4d0; color: var(--active); }

.cbtn.edit-btn { color: #5a7ab5; }
.cbtn.edit-btn:hover { background: #e8efff; color: var(--planned); }

/* ── Expanded card: subtask list (view mode) ── */
.subtask-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.6px; color: var(--muted);
  margin: 10px 0 5px; padding-top: 8px;
  border-top: 1px solid #edf0f5;
}
.tasks-list {
  display: flex; flex-direction: column; gap: 4px;
}
.task-row { display: flex; align-items: flex-start; gap: 7px; }
.task-row input[type="checkbox"] {
  margin-top: 2px; cursor: pointer; flex-shrink: 0;
  accent-color: var(--planned);
}
.task-row label { font-size: 12px; cursor: pointer; line-height: 1.4; color: var(--text); }
.task-row.done label { text-decoration: line-through; color: var(--muted); }

/* ── Edit mode ── */
.card.editing { box-shadow: 0 0 0 2px var(--planned); cursor: default; }

.edit-title-input {
  width: 100%; border: 1px solid var(--planned); border-radius: 4px;
  padding: 4px 7px; font-size: 13px; font-weight: 500; font-family: inherit;
  color: var(--text); outline: none; margin-top: 2px;
}

.edit-tasks { margin-top: 9px; border-top: 1px solid #f1f5f9; padding-top: 9px; }
.edit-task-row {
  display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
}
.edit-task-row input[type="checkbox"] { flex-shrink: 0; accent-color: var(--planned); cursor: pointer; }
.edit-task-input {
  flex: 1; border: 1px solid transparent; border-radius: 3px;
  padding: 2px 5px; font-size: 12px; font-family: inherit;
  color: var(--text); outline: none; background: transparent;
}
.edit-task-input:focus { border-color: var(--planned); background: #fff; }
.edit-task-input:hover { border-color: var(--border); }
.del-task {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--muted); font-size: 14px; line-height: 1; padding: 0 2px;
  opacity: 0; transition: opacity 0.1s;
}
.edit-task-row:hover .del-task { opacity: 1; }
.del-task:hover { color: #dc2626; }

.add-task-row { margin-top: 5px; }
.add-task-inp {
  width: 100%; border: 1px dashed #cbd5e1; border-radius: 3px;
  padding: 3px 7px; font-size: 12px; font-family: inherit;
  color: var(--text); outline: none; background: transparent;
}
.add-task-inp:focus { border-color: var(--planned); border-style: solid; background: #fff; }
.add-task-inp::placeholder { color: var(--muted); }

.edit-footer {
  display: flex; gap: 5px; margin-top: 10px; padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}

/* ── Lane add button ── */
.lane-add {
  background: none; border: 1.5px dashed #d1d5db; border-radius: var(--radius);
  padding: 5px 10px; font-size: 11px; color: var(--muted); cursor: pointer;
  width: 100%; text-align: left; font-family: inherit;
  transition: all 0.15s; margin-top: 2px;
}
.lane-add:hover { border-color: var(--planned); color: var(--planned); background: #eff6ff; }

/* ── Toast ── */
.toast {
  position: fixed; bottom: 16px; right: 16px; background: #1e293b;
  color: #fff; padding: 8px 14px; border-radius: 8px;
  font-size: 12px; font-weight: 500; opacity: 0;
  transform: translateY(6px); transition: all 0.2s;
  pointer-events: none; z-index: 999;
}
.toast.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>

<header>
  <h1>Donna Kanban</h1>
  <span class="hstats" id="hstats">—</span>
  <span class="hspacer"></span>
  <button class="btn-new" id="btn-new" onclick="toggleNewForm()">+ Nowy task</button>
</header>

<div class="new-epic-strip" id="new-strip">
  <input class="ne-input ne-title" id="ne-title" placeholder="Nazwa taska…" autocomplete="off">
  <select class="ne-input ne-col" id="ne-col">
    <option value="icebox">🧊 Icebox</option>
    <option value="planned" selected>📦 Planned</option>
    <option value="active">🔥 Active</option>
    <option value="done">✅ Done</option>
  </select>
  <input class="ne-input ne-group" id="ne-group" placeholder="Epik / Faza (opcjonalnie)…" autocomplete="off">
  <button class="btn-sm btn-confirm" onclick="submitNew()">Dodaj</button>
  <button class="btn-sm btn-cancel"  onclick="toggleNewForm()">Anuluj</button>
</div>

<div id="board-wrap">
  <div class="col-headers" id="col-headers"></div>
  <div id="swimlanes"></div>
</div>

<div class="toast" id="toast"></div>

<script>
const COL_DEFS = [
  { id: "icebox",  label: "🧊 Icebox",  icon: "🧊" },
  { id: "planned", label: "📦 Planned", icon: "📦" },
  { id: "active",  label: "🔥 Active",  icon: "🔥" },
  { id: "done",    label: "✅ Done",    icon: "✅" },
];

let allEpics   = [];
let colCounts  = {};
let collapsed  = new Set();
let expanded   = new Set();
let editingId  = null;
let dirtyEdits = {}; // epicId → {title, tasks}

// ── Load & render ─────────────────────────────────────────────────────────────

async function load() {
  const res = await fetch("/api/board");
  allEpics = await res.json();
  render();
}

function render() {
  colCounts = {};
  COL_DEFS.forEach(c => (colCounts[c.id] = 0));
  allEpics.forEach(e => { if (colCounts[e.column] !== undefined) colCounts[e.column]++; });

  // Header stats
  const total = allEpics.length;
  const done  = allEpics.filter(e => e.column === "done").length;
  document.getElementById("hstats").textContent = `${done}/${total} ukończone`;

  // Col headers
  const hdr = document.getElementById("col-headers");
  hdr.innerHTML = "";
  COL_DEFS.forEach(c => {
    const h = document.createElement("div");
    h.className = `ch ${c.id}`;
    h.innerHTML = `${c.label} <span class="ch-count">${colCounts[c.id]}</span>`;
    hdr.appendChild(h);
  });

  // Swimlanes
  const sl = document.getElementById("swimlanes");
  sl.innerHTML = "";
  groupEpics(allEpics).forEach(g => sl.appendChild(renderSwimlane(g)));
}

function groupEpics(epics) {
  const map = new Map();
  epics.forEach(e => {
    const g = e.epic_group || "—";
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(e);
  });
  // Sort: known phases first, "—" last
  return [...map.entries()]
    .sort(([a], [b]) => a === "—" ? 1 : b === "—" ? -1 : a.localeCompare(b, "pl"))
    .map(([name, epics]) => ({ name, epics }));
}

// ── Swimlane ──────────────────────────────────────────────────────────────────

function renderSwimlane({ name, epics }) {
  const isCollapsed = collapsed.has(name);

  const wrap = el("div", "swimlane");

  // Header
  const hdr = el("div", `sl-header${isCollapsed ? " collapsed" : ""}`);
  const totalTasks = epics.reduce((s, e) => s + e.tasks.length, 0);
  const doneTasks  = epics.reduce((s, e) => s + e.tasks.filter(t => t.done).length, 0);
  const pct = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : null;

  hdr.innerHTML = `
    <span class="sl-arrow">▼</span>
    <span class="sl-name">${escHtml(name === "—" ? "Pozostałe (bez epiku)" : name)}</span>
    <span class="sl-cnt">${epics.length}</span>
    ${pct !== null ? `<span class="sl-progress" style="margin-left:auto">${pct}% tasków</span>` : ""}
  `;
  hdr.onclick = () => {
    if (collapsed.has(name)) collapsed.delete(name);
    else collapsed.add(name);
    render();
  };
  wrap.appendChild(hdr);

  // Body
  const body = el("div", `sl-body${isCollapsed ? " hidden" : ""}`);
  COL_DEFS.forEach(col => {
    const lane = el("div", `lane col-${col.id}`);
    epics.filter(e => e.column === col.id).forEach(e => lane.appendChild(renderCard(e, col.id)));
    // Add button only in non-done columns
    if (col.id !== "done") {
      const addBtn = document.createElement("button");
      addBtn.className = "lane-add";
      addBtn.textContent = "+ Dodaj tutaj";
      addBtn.onclick = e => { e.stopPropagation(); showLaneAdd(lane, col.id, name, addBtn); };
      lane.appendChild(addBtn);
    }
    body.appendChild(lane);
  });
  wrap.appendChild(body);
  return wrap;
}

// ── Card ──────────────────────────────────────────────────────────────────────

function getNeighborCols(colId) {
  const idx = COL_DEFS.findIndex(c => c.id === colId);
  return {
    prev: idx > 0                    ? COL_DEFS[idx - 1] : null,
    next: idx < COL_DEFS.length - 1 ? COL_DEFS[idx + 1] : null,
  };
}

async function moveCard(epicId, targetColId) {
  await fetch(`/api/epics/${enc(epicId)}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column: targetColId }),
  });
  expanded.delete(epicId);
  await load();
}

function renderCard(epic, colId) {
  const isEditing  = editingId === epic.id;
  const isExpanded = expanded.has(epic.id);
  const card = el("div", `card col-${colId}${isExpanded ? " open" : ""}${isEditing ? " editing" : ""}`);
  card.dataset.id = epic.id;

  const totalT = epic.tasks.length;
  const doneT  = epic.tasks.filter(t => t.done).length;
  const pct    = totalT > 0 ? Math.round(doneT / totalT * 100) : 0;
  const shortId = (epic.id.match(/^PI-\d+/) || [epic.id])[0];
  const displayTitle = epic.title.replace(/^[\w.-]+:\s*/, "");

  if (isEditing) {
    renderEditMode(card, epic, colId, shortId);
  } else {
    // Top row: ID badge
    const top = el("div", "card-top");
    const idBadge = el("span", "card-id");
    idBadge.textContent = shortId;
    top.appendChild(idBadge);
    card.appendChild(top);

    // Title
    const titleEl = el("div", "card-title");
    titleEl.textContent = displayTitle;
    card.appendChild(titleEl);

    // Progress (skip for icebox — frozen, not in progress)
    if (totalT > 0 && colId !== "icebox") {
      const pr = el("div", "prog-row");
      pr.innerHTML = `
        <div class="prog-bar"><div class="prog-fill ${colId}" style="width:${pct}%"></div></div>
        <span class="prog-txt">${doneT}/${totalT}</span>
      `;
      card.appendChild(pr);
    } else if (totalT > 0 && colId === "icebox") {
      // For icebox show just a count badge
      const badge = el("span", "prog-txt");
      badge.style.cssText = "display:inline-block;margin-top:5px;background:rgba(100,116,139,0.12);border-radius:4px;padding:1px 6px;";
      badge.textContent = `${totalT} subtasków`;
      card.appendChild(badge);
    }

    // Actions
    const actions = el("div", "card-actions");

    // ← arrow
    const { prev, next } = getNeighborCols(colId);
    if (prev) {
      const lb = document.createElement("button");
      lb.className = "cbtn arr";
      lb.textContent = "←";
      lb.title = `→ ${prev.label}`;
      lb.onclick = async e => { e.stopPropagation(); await moveCard(epic.id, prev.id); };
      actions.appendChild(lb);
    }
    // → arrow
    if (next) {
      const rb = document.createElement("button");
      rb.className = "cbtn arr";
      rb.textContent = "→";
      rb.title = `→ ${next.label}`;
      rb.onclick = async e => { e.stopPropagation(); await moveCard(epic.id, next.id); };
      actions.appendChild(rb);
    }

    // Expand subtasks button
    if (totalT > 0) {
      const expBtn = document.createElement("button");
      expBtn.className = "cbtn";
      expBtn.textContent = isExpanded ? "▲" : "▼ Subtaski";
      expBtn.onclick = e => { e.stopPropagation(); toggleExpand(epic.id); };
      actions.appendChild(expBtn);
    }

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.className = "cbtn edit-btn";
    editBtn.textContent = "✎";
    editBtn.title = "Edytuj";
    editBtn.onclick = e => { e.stopPropagation(); startEdit(epic.id); };
    actions.appendChild(editBtn);

    card.appendChild(actions);

    // Subtask list (expanded, view mode)
    if (isExpanded && totalT > 0) {
      const lbl = el("div", "subtask-label");
      lbl.textContent = "Subtaski";
      card.appendChild(lbl);

      const list = el("div", "tasks-list");
      epic.tasks.forEach((task, idx) => {
        const row = el("div", `task-row${task.done ? " done" : ""}`);
        const cbId = `v-${epic.id}-${idx}`;
        row.innerHTML = `
          <input type="checkbox" id="${cbId}" ${task.done ? "checked" : ""}>
          <label for="${cbId}">${escHtml(task.text)}</label>
        `;
        row.querySelector("input").onchange = async function() {
          this.disabled = true;
          await fetch(`/api/epics/${enc(epic.id)}/tasks/${idx}`, { method: "PATCH" });
          await load();
        };
        list.appendChild(row);
      });
      card.appendChild(list);
    }

    card.onclick = e => {
      if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
      if (totalT > 0) toggleExpand(epic.id);
    };
  }

  return card;
}

function renderEditMode(card, epic, colId, shortId) {
  const displayTitle = epic.title.replace(/^[\w.-]+:\s*/, "");
  const dirty = dirtyEdits[epic.id] || { title: displayTitle, tasks: epic.tasks.map(t => ({...t})) };

  const top = el("div", "card-top");
  const idBadge = el("span", "card-id");
  idBadge.textContent = shortId;
  top.appendChild(idBadge);
  card.appendChild(top);

  // Title input
  const titleInput = document.createElement("input");
  titleInput.className = "edit-title-input";
  titleInput.value = dirty.title;
  titleInput.oninput = () => { dirty.title = titleInput.value; dirtyEdits[epic.id] = dirty; };
  card.appendChild(titleInput);

  // Subtasks section
  const editTasks = el("div", "edit-tasks");
  const subtaskLbl = el("div", "subtask-label");
  subtaskLbl.textContent = "Subtaski";
  editTasks.appendChild(subtaskLbl);

  const taskRows = el("div");

  const refreshRows = () => {
    taskRows.innerHTML = "";
    dirty.tasks.forEach((task, idx) => {
      const row = el("div", "edit-task-row");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = task.done;
      cb.onchange = () => { dirty.tasks[idx].done = cb.checked; dirtyEdits[epic.id] = dirty; };

      const inp = document.createElement("input");
      inp.className = "edit-task-input";
      inp.value = task.text;
      inp.oninput = () => { dirty.tasks[idx].text = inp.value; dirtyEdits[epic.id] = dirty; };
      inp.onkeydown = e => {
        if (e.key === "Enter") { e.preventDefault(); addSubtaskInput.focus(); }
        if (e.key === "Backspace" && inp.value === "") {
          e.preventDefault();
          dirty.tasks.splice(idx, 1);
          dirtyEdits[epic.id] = dirty;
          refreshRows();
        }
      };

      const delBtn = document.createElement("button");
      delBtn.className = "del-task";
      delBtn.textContent = "×";
      delBtn.title = "Usuń subtask";
      delBtn.onclick = () => { dirty.tasks.splice(idx, 1); dirtyEdits[epic.id] = dirty; refreshRows(); };

      row.appendChild(cb); row.appendChild(inp); row.appendChild(delBtn);
      taskRows.appendChild(row);
    });
  };
  refreshRows();
  editTasks.appendChild(taskRows);

  // Add subtask input
  const addSubtaskInput = document.createElement("input");
  addSubtaskInput.className = "add-task-inp";
  addSubtaskInput.placeholder = "+ Nowy subtask… (Enter)";
  addSubtaskInput.onkeydown = e => {
    if (e.key === "Enter" && addSubtaskInput.value.trim()) {
      dirty.tasks.push({ done: false, text: addSubtaskInput.value.trim() });
      dirtyEdits[epic.id] = dirty;
      addSubtaskInput.value = "";
      refreshRows();
    }
  };
  editTasks.appendChild(addSubtaskInput);
  card.appendChild(editTasks);

  // Footer
  const footer = el("div", "edit-footer");
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn-sm btn-confirm";
  saveBtn.textContent = "✓ Zapisz";
  saveBtn.onclick = async e => { e.stopPropagation(); await saveEdit(epic.id); };

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-sm btn-cancel";
  cancelBtn.textContent = "Anuluj";
  cancelBtn.onclick = e => {
    e.stopPropagation(); delete dirtyEdits[epic.id]; editingId = null; render();
  };

  footer.appendChild(saveBtn); footer.appendChild(cancelBtn);
  card.appendChild(footer);
  setTimeout(() => titleInput.focus(), 0);
}

// ── Edit helpers ──────────────────────────────────────────────────────────────

function startEdit(id) {
  if (editingId && editingId !== id) delete dirtyEdits[editingId];
  editingId = id;
  expanded.add(id);
  render();
}

async function saveEdit(epicId) {
  const dirty = dirtyEdits[epicId];
  if (!dirty) { editingId = null; render(); return; }

  const body = {};
  const epic = allEpics.find(e => e.id === epicId);
  if (epic) {
    const origTitle = epic.title.replace(/^[\w.-]+:\s*/, "");
    if (dirty.title !== origTitle) body.title = dirty.title;
    body.tasks = dirty.tasks.filter(t => t.text.trim());
  }
  try {
    const res = await fetch(`/api/epics/${enc(epicId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    toast("Zapisano ✓");
  } catch { toast("Błąd zapisu!", true); }
  delete dirtyEdits[epicId];
  editingId = null;
  await load();
}

function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();
}

// ── Lane "add here" ───────────────────────────────────────────────────────────

function showLaneAdd(lane, colId, groupName, addBtn) {
  const existing = lane.querySelector(".lane-addinp");
  if (existing) { existing.remove(); return; }

  const wrap = el("div", "lane-addinp");
  wrap.style.cssText = "background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:7px;margin-top:2px;";
  const inp = document.createElement("input");
  inp.style.cssText = "width:100%;border:1px solid var(--planned);border-radius:4px;padding:4px 7px;font-size:12px;font-family:inherit;outline:none;";
  inp.placeholder = "Nazwa nowego taska…";
  inp.autocomplete = "off";

  const doAdd = async () => {
    const title = inp.value.trim();
    if (!title) return;
    inp.disabled = true;
    const res = await fetch("/api/epics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, column: colId, epic_group: groupName === "—" ? "" : groupName }),
    });
    if (res.ok) {
      toast("Dodano ✓");
      wrap.remove();
      await load();
    } else {
      toast("Błąd!", true);
      inp.disabled = false; inp.focus();
    }
  };

  inp.onkeydown = e => { if (e.key === "Enter") doAdd(); if (e.key === "Escape") wrap.remove(); };
  wrap.appendChild(inp);
  lane.insertBefore(wrap, addBtn);
  inp.focus();
}

// ── New epic form (header) ────────────────────────────────────────────────────

function toggleNewForm() {
  const strip = document.getElementById("new-strip");
  strip.classList.toggle("open");
  if (strip.classList.contains("open")) {
    document.getElementById("ne-title").focus();
  }
}

async function submitNew() {
  const title = document.getElementById("ne-title").value.trim();
  const col   = document.getElementById("ne-col").value;
  const group = document.getElementById("ne-group").value.trim();
  if (!title) { document.getElementById("ne-title").focus(); return; }

  const res = await fetch("/api/epics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, column: col, epic_group: group || "—" }),
  });
  if (res.ok) {
    toast("Dodano task ✓");
    document.getElementById("ne-title").value = "";
    document.getElementById("ne-group").value = "";
    toggleNewForm();
    await load();
  } else {
    toast("Błąd!", true);
  }
}

// Key handler for new form
document.getElementById("ne-title").addEventListener("keydown", e => {
  if (e.key === "Enter") submitNew();
  if (e.key === "Escape") toggleNewForm();
});

// ── Utils ─────────────────────────────────────────────────────────────────────

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function enc(s) { return encodeURIComponent(s); }

let toastTimer;
function toast(msg, err = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.background = err ? "#dc2626" : "#1e293b";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
load();
</script>
</body>
</html>"""


# ── CLI helpers ───────────────────────────────────────────────────────────────


def _short_id(epic_id: str) -> str:
    m = re.match(r"^(PI-\d+[\w.]*|BUG-\d+|CHORE-\d+)", epic_id)
    return m.group(1) if m else epic_id


def _display_title(epic: dict) -> str:
    return re.sub(r"^[\w.-]+:\s*", "", epic["title"])


def cli_init() -> None:
    for col in COLS:
        (BACKLOG / col).mkdir(parents=True, exist_ok=True)
    readme = BACKLOG / "README.md"
    if not readme.exists():
        readme.write_text(
            "# Backlog\n\nUtworzony przez kanban.py\n\n"
            "## Struktura\n"
            "- `active/`  — w trakcie (max 1-2)\n"
            "- `planned/` — zaplanowane\n"
            "- `icebox/`  — zamrożone / nice-to-have\n"
            "- `done/`    — ukończone\n"
        )
    print(f"✓ Backlog w: {BACKLOG}")


def cli_list(col_filter: str | None, epic_filter: str | None, as_json: bool) -> None:
    epics = all_epics()
    if col_filter:
        epics = [e for e in epics if e["column"] == col_filter]
    if epic_filter:
        epics = [e for e in epics if e["epic_group"] == epic_filter]
    if as_json:
        output = json.dumps(epics, ensure_ascii=False, indent=2)
        sys.stdout.buffer.write(output.encode("utf-8"))
        return
    if not epics:
        print("(brak)")
        return
    for e in epics:
        total = len(e["tasks"])
        done = sum(1 for t in e["tasks"] if t["done"])
        prog = f"{done}/{total}" if total else "—"
        title = _display_title(e)[:42]
        print(
            f"  {e['column']:<8}  {_short_id(e['id']):<8}  {title:<43}  {prog:>5}  [{e['epic_group']}]"
        )


def cli_show(task_id: str) -> None:
    f = find_file(task_id)
    if not f:
        print(f"✗ Nie znaleziono: {task_id}", file=sys.stderr)
        sys.exit(1)
    col = next((c for c in COLS if f.parent.name == c), "?")
    epic = parse_epic(f, col)
    print(f"ID:      {_short_id(epic['id'])}")
    print(f"Plik:    {f}")
    print(f"Tytuł:   {_display_title(epic)}")
    print(f"Kolumna: {epic['column']}")
    print(f"Epik:    {epic['epic_group']}")
    print(f"Worzono: {epic['created'] or '—'}")
    if epic["tasks"]:
        print("Subtaski:")
        for i, t in enumerate(epic["tasks"]):
            mark = "x" if t["done"] else " "
            print(f"  [{i}] [{mark}] {t['text']}")


def cli_move(task_id: str, column: str) -> None:
    if do_move(task_id, column):
        print(f"✓ {_short_id(task_id)} → {column}")
    else:
        print(f"✗ Nie znaleziono: {task_id}", file=sys.stderr)
        sys.exit(1)


def cli_add(title: str, column: str, epic_group: str) -> None:
    epic = do_create(title, column, epic_group)
    if epic:
        print(f"✓ Utworzono {_short_id(epic['id'])} w {column}  [{epic['epic_group']}]")
        print(f"  Plik: {BACKLOG / column / (epic['id'] + '.md')}")
    else:
        print("✗ Błąd tworzenia", file=sys.stderr)
        sys.exit(1)


def cli_toggle(task_id: str, idx: int) -> None:
    if not do_toggle(task_id, idx):
        print(f"✗ Nie znaleziono: {task_id} subtask {idx}", file=sys.stderr)
        sys.exit(1)
    f = find_file(task_id)
    if f:
        col = next((c for c in COLS if f.parent.name == c), "?")
        epic = parse_epic(f, col)
        if idx < len(epic["tasks"]):
            t = epic["tasks"][idx]
            mark = "✓" if t["done"] else "○"
            print(f"  [{idx}] {mark} {t['text']}")


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    import argparse

    global BACKLOG  # noqa: PLW0603

    parser = argparse.ArgumentParser(
        prog="kanban",
        description="Markdown kanban — GUI + CLI. Kopiuj kanban.py do dowolnego projektu.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Przykłady:
  python3 kanban.py                              # web GUI na :5500
  python3 kanban.py serve 8080                   # web GUI na :8080
  python3 kanban.py --backlog /inny/proj/backlog serve

  python3 kanban.py init                         # utwórz strukturę backlogu
  python3 kanban.py list                         # lista wszystkich tasków
  python3 kanban.py list --col active            # tylko active
  python3 kanban.py list --json                  # JSON (dla agentów)

  python3 kanban.py show PI-014-google-calendar  # szczegóły taska
  python3 kanban.py move PI-014-google-calendar active
  python3 kanban.py add "Nowa funkcja" --col planned --epic "Faza 6"
  python3 kanban.py toggle PI-014-google-calendar 0
""",
    )
    parser.add_argument(
        "--backlog",
        metavar="DIR",
        help="Ścieżka do katalogu backlog/ (domyślnie: ./backlog obok skryptu)",
    )

    sub = parser.add_subparsers(dest="cmd", metavar="KOMENDA")

    p_serve = sub.add_parser("serve", help="Uruchom web GUI")
    p_serve.add_argument("port", nargs="?", type=int, default=5500, metavar="PORT")

    sub.add_parser("init", help="Utwórz strukturę katalogów backlogu")

    p_list = sub.add_parser("list", help="Wylistuj taski")
    p_list.add_argument(
        "--col", metavar="COL", help="Filtruj: active|planned|icebox|done"
    )
    p_list.add_argument("--epic", metavar="EPIC", help="Filtruj po grupie epiku")
    p_list.add_argument("--json", action="store_true", help="Wyjście JSON")

    p_show = sub.add_parser("show", help="Szczegóły taska")
    p_show.add_argument("task_id", metavar="TASK_ID")

    p_move = sub.add_parser("move", help="Przenieś task do kolumny")
    p_move.add_argument("task_id", metavar="TASK_ID")
    p_move.add_argument("column", metavar="COLUMN", choices=COLS)

    p_add = sub.add_parser("add", help="Dodaj nowy task")
    p_add.add_argument("title", metavar="TITLE")
    p_add.add_argument("--col", default="planned", choices=COLS, metavar="COL")
    p_add.add_argument("--epic", default="—", metavar="EPIC")

    p_tog = sub.add_parser("toggle", help="Przełącz subtask (checkbox)")
    p_tog.add_argument("task_id", metavar="TASK_ID")
    p_tog.add_argument("idx", type=int, metavar="INDEX")

    args = parser.parse_args()

    # Override BACKLOG path if provided
    if args.backlog:
        BACKLOG = Path(args.backlog).resolve()
        if not BACKLOG.exists():
            print(f"✗ Katalog nie istnieje: {BACKLOG}", file=sys.stderr)
            sys.exit(1)

    if args.cmd is None or args.cmd == "serve":
        port = getattr(args, "port", 5500)
        server = HTTPServer(("localhost", port), Handler)
        print(f"\033[1;32m→ Kanban GUI: http://localhost:{port}\033[0m")
        print(f"  Backlog:   {BACKLOG}")
        print("  Ctrl+C żeby zamknąć")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n\033[33mZamknięto.\033[0m")

    elif args.cmd == "init":
        cli_init()

    elif args.cmd == "list":
        cli_list(
            col_filter=getattr(args, "col", None),
            epic_filter=getattr(args, "epic", None),
            as_json=getattr(args, "json", False),
        )

    elif args.cmd == "show":
        cli_show(args.task_id)

    elif args.cmd == "move":
        cli_move(args.task_id, args.column)

    elif args.cmd == "add":
        cli_add(args.title, args.col, args.epic)

    elif args.cmd == "toggle":
        cli_toggle(args.task_id, args.idx)


if __name__ == "__main__":
    main()
