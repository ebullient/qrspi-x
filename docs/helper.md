# QRSPI-X helper notes

These notes are a short map of the helper for agents working on the workflow. They describe where the helper looks and the interactive invariants it protects; they are not a replacement for the workflow skills or a CLI reference.

When a note and the implementation disagree, read `tools/src` and tests first. The helper is the source of truth for persisted state and command behavior.

## Start here

- [Workspace](workspace.md) — artifact locations, progress detection, plan parsing, and labels.
- [Interaction](interaction.md) — human gates, evidence checks, recovery, and review outcomes.

## Source map

Paths below are relative to `tools/`.

- `src/cli.ts` parses options, dispatches commands, and chooses output/exit behavior.
- `src/command/` contains the command-level gates and writes.
- `src/workspace/Workspace.ts` owns artifact discovery, phase selection, and generated paths.
- `src/workspace/PlanTable.ts` owns dependency parsing and scope resolution.
- `src/workspace/LoopState.ts` owns unattended execution state and its next action.
- `src/workspace/History.ts` and `Decisions.ts` own the append-only timeline and durable rationale.
- `src/command/import.ts` implements `qrspi-x import <reference>`: fetches issue/PR title and body via `gh` with REST fallback and writes `request.md`.
- `test/` is the executable contract for edge cases and idempotency.

## `import` command

`import` is CLI-only (no corresponding skill or agent):
- Invoked as `qrspi-x import <number> [--feature <name>] [--repo <owner/repo | url>] [--project <path>]`.
- `<number>` accepts issue/PR numbers (e.g. `42` or `#42`).
- `--repo` accepts `owner/repo` shorthand or a GitHub URL (e.g. `https://github.com/owner/repo`). When omitted, repo is inferred from the project directory's git `origin` remote.
- Only `github.com` is supported (no Enterprise Server).
- Fetches title and body via `gh issue view` / `gh pr view`, falling back to unauthenticated public REST API if `gh` is unavailable.
- Derives feature workspace name `gh-<repo>-<n>` or uses explicit `--feature <name>`.
- Refuses to overwrite an existing feature directory (`feature-exists`).
- Writes `# <title>\n\n<body>\n` into `./.qrspi/<feature>/request.md`.
