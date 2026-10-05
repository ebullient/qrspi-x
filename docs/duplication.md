# Duplication to keep in sync

The portable workflow contract is canonical. Runtime-specific packaging, discovery, model, and tool-enforcement notes may repeat only as thin, clearly labeled adapter guidance in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, skills, or agents. When a runtime cannot enforce a role requirement, the adapter must say so instead of copying the contract and implying equivalent enforcement.

Facts that are intentionally repeated across multiple files in this plugin. Check this list before editing any file it names — these are not accidents to clean up, but copies that must agree.

**Per-step implementation mechanics** appear in two places:

- [skills/implement/SKILL.md](../skills/implement/SKILL.md) — interactive, gated, human present
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

The transition table in `skills/workflow/SKILL.md` and the helper command/workspace implementations under `tools/src/command/` and `tools/src/workspace/` must change together. So must any skill text that names a helper command, option, result field, finding code, or Markdown heading the helper parses — the helper is the contract, and a skill that disagrees with it fails at runtime. **The bare `qrspi-x` invocation form is duplicated across all ten stateful skills and `README.md`; change one and check the others.** Before committing helper or skill changes, run `cd tools && npm run fullbuild`; the generated bundle is ignored. Don't bump versions by hand: the manual release workflow sets the version in `tools/package.json` and `.claude-plugin/plugin.json` and commits the bump.

**The workflow workspace path is an installer boundary.** Skills and agents use `./qrspi/` consistently so an installer can replace that exact path when a project chooses another artifact directory. The helper must read the same configured workspace root from `~/.qrspi` and default to `./qrspi/`; do not replace unrelated `qrspi` text such as `qrspi-x`, `~/.qrspi/plugin`, or manifest names.

**Diff scope resolution** appears in `reviewer` and `explainer` with near-identical wording (the `git merge-base` fallback against the default branch, and stopping rather than guessing a scope). These two drifting apart is a real risk; check the other when you touch one. `explorer` has no diff-scope section — it surveys a codebase rather than a change.

**No agent enumerates the artifacts.** The reviewer decides by location: everything under `./qrspi/` is scaffolding, never a product file and never blocking, whatever it is named and whichever feature it belongs to. Only an untracked source file *outside* `./qrspi/` blocks, because that one silently leaves the diff under review. Nothing inside `./qrspi/` is reported at all, recognized or not — humans and agents leave working notes and checklists in the workspace, and naming them would reintroduce recognition-by-filename through the back door. `explainer` likewise states only that QRSPI artifacts are read directly and are not part of the product diff, and `explorer` says nothing about artifacts at all.

This replaced an allowlist of filenames, which twice blocked a layout the rest of the plugin supported — once for `plan-phase-*.md`, once for `queries.md.bak*` — because a list of names cannot anticipate what a skill or agent will legitimately write. So adding an artifact needs no reviewer change; don't go looking for a list to update.

**The QRSPI artifact inventory** — including the `plans/`, `backups/`, and `reviews/` subdirectories, not just the root-level files — is repeated in the workflow staleness rules. `workflow` never cleans up `./qrspi/<feature>/`; disposing of any artifact there, done or not, is the human's call, so there is no cleanup keep/remove list to keep in sync. When adding or renaming an artifact, check the staleness rules so resume logic still agrees about what is metadata, what is retained, and what becomes stale. The reviewer is not one of these copies — it goes by location, not by name.

**The backup rule** is stated four times, once in each skill that owns a rerunnable artifact: `query` (`queries`), `research` (`research`), `shape` (`approach`), and `spec` (`spec`). Each copy is deliberately self-contained — a skill is a prompt loaded on its own, so a cross-reference to another skill is a read the agent may never make. The load-bearing part is identical by design — the stem aside, the numbering, the no-overwrite guarantee, and the "create `backups/` only when there is something to put in it" clause must match word for word. What follows that clause may differ: `query` and `research` add that the agent cannot overwrite the old file, and `research` says to do it before spawning, because those two hand the artifact to a subagent; `shape` and `spec` write it themselves and need no such warning. Change one and change all four, or reruns of different steps will number or overwrite backups differently, which is exactly the inconsistency the old undefined `queries.md.bak` scheme produced.
