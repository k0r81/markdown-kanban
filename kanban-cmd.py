#!/usr/bin/env python3
"""Prosty wrapper do obsługi kanban.py przez agenty AI.

Skrócone komendy dla łatwego wywoływania przez AI agents.
"""

import argparse
import subprocess
import sys
from pathlib import Path

KANBAN_SCRIPT = Path(__file__).parent / "kanban.py"


def run_kanban(args: list[str]) -> str:
    """Uruchamia kanban.py i zwraca wynik jako string."""
    try:
        result = subprocess.run(
            [sys.executable, str(KANBAN_SCRIPT)] + args,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        return f"Error: {e.stderr}"


def cmd_list(
    col: str | None = None, epic: str | None = None, as_json: bool = True
) -> str:
    """List tasks."""
    args = ["list"]
    if col:
        args.extend(["--col", col])
    if epic:
        args.extend(["--epic", epic])
    if as_json:
        args.append("--json")
    return run_kanban(args)


def cmd_show(task_id: str) -> str:
    """Show task details."""
    return run_kanban(["show", task_id])


def cmd_add(title: str, col: str = "planned", epic: str = "—") -> str:
    """Add new task."""
    args = ["add", title, "--col", col]
    if epic and epic != "—":
        args.extend(["--epic", epic])
    return run_kanban(args)


def cmd_move(task_id: str, column: str) -> str:
    """Move task to column."""
    return run_kanban(["move", task_id, column])


def cmd_toggle(task_id: str, idx: int) -> str:
    """Toggle subtask checkbox."""
    return run_kanban(["toggle", task_id, str(idx)])


def cmd_init() -> str:
    """Initialize backlog structure."""
    return run_kanban(["init"])


def main():
    parser = argparse.ArgumentParser(
        prog="kanban-cmd",
        description="Wrapper dla kanban.py - uproszczony interfejs dla AI agents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Przykłady:
  python kanban-cmd.py list                    # Lista wszystkich (JSON)
  python kanban-cmd.py list --col active       # Tylko aktywne
  python kanban-cmd.py show PI-014             # Szczegóły
  python kanban-cmd.py add "Nowy task"        # Dodaj do planned
  python kanban-cmd.py move PI-014 active      # Przenieś
  python kanban-cmd.py toggle PI-014 0        # Przełącz subtask
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Komenda do wykonania")

    # List command
    list_parser = subparsers.add_parser("list", help="Lista tasków")
    list_parser.add_argument(
        "--col",
        choices=["active", "planned", "icebox", "done"],
        help="Filtruj po kolumnie",
    )
    list_parser.add_argument("--epic", help="Filtruj po grupie epiku")

    # Show command
    show_parser = subparsers.add_parser("show", help="Szczegóły taska")
    show_parser.add_argument("task_id", help="ID taska")

    # Add command
    add_parser = subparsers.add_parser("add", help="Dodaj nowy task")
    add_parser.add_argument("title", help="Tytuł taska")
    add_parser.add_argument(
        "--col",
        choices=["active", "planned", "icebox", "done"],
        default="planned",
        help="Kolumna",
    )
    add_parser.add_argument("--epic", default="—", help="Grupa epiku")

    # Move command
    move_parser = subparsers.add_parser("move", help="Przenieś task")
    move_parser.add_argument("task_id", help="ID taska")
    move_parser.add_argument(
        "column",
        choices=["active", "planned", "icebox", "done"],
        help="Kolumna docelowa",
    )

    # Toggle command
    toggle_parser = subparsers.add_parser("toggle", help="Przełącz subtask")
    toggle_parser.add_argument("task_id", help="ID taska")
    toggle_parser.add_argument("idx", type=int, help="Indeks subtaska")

    # Init command
    subparsers.add_parser("init", help="Inicjalizuj strukturę backlogu")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    match args.command:
        case "list":
            col = getattr(args, "col", None)
            epic = getattr(args, "epic", None)
            print(cmd_list(col, epic))
        case "show":
            print(cmd_show(args.task_id))
        case "add":
            print(cmd_add(args.title, args.col, args.epic))
        case "move":
            print(cmd_move(args.task_id, args.column))
        case "toggle":
            print(cmd_toggle(args.task_id, args.idx))
        case "init":
            print(cmd_init())


if __name__ == "__main__":
    main()
