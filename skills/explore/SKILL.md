---
name: explore
description: 'Use when a QRSPI feature is not yet defined and the codebase needs surveying for gaps and candidate directions.'
when_to_use: 'Use when the user wants a QRSPI exploration or does not yet know what to build. Skip it when the feature is clear; use `qrspi-x:init` instead.'
disable-model-invocation: false
---

# QRSPI Explore

## Core Philosophy
- Survey and propose options; do not commit to a feature.
- Optional: skip it when the feature is clear and use `qrspi-x:init`. It is not part of the linear workflow and creates no `qrspi-x` state.

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly. Helper state is not used for Explore; the exploration artifact is the source of progress.

Runtime contract: read `../workflow/references/runtime.md` before dispatch. It defines the fresh-context, capability, fallback, and on-disk evidence requirements; this skill adds only Explore-specific inputs and output.

## Task
Before spawning, prefer the declared agent when the runtime supports named agents:

- If `qrspi-x:explorer` is registered, spawn it directly so the runtime can apply its declared settings.
- Otherwise, read `../../agents/explorer.md`, resolved relative to this `SKILL.md`, and spawn a general-purpose subagent with its full contents as the role instructions.

In either case, pass an exploration name and topic:

```
If registered: Spawn qrspi-x:explorer agent for exploration: <exploration-name>
Otherwise: Role instructions: <contents of ../../agents/explorer.md>; spawn a general-purpose subagent for exploration: <exploration-name>
Topic: <area of interest, e.g. "what does <reference framework> provide that this extension doesn't yet adapt">
```

The agent surveys broadly, forms opinions, and proposes candidate directions. It stays in the current project unless the topic explicitly names a local reference or upstream path.

Using a subagent keeps exploratory reads out of the main conversation.

## After the Agent Returns
1. Review its observations, gaps, candidate directions, and open questions.
2. Stop for human review of `./qrspi/explore/<exploration-name>/explore.md`.
3. If a direction is worth pursuing, start `qrspi-x:init` with a specific feature name; optionally provide `explore.md` as context.

Do not write request.md, generate queries, or otherwise start the normal QRSPI flow automatically — Explore only produces the survey.
