---
name: qrspi-query
description: "Use when generating isolated research questions from a QRSPI feature request."
---

# QRSPI Query

## When to use

Use for the Query step, including refinement after Research surfaces new questions. Use `qrspi-research` to answer the questions; Query must not read the codebase.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Only generate questions, nothing else
- Questions come from the feature request, not the codebase - exploring the code to ground or answer questions is Research's job, not Query's
- Not every question is for Research - some are about intent only the requester can resolve; those get asked and answered directly, then folded into request.md, never left sitting in queries.md

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined in [the runtime contract](references/runtime.md). Query has no `qrspi-x` state of its own; when the helper is available it's used only for backup naming on a regeneration and for recording why, per the Task steps below. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Always generate `queries.md` with the bundled Query role in a fresh subagent, so question generation happens in isolation from the codebase and from anything already explored in this conversation (research findings, a prior feature's work, earlier tool calls, etc.). Never compose or append questions in the parent conversation. If the Query agent returns the complete artifact text instead of writing it, persist that text verbatim without adding or changing questions.

1. Check `./qrspi/<feature>/request.md`.
   - If it exists, read it — this is the feature intent to pass to the agent.
   - If it doesn't exist, route back through `qrspi-init` to capture the request before continuing. Preserve any optional human context in `background.md` through Init.
2. Verify fresh-context delegation is available as described in the runtime contract, then determine the mode before moving any artifact:
   - **Initial** — no `queries.md` exists.
   - **Refinement** — this pass follows Research whose `research.md` has a non-empty `## New Questions` section.
   - **Regeneration** — `queries.md` exists and Query is being rerun after clarification, a backward jump, or an explicit request to revise questions.
3. If `queries.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/queries-<n>.md`, where `n` is one greater than the highest `n` already present for the `queries` stem, starting at 1 (if the helper is available, `qrspi-x next-file query --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it. The agent can write a fresh file but cannot overwrite the old one.
4. Read [the Query role](references/query.md). Launch a **new, fresh-context subagent with no inherited conversation history**, supplying the role and only the explicit inputs below. Do not resume or reuse an agent that has seen research, source files, or the main conversation. Check that fresh contexts are available before moving the current artifact; if they are unavailable, stop this step. Named-agent registration is optional and does not establish isolation by itself.

```
Role: <complete contents of references/query.md>
Project root: <path, for writing the output only>
Feature: <feature-name, an output locator only>
Output: <project-root>/qrspi/<feature>/queries.md
Mode: <initial | refinement | regeneration>
Feature request: <request.md verbatim; the raw brief and human clarifications>
Prior queries: <verbatim question-only queries from the backup, if any>
New questions from research: <verbatim ## New Questions list, refinement only>
Additional questions from the human: <verbatim questions, if any>
```

Do not pass repository reads, Research answers, summaries, rationale, prior tool output, or conversational history. Additional lists must contain questions only, not embedded findings; if a list mixes questions with findings, have the human restate the questions before spawning. The feature name and project path are output locators, not permission to inspect the project. Query may write its artifact and report Questions for the User; it must not read files, search, browse, or run commands to gather information. Use enforceable tool restrictions when supported; otherwise these are tool-use instructions, **not a hard security boundary**. See the runtime contract for details. If repository-derived claims appear, reject the pass and rerun in a fresh context.

## After the Agent Returns
1. Read the agent's report for question counts and any Questions for the User.
2. If there are Questions for the User, append them to `request.md` under `## Open Questions` (create the section if needed; preserve the original request), then ask them. Move each answered question to `## Clarifications` with its answer. This revises intent, not `queries.md`.
3. If `## Clarifications` changed in step 2, rerun in Regeneration mode so `queries.md` reflects the clarified intent while preserving still-relevant questions.
4. Once a pass comes back with no Questions for the User, stop and wait for human review of `./qrspi/<feature>/queries.md`. Do not treat unanswered Open Questions as resolved; Spec will block on them.
5. If the helper is available and this is a regeneration worth recording, note why with `qrspi-x history add --feature <feature> --project <path> --text "<why>"`.

Do not proceed to research or any other step automatically.
