---
name: qrspi-explore
description: "Use when a QRSPI feature is not yet defined and the codebase needs surveying for gaps and candidate directions."
---

# QRSPI Explore

## When to use

Use when the user wants a QRSPI exploration or does not yet know what to build. Skip it when the feature is clear; use `qrspi-init` instead.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Survey and propose options; do not commit to a feature.
- Optional: skip it when the feature is clear and use `qrspi-init`. It is not part of the linear workflow and creates no `qrspi-x` state.

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly. Helper state is not used for Explore; the exploration artifact is the source of progress.

## Task
Read [the Explorer role](references/explorer.md) and launch a fresh-context subagent with the complete role, project root, exploration name, and topic. Named-agent registration is optional.

```
Role: <complete contents of references/explorer.md>
Project root: <path>
Exploration: <exploration-name>
Topic: <area of interest and any explicitly allowed reference paths>
```

The agent surveys broadly, forms opinions, and proposes candidate directions. It stays in the current project unless the topic explicitly names a local reference or upstream path.

Using a subagent keeps exploratory reads out of the main conversation.

## After the Agent Returns
1. Review its observations, gaps, candidate directions, and open questions.
2. Stop for human review of `./qrspi/explore/<exploration-name>/explore.md`.
3. If a direction is worth pursuing, start `qrspi-init` with a specific feature name; optionally provide `explore.md` as context.

Do not write request.md, generate queries, or otherwise start the normal QRSPI flow automatically — Explore only produces the survey.
