# Duplication to keep in sync

Facts that are intentionally repeated across multiple files in QRSPI-X. Check this list before editing any file it names — these are not accidents to clean up, but copies that must agree.

**Per-step implementation mechanics** appear in two places:

- [skills/qrspi-implement/SKILL.md](../skills/qrspi-implement/SKILL.md) — interactive, gated, human present
- [agents/implementer.md](../agents/implementer.md) — unattended, spawned by `autoloop`

The shared part is the step sequence: mark `[~]` → change → verify → commit → mark `[x]`. Commit before marking `[x]`, so a completed marker always has a commit behind it. Progress comes from phase markers; state is written by the caller through the helper. **If you change that sequence, change it in both.**

The differences are intentional and should not be "fixed" into agreement:

| | `implement` skill | `implementer` agent |
|---|---|---|
| Approval | pauses per execution mode | never pauses — nobody's there |
| Execution modes | four (single/partial/phase/full) | one: the phase it's given |
| Commits | per step, unless human asks per-phase | one per step; repairs always a new commit |
| Bookkeeping | markers and commits per step | markers and commits per step |
| Bad plan | stop, explain, propose, await approval | stop, record, report |
| Repair mode | none | half the contract |

The agent is stricter because it is unattended. Don't import that strictness into the interactive skill, and don't relax it in the agent.

The transition table in `skills/qrspi-workflow/SKILL.md` and the helper command/workspace implementations under `tools/src/command/` and `tools/src/workspace/` must change together. So must any skill text that names a helper command, option, result field, finding code, or Markdown heading the helper parses — the helper is the contract, and a skill that disagrees with it fails at runtime. **The bare `qrspi-x` invocation form is duplicated across all ten stateful skills and `README.md`; change one and check the others.** Before committing helper or skill changes, run `cd tools && npm run fullbuild`; the generated bundle is ignored. Don't bump versions by hand: the manual release workflow sets the version in `tools/package.json` and `.claude-plugin/plugin.json` and commits the bump.

**Diff scope resolution** appears in `reviewer` and `explainer` with near-identical wording (the `git merge-base` fallback against the default branch, and stopping rather than guessing a scope). These two drifting apart is a real risk; check the other when you touch one. `explorer` has no diff-scope section — it surveys a codebase rather than a change.

**No agent enumerates the artifacts.** The reviewer decides by location: everything under `.qrspi/` is scaffolding, never a product file and never blocking, whatever it is named and whichever feature it belongs to. Only an untracked source file *outside* `.qrspi/` blocks, because that one silently leaves the diff under review. Nothing inside `.qrspi/` is reported at all, recognized or not — humans and agents leave working notes and checklists in the workspace, and naming them would reintroduce recognition-by-filename through the back door. `explainer` likewise states only that QRSPI artifacts are read directly and are not part of the product diff, and `explorer` says nothing about artifacts at all.

This replaced an allowlist of filenames, which twice blocked a layout the rest of the plugin supported — once for `plan-phase-*.md`, once for `queries.md.bak*` — because a list of names cannot anticipate what a skill or agent will legitimately write. So adding an artifact needs no reviewer change; don't go looking for a list to update.

**The QRSPI artifact inventory** — including the `plans/`, `backups/`, and `reviews/` subdirectories, not just the root-level files — is repeated in the workflow staleness rules. `workflow` never cleans up `./.qrspi/<feature>/`; disposing of any artifact there, done or not, is the human's call, so there is no cleanup keep/remove list to keep in sync. When adding or renaming an artifact, check the staleness rules so resume logic still agrees about what is metadata, what is retained, and what becomes stale. The reviewer is not one of these copies — it goes by location, not by name.

**The backup rule** is stated four times, once in each skill that owns a rerunnable artifact: `query` (`queries`), `research` (`research`), `shape` (`approach`), and `spec` (`spec`). Each copy is deliberately self-contained — a skill is a prompt loaded on its own, so a cross-reference to another skill is a read the agent may never make. The load-bearing part is identical by design — the stem aside, the numbering, the no-overwrite guarantee, and the "create `backups/` only when there is something to put in it" clause must match word for word. What follows that clause may differ: `query` and `research` add that the agent cannot overwrite the old file, and `research` says to do it before spawning, because those two hand the artifact to a subagent; `shape` hands its new artifact to a subagent and supplies the previous approach backup explicitly to retain the human decision; `spec` writes its artifact in the parent conversation. Change one and change all four, or reruns of different steps will number or overwrite backups differently, which is exactly the inconsistency the old undefined `queries.md.bak` scheme produced.

## Self-contained skill references

`agents/*.md` are the canonical role contracts and `docs/runtime.md` is the canonical runtime contract. Each `skills/qrspi-*/references/runtime.md` is an exact copy of the runtime contract. Copy the roles into only the callers that use them:

| Skill | Role copies |
|---|---|
| qrspi-query | query.md |
| qrspi-research | researcher.md |
| qrspi-shape | shaper.md |
| qrspi-review | reviewer.md, explainer.md |
| qrspi-autoloop | implementer.md, reviewer.md |
| qrspi-explore | explorer.md |

The other skills need only `runtime.md`. When editing a canonical file, update its copies in the same change and compare them byte-for-byte. Do not replace bundled links with `../../agents/` paths: those break when a skill is installed independently. No generator or installer script is required for this branch.

Research reruns answer all current questions from current source evidence; backups are for the human, not Research input. Shape alone receives an explicitly selected prior-approach backup. Workflow staleness guidance and the caller/role input contracts must agree about these exceptions.

## Traceability and snapshots

The canonical runtime contract defines stable criterion IDs, provenance, normalized plan approval digests, review snapshots, and gate summaries. Spec/Plan create that metadata; Implement and its role check it and report evidence; Review and its role check snapshot freshness; Workflow and Autoloop enforce it at transitions and resume. Keep those contracts aligned. `verification/` reports are caller/human evidence, never reviewer claims. Markdown metadata does not change helper state or parsed verdict/table formats.
