---
name: research
description: 'Use when answering QRSPI research questions with facts from the codebase.'
when_to_use: 'Use for the Research step, including repeat runs in a Query ↔ Research cycle. Use `qrspi-x:query` when research reveals a question the code cannot answer.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Research

## Core Philosophy
- Gather facts, not opinions — only research and document findings

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly.

Runtime contract: read `../workflow/references/runtime.md` before dispatch. It defines the fresh-context, filesystem, fallback, and on-disk evidence requirements; this skill adds only Research-specific inputs and output.

## The helper
Helper installation, recovery, and artifact-only fallback are defined by `qrspi-x:workflow`. Research has no `qrspi-x` state of its own; when the helper is available it's used only for backup naming on a rerun and for recording why, per the Task steps below. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
If `research.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/research-<n>.md`, where `n` is one greater than the highest `n` already present for the `research` stem, starting at 1 (if the helper is available, `qrspi-x next-file research --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it. Do this before spawning, so the agent can write a fresh file but cannot overwrite the old one.

Before spawning, prefer the declared agent when the runtime supports named agents:

- If `qrspi-x:researcher` is registered, spawn it directly so the runtime can apply its declared settings.
- Otherwise, read `../../agents/researcher.md`, resolved relative to this `SKILL.md`, and spawn a general-purpose subagent with its full contents as the role instructions.

In either case, pass the feature name so the agent can locate `./qrspi/<feature>/queries.md` and write `./qrspi/<feature>/research.md`. If the human named other locations the research should cover (e.g. a reference or upstream repo on disk), pass them as paths only — no description of the feature. Do not pass `./qrspi/<feature>/background.md` as an additional location; it is human context, not a Research input:

```
If registered: Spawn qrspi-x:researcher agent for feature: <feature-name>
Otherwise: Role instructions: <contents of ../../agents/researcher.md>; spawn a general-purpose subagent for feature: <feature-name>
Additional locations: <paths, or omit>
```

The agent reads `queries.md`, searches the codebase for answers, and writes `research.md` with file paths, line numbers, code snippets, and a New Questions section if research surfaces unknowns. On a rerun, it retains answers for questions still present and adds missing answers.

Using a subagent keeps codebase reads out of the main conversation.

## After the Agent Returns
1. Review the research.md summary the agent reports
2. Stop and wait for human review of `./qrspi/<feature>/research.md`
3. If New Questions were surfaced, offer to cycle back to Query phase (`qrspi-x:query` runs in refinement mode)
4. If the helper is available and this is a rerun worth recording, note why with `qrspi-x history add --feature <feature> --project <path> --text "<why>"`.

Do not proceed to spec automatically.
