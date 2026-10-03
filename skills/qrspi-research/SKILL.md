---
name: qrspi-research
description: "Use when answering QRSPI research questions with facts from the codebase."
---

# QRSPI Research

## When to use

Use for the Research step, including repeat runs in a Query ↔ Research cycle. Use `qrspi-query` when research reveals a question the code cannot answer.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Gather facts, not opinions — only research and document findings

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined in [the runtime contract](references/runtime.md). Research has no `qrspi-x` state of its own; when the helper is available it's used only for backup naming on a rerun and for recording why, per the Task steps below. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Verify fresh-context delegation is available before changing any artifact.

If `research.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/research-<n>.md`, where `n` is one greater than the highest `n` already present for the `research` stem, starting at 1 (if the helper is available, `qrspi-x next-file research --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it. Do this before spawning, so the agent can write a fresh file but cannot overwrite the old one.

Read [the Research role](references/researcher.md). Launch a **new, fresh-context subagent with no inherited conversation history**. Pass only the role, project root, feature locator, questions path, output path, and any additional source locations the human explicitly named:

```
Role: <complete contents of references/researcher.md>
Project root: <path>
Questions: ./qrspi/<feature>/queries.md
Output: ./qrspi/<feature>/research.md
Additional source locations: <paths, or omit>
```

Do not pass the feature brief, `request.md`, `background.md`, Query's reasoning or Questions for the User, design suggestions, implementation narrative, or parent summaries. The feature name is only a workspace locator. Do not pass any other QRSPI artifact as an additional source location.

On every pass, answer **all current questions from current source evidence**. The old research artifact has been backed up for the human and is not a Research input; rereading the questions avoids stale answers and keeps the input contract limited to questions. Broad source searches must exclude every `qrspi/` tree, even if it is tracked or appears inside an additional source location. Open only the explicit questions path within QRSPI scaffolding. Research writes a complete fresh `research.md` with cited facts and a New Questions section.

A named agent is optional. Its registration does not replace the fresh-context and input contract. If the runtime cannot create an agent without inherited history, stop before moving the old artifact; do not research in the parent conversation.

## After the Agent Returns
1. Review the research.md summary the agent reports
2. Stop and wait for human review of `./qrspi/<feature>/research.md`
3. If New Questions were surfaced, offer to cycle back to Query phase (`qrspi-query` runs in refinement mode)
4. If the helper is available and this is a rerun worth recording, note why with `qrspi-x history add --feature <feature> --project <path> --text "<why>"`.

Do not proceed to spec automatically.
