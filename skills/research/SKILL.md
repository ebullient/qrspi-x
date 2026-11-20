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

### 1. Back up the previous run
If `research.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/research-<n>.md`, where `n` is one greater than the highest `n` already present for the `research` stem, starting at 1 (if the helper is available, `qrspi-x next-file research --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it. Do this before spawning, so no agent can overwrite the old file. Remember this backup path as `<prior>`; it is how a rerun keeps earlier answers.

### 2. Plan the shards
Read `./qrspi/<feature>/queries.md` — only to count and split it, never to answer it. Each `##` heading is a category; each top-level `- ` item under it is one question.

- **15 questions or fewer:** use one shard containing everything, and skip step 4.
- **More than 15:** split into **2–4 shards** of roughly equal question count, aiming for ~10–15 questions each. Split only at category boundaries and keep categories in their `queries.md` order (e.g. *Requirements Clarity + Scope Boundaries* · *Technical Constraints* · *Integration Points + Edge Cases* · *Success Criteria + Dependencies*). Never split one category across shards and never reword a question.

### 3. Run the shards in parallel
Prefer the declared agent when the runtime supports named agents:
- If `qrspi-x:researcher` is registered, spawn it directly so the runtime can apply its declared settings.
- Otherwise, read `../../agents/researcher.md`, resolved relative to this `SKILL.md`, and spawn a general-purpose subagent with its full contents as the role instructions.

Spawn **all shards in a single message** so they run concurrently. Each shard gets the following, and nothing about the feature itself:

```
Spawn qrspi-x:researcher agent for feature: <feature-name>
Mode: shard <k> of <N>
Questions: <the shard's categories and questions, verbatim from queries.md, headings included>
Output: ./qrspi/<feature>/research-part-<k>.md
Prior answers: <prior>          (omit on a first run)
Additional locations: <paths, or omit>
```
The merge is mechanical:
- Concatenate the categories in `queries.md` order.
- Where two parts cite the same `file:line` for overlapping facts, keep one full entry and cross-reference it from the other answer.
- Combine every part's `## New Questions` into one section and remove duplicates.
- Add no new findings, no opinions, and no codebase reads beyond checking a citation that two parts contradict. Record any such contradiction in the answer instead of picking a winner.

After `research.md` is written, delete the `research-part-*.md` files. They are scaffolding, not backups.

### 5. Result
`research.md` has the same shape as before: answers with file paths, line numbers and code snippets, plus a `## New Questions` section if research surfaced unknowns. On a rerun, answers to questions still in `queries.md` are kept from `<prior>`, and missing answers are added.

Using subagents keeps codebase reads out of the main conversation. The main session reads only `queries.md`, and only to split it.

agents/researcher.md needs to understand the new inputs. Add a section like this under ## Inputs:

### Shard and merge modes
- **Mode: shard k of N.** Answer only the questions given under `Questions:`, verbatim and in order,
  and write to the `Output:` path in place of `research.md`. Do not read `queries.md`. If `Prior answers:`
  is given, carry over its answer for any of your questions that still apply, and re-verify only
  citations whose files changed. Put unknowns in your own `## New Questions` section.
- **Mode: merge.** Read only the `Parts:` files and write `Output:` as described by the research
  skill's step 4. No new findings.
- Without a `Mode`, behave exactly as before (whole `queries.md` → `research.md`).

The ban on reading request.md stays as it is, so every shard stays blind to the feature.

**Optional speedup that work with sharding:**
- **A faster model**. Set model: sonnet (if using Claude) in the researcher's frontmatter. The merge step and fact-gathering don't need the main model.

**What to expect.** With 54 questions split across 4 shards, total time comes to roughly the slowest shard plus a short merge, instead of the sum of all four. The extra cost is the merge agent and some overlap, where two shards read the same core files such as GhClient.
## After the Agent Returns
1. Review the research.md summary the agent reports
2. Stop and wait for human review of `./qrspi/<feature>/research.md`
3. If New Questions were surfaced, offer to cycle back to Query phase (`qrspi-x:query` runs in refinement mode)
4. If the helper is available and this is a rerun worth recording, note why with `qrspi-x history add --feature <feature> --project <path> --text "<why>"`.

Do not proceed to spec automatically.
