---
name: autoloop
description: 'Use when a trusted QRSPI spec and plan should run unattended for one phase or all remaining phases.'
when_to_use: 'Use when a `./qrspi/<feature>/` workspace has an approved spec and plan and you want unattended execution. For human-gated execution, use `qrspi-x:workflow` or `qrspi-x:implement`.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Autoloop

## Core Philosophy
- Spawn and track; never implement or review in this conversation
- One repair attempt per phase, then a human

Runtime contract: read `../workflow/references/runtime.md` before each role dispatch. It defines the fresh-context, capability, fallback, and on-disk evidence requirements; this skill adds only Autoloop's unattended sequencing and helper lifecycle.

At entry, state that the human approves the scope and owns final review; autoloop implements, reviews, repairs once, and advances or stops between those gates. Interim reviews use the implementing context, so they are a fast filter, not an independent check.

## The helper

Command examples below are helper subcommands; invoke them as `qrspi-x <subcommand> ...`.

All loop state goes through the helper; never edit `loop-state.json` directly. Check findings on every command, including `status`, `log`, and `loop`, before using any payload. Exit codes are `0` clean, `1` hard block, `3` success with a finding, and `127` not found; `status`/`start` print payloads, while successful `log` and lifecycle actions print `{}`.

If `qrspi-x` is not found (exit 127), tell the human to run `npm i -g @ebullient/qrspi-x`. Autoloop cannot run unattended without it — this is a hard stop, not a degrade-and-continue case.

When a command or flag is unclear, use `qrspi-x --help` or the command's `--help`; do not guess.

## Entry gate

Run `status`. If `loop` is present and `next.action` is not `done`, a loop already exists: go to **Resuming** instead.

Agree the run with the human: choose one phase or all remaining phases (default to one; selectors are `all`, `3`, `2..4`, or `1,3`), confirm it will implement and commit one commit per step, review each phase, and repair once on failure, and confirm it will not run final review.

Then run `loop start <selector> --feature <feature> --project <path>`. It runs the helper's entry checks and resolves the scope, adding any incomplete phases the selection depends on. If it refuses, it wrote nothing: each finding's message says what is wrong and usually how to fix it, so work through them with the human and run it again.

Once it succeeds, nothing has been spawned. Show the resolved `phaseIds` and wait for the only approval. If rejected, run `loop abandon "<reason>" --feature <feature> --project <path>` and start over with a different selector.

## Loop state

The helper owns `loop-state.json` while a loop runs; `status` reports the current scope, phase, checkpoint, conditions, and stop reason under `loop`, which disappears when the loop ends. Full review history survives in `history.jsonl`; read it with `history read --kind review` when handing back.

Each spawn is bracketed: `start <task> --loop` **before** spawning, `log <task>` after the agent returns. `start ... --loop` writes the pre-spawn intent to `loop-state.json` before anything runs, so a session that dies mid-spawn leaves that behind rather than what it last finished — a retried `start ... --loop` reads it back instead of starting over. `log <task>` reads the agent's output from disk — phase markers, commits, the review artifact — and records the outcome; it does not trust the agent's report.

## The loop

Before each implementation, review, repair, or re-review spawn:

- If the named `qrspi-x:implementer` or `qrspi-x:reviewer` agent is registered, spawn it directly so the runtime applies its settings.
- Otherwise, read the matching `../../agents/implementer.md` or `../../agents/reviewer.md` relative to this skill, then spawn a fresh general-purpose subagent with that file's full contents as its role instructions.

Drive the loop from the helper: run `status`, act on `next.action`, and repeat until the action is `done`, `stop`, or `acknowledge-required`.

If `start implement --loop`/`start review --loop` reports the phase's base as stale or missing (e.g. a human fixed a FAIL by hand mid-run), determine the correct base — current HEAD is a reasonable default — and retry the same call with `--base <commit-ish>`. Ask the human if you aren't sure.

### `implement`

Run `start implement --phase <phaseId> --loop --feature <feature> --project <path>`. The result carries `phaseId`.

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: phase
Phase: <phaseId>
```

When it returns:
- If completed, run `log implement --phase <phaseId> --feature <feature> --project <path>`. 
- If STOPPED, run `loop stop "<its Stopped because paragraph>" --feature <feature> --project <path>` (see **`stop`, `acknowledge-required`, or `done`**, below) — one call records the stop in both `loop-state.json` and `history.jsonl`, so the reason stays durable even after the loop ends. Do not retry a stopped implementer.

### `review` or `re-review`

Run `start review --phase <phaseId> --loop --feature <feature> --project <path>`. The result carries the checkpoint `label` and the phase `diff` command. Use them exactly; never compose a label — the reviewer stops rather than overwrite a finished review, which would strand the loop.

If `./qrspi/<feature>/reviews/<label>.md` does not exist, create it with your file-writing tool containing exactly the line `## Verdict: PENDING`. If it exists, leave it alone. The stub marks the review as launched; the reviewer overwrites it, but refuses any other existing file.

```
Spawn qrspi-x:reviewer agent for feature: <feature-name>
Diff: <diff>
Phase: <phaseId>
Label: <label>
```

Do not spawn the explainer; it is an opt-in aid for a human who is present.

When it returns, run `log review --label <label> --feature <feature> --project <path>`: the helper reads the verdict from the artifact and that becomes the next `next.action` on your following `status` call. Conditions never trigger a repair; they are reported at the end.

### `repair`

Run `start repair --phase <phaseId> --loop --feature <feature> --project <path>`. This consumes the phase's single repair attempt before spawning the agent. After the repair, review again; if it still fails, stop the loop rather than iterating further. The result's `review` is the failed review's path relative to `./qrspi/<feature>/`.

```
Spawn qrspi-x:implementer agent for feature: <feature-name>
Mode: repair
Phase: <phaseId>
Review: ./qrspi/<feature>/<review>
```

When it returns:
- If completed, run `log implement --phase <phaseId> --feature <feature> --project <path>` (or `log repair` — same call, either name accepted).
- If STOPPED, run `loop stop "<reason>" --feature <feature> --project <path>`, as above.

### `advance`

Mark the finished phase `[x]` in `plan.md`, then run `loop advance --feature <feature> --project <path>`. The helper moves to the next phase in scope, or marks the loop `done` when the scope is complete.

### `stop`, `acknowledge-required`, or `done`

Go to **Handing back**. If the helper returns an action it has not listed here, stop and hand back rather than guess.

## Context discipline

Do not read source files, run diffs, or read review artifacts beyond the verdict and findings table. Put every heavy read in a subagent. The orchestrator holds only scope, verdicts, and state so it can survive to the end of the run.

## Resuming

Run `status`. If there is no `loop` key, this is not a resumable autoloop run; start from the entry gate.

Otherwise dispatch on `next.action` exactly as in **The loop**. `start ... --loop` and `log <task>` are both idempotent, keyed by actual on-disk state — a relaunch after a crash re-reads `inFlight` from `loop-state.json` and the real evidence on disk (phase markers, commits, the review artifact), and produces the same result a continuing session would have: an interrupted implementer's retried `start implement --loop` returns the same phase rather than a fresh one; a review action reuses its recorded label and any PENDING stub.

If the action is `acknowledge-required`, the loop is stopped (`loop.stoppedReason`) or has open conditions. Report them and wait for the human; do not resume past them. After the human has acted — fixed the problem, written a verdict into a leftover PENDING stub, or relaunched it themselves — run `loop ok "<what they did>" --feature <feature> --project <path>` and continue from its `action` field; the same call also records the resolution durably in `history.jsonl`. If the human wants to end the run instead, run `loop abandon "<reason>" --feature <feature> --project <path>`.

## Handing back

Stop and report. Do not run the final review, create a PR, or clean up artifacts.

Report:
1. **Outcome** — completed in full, or stopped (and why, from `status`'s `loop.stoppedReason`).
2. **Phases completed**, with each review label and verdict — run `history read --kind review --feature <feature> --project <path>` for the full trail (`loop.checkpoint`, if a loop is still active, only ever holds the single latest one) and report the entries for this run's phases.
3. **Accumulated conditions** from `status`'s `loop.conditions` (while the loop is still active) or from the `history read --kind review` trail's `conditions` fields (once it has ended) — every non-blocking finding the loop advanced past, grouped by phase. These were never fixed; they are the human's to triage.
4. **Where it stopped**, if it stopped: the phase, the cycle, the blocker, and the relevant review artifact path.
5. **What's next** — the final review, run by the human, ideally on a different model than this session used.

Commits are one per step, plus one per repair — no commit-mode choice, this is the only shape an unattended run produces. Offer to squash before the final review, every run, but do not squash unasked — the commits are the record of what the loop did, and they are the only way to see where a phase went wrong until the human chooses to collapse them.
