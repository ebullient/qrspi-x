# Contributing to QRSPI-X

This guide is for people modifying the QRSPI-X skills and roles themselves. For installing and running the workflow, see [README.md](README.md). The skills and agents under this repository are prompts that execute the workflow; the private TypeScript helper under `tools/` provides optional durable state and loop bookkeeping.

## Repository layout

```text
skills/qrspi-<name>/SKILL.md  portable skill entrypoint
skills/qrspi-<name>/references/  bundled runtime and role contracts
agents/<name>.md          canonical runtime-neutral role contracts
.claude-plugin/           legacy manifest, unchanged by this port
tools/                    published helper source and build metadata
docs/                     helper and repository invariants
```

In Codex invoke skills as `$qrspi-<name>`. Caller skills launch fresh subagents with the full bundled role and explicit inputs; they do not rely on a named-agent registry. The helper remains `qrspi-x`.

## Skill structure and runtimes

Each skill folder includes `references/runtime.md` and only the role files it needs. This allows a skill to be copied or symlinked independently into Codex's `.agents/skills/` directory. [docs/codex.md](docs/codex.md) explains manual installation and migration. Installer scripts and release changes are outside this branch's finalized scope.

Keep canonical role contracts in `agents/` and the canonical runtime contract in `docs/runtime.md`. Update their bundled copies in the same change, comparing them byte-for-byte; [docs/duplication.md](docs/duplication.md) lists the callers. The legacy manifest is retained, but plain Markdown roles do not register Claude named agents.

## Skills and agents

A skill runs in the main conversation. It orchestrates the workflow, talks to the human, records state through the helper when available, and spawns agents. An agent performs the heavy reading or writing in a fresh context and returns an artifact and concise report.

The split is load-bearing: Query must not see the codebase, Research must not see Query's reasoning or feature intent, and Review must not see the implementer's conversation. Read [the runtime contract](docs/runtime.md) for input envelopes and stopping conditions. Spawning a child or naming a role does not alone prove that history was excluded. If fresh contexts are unavailable, stop the isolated step instead of doing it in the parent.

### Role contracts

Role files are plain Markdown. Preserve the session model and reasoning selection unless the user requests another model. Describe permitted reads and writes in the contract; apply enforceable restrictions when the client supports them. Markdown and broad shell access do not provide a per-tool allowlist or filesystem isolation.

The Query caller may save a complete returned artifact verbatim when the child lacks a writing-only tool. Review must write its complete verdict artifact before completion is recorded. A parent must never manufacture a review artifact from a verdict-only reply.

### Authorization and style

[AGENTS.md](AGENTS.md) authorizes required QRSPI delegation within the requested workflow and independent prompt validation in disposable workspaces. Keep that authorization limited to the user's scope and runtime permissions. Optional explanation requires an opt-in, and unattended implementation requires the resolved Autoloop entry gate.

Skills use `name` and `description` frontmatter, with `qrspi-*` names matching their folders. Descriptions identify the task; `## When to use` distinguishes neighboring steps. Keep `## Core Philosophy` short. Use second person for agents and imperative voice for skills.

## Helper development

The helper is the only TypeScript package in this repository. Its source and tests are under `tools/`:

```text
tools/
├── src/       helper implementation
├── test/      helper tests
├── build.mjs  bundle entry point
└── package.json
```

Install dependencies and run the complete local check before committing helper changes:

```bash
cd tools
npm ci
npm run fullbuild
```

`fullbuild` runs linting, tests, typechecking, and the production bundle. Edit `tools/src/`; do not edit `tools/dist/` directly. The generated bundle is ignored and is rebuilt for releases.

The release workflow publishes the helper and updates the release metadata. Do not bump versions by hand.

## Artifacts and persisted state

Workflow artifacts belong to the project using QRSPI-X, not this repository. They live under `./qrspi/<feature>/`, are disposable scaffolding, and are never committed as product files.

Persisted helper state lives in `loop-state.json`, `history.jsonl`, and `decisions.md`. [docs/workspace.md](docs/workspace.md) and [docs/interaction.md](docs/interaction.md) describe their shape and invariants; update those documents when persisted state or interactive behavior changes.

Updates must be idempotent. Helper records should be no-ops when they would change nothing, while history remains append-only for completed transitions. Each skill owns its own completion fields; the orchestrator owns navigation and `--step` jumps. Record transitions before acting, especially in autoloop, so an interrupted session records what it was doing rather than what it last finished.

Review and explain artifacts use non-empty, never-reused kebab-case labels such as `phase-2`, `phase-2-r2`, and `final`. A reused label must stop rather than overwrite an existing artifact.

## Keep duplicated contracts synchronized

Several facts are intentionally repeated across skills, agents, and the helper. Before changing one, check [docs/duplication.md](docs/duplication.md), especially for:

- per-step implementation mechanics in `skills/qrspi-implement/SKILL.md` and `agents/implementer.md`;
- the helper's command and transition contract;
- diff-scope resolution in the reviewer and explainer;
- the workflow artifact inventory and staleness rules; and
- backup naming and no-overwrite behavior in Query, Research, Shape, and Spec.

If helper behavior changes, update the skills and user-facing README when the workflow runner can observe the change. If the helper's persisted state changes, update the workspace or interaction documentation too.

## Before submitting a change

- Re-read every file you edited in full.
- Run `cd tools && npm run fullbuild` for helper or helper-contract changes.
- Check `git diff --check`.
- Confirm no `qrspi/` workflow artifacts or generated `tools/dist/` files are included.
- Match the repository's gitmoji commit style (`✨`, `🐛`, `📝`, `🔧`, or `🔖`) when writing a commit message.
