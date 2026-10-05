# QRSPI-X helper notes

These notes are a short map of the helper for agents working on the workflow. They describe where the helper looks and the interactive invariants it protects; they are not a replacement for the workflow skills or a CLI reference.

When a note and the implementation disagree, read `tools/src` and tests first. The helper is the source of truth for persisted state and command behavior.

## Start here

- [Workspace](workspace.md) — artifact locations, progress detection, plan parsing, and labels.
- [Interaction](interaction.md) — human gates, evidence checks, recovery, and review outcomes.

## Source map

Paths below are relative to `tools/`. Each module under `src/workspace/` (and any sibling directory for a distinct concern, e.g. `src/plugin/`) is one typed interface plus one factory that closes over its dependencies and returns it — `workspaceAt(root)`, `gitAt(cwd)`, `historyAt(root)` are the pattern to match. Don't scatter a concern into loose top-level exported functions instead of one factory's methods, and don't split one concern across many files; group what belongs together (e.g. git-hosting/GitHub-API concerns belong alongside `Git.ts`, not in a new top-level module) and keep the file count tight.

- `src/cli.ts` parses options, dispatches commands, and chooses output/exit behavior.
- `src/command/` contains the command-level gates and writes.
- `src/workspace/Workspace.ts` owns artifact discovery, phase selection, and generated paths.
- `src/workspace/PlanTable.ts` owns dependency parsing and scope resolution.
- `src/workspace/LoopState.ts` owns unattended execution state and its next action.
- `src/workspace/History.ts` and `Decisions.ts` own the append-only timeline and durable rationale.
- `src/command/import.ts` implements `qrspi-x import <reference>`: fetches issue/PR title and body via `gh` with REST fallback and writes `request.md`.
- `test/` is the executable contract for edge cases and idempotency. Tests run against a real `mkdtemp` filesystem and inject fakes only at the true external boundary (git, `gh`/`execFile`, `fetch` — see `test/fixtures.ts`), never mocking this project's own modules. Each `it()` names one behavior as a claim, not a mechanism. A command-level test proves it called the right lower-level primitive correctly and produced the right result shape; it doesn't re-assert that primitive's own internal logic, which belongs to that primitive's own test file.

## Workflow commands

- decision
- history
- log
- loop
- next-file
- start
- status

## User-facing commands

- import
- plugin
