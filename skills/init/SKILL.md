---
name: init
description: 'Use when starting a QRSPI feature workspace before Query.'
when_to_use: 'Use when starting a new QRSPI feature before Query. If the feature is already clear but Init was skipped, run Init before Query.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Init

## Core Philosophy
- Only capture intent and set up the workspace, nothing else
- Required before Query — if the feature is already clear, capture that intent briefly and continue through the normal workflow

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined by `qrspi-x:workflow`. Init has no `qrspi-x` state of its own; `request.md`'s presence is the only signal, with or without the helper. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Capture what's being built, in the user's own words, before any question-generation or research begins. `request.md` is the one artifact allowed to say what the feature actually is — everything downstream (`queries.md`, `research.md`) must stay free of it.

1. Use the feature request from the conversation or command. If only a feature name was given (for example, `/qrspi-x:workflow <feature-name>`), ask the human for the request; do not infer it from the name.
2. Determine the feature name as a short kebab-case identifier matching `[a-z0-9]+(?:-[a-z0-9]+)*`. Reject path separators, `.`/`..`, and `explore` (reserved for surveys).
3. If `request.md` exists, treat it as the captured intent and a resume. If it does not exist, capture it as a new request.
4. Confirm `./qrspi/` is gitignored: `git check-ignore -q ./qrspi/`. If it is not, offer to add it — do not edit `.gitignore` without their agreement. Without this, artifacts show as uncommitted work and the helper's `dirty-tree` finding fires on every command.
5. For a new workspace, write `request.md` with the feature request/intent. Preserve any human-supplied context in optional `background.md`.
6. Stop for human confirmation that a new `request.md` captures the intent.

## Output Format
`request.md` is freeform prose or a short list — whatever the user actually said. No acceptance criteria and no behavioral delta (that's Spec's job). Avoid writing a proposed technical approach here if you can help it — a stated approach at this stage biases Query's questions and Research's framing, the same way it would if it leaked into `queries.md` directly. `background.md`, when present, is for human context and is not passed to Query or Research automatically.

Do not generate questions, do research, or propose a design. Your job ends when `request.md` is written.
