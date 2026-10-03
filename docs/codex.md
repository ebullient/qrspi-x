# QRSPI-X with Codex

The shared skills orchestrate the same QRSPI stages and use the existing `qrspi-x` helper and `qrspi/<feature>/` artifacts. Roles are supplied as complete Markdown instructions to fresh subagents, without Claude-only registration or tool frontmatter.

## Install the skills manually

Copy the individual `skills/qrspi-*` folders to `.agents/skills/` in the project where you run Codex, or to `~/.agents/skills/` for personal use. Preserve each folder's `references/` directory. Per-skill symlinks also work because all required references live inside that folder.

```bash
mkdir -p /path/to/project/.agents/skills
cp -R /path/to/qrspi-x/skills/qrspi-* /path/to/project/.agents/skills/
```

For personal installation, use `~/.agents/skills/` as the destination. Refresh copied folders when you update the checkout, keeping any local customizations separately. Avoid installing duplicate copies at multiple scopes. Codex discovers each `SKILL.md` by its name and description; restart the client if a new skill is missing. See the [official skill documentation](https://learn.chatgpt.com/docs/build-skills).

Invoke skills in a Codex prompt:

```text
$qrspi-workflow add-favorites
$qrspi-query add-favorites
$qrspi-review add-favorites
$qrspi-autoloop add-favorites
```

The last invocation is for an approved spec and plan, with a separate entry gate covering the resolved phases. The `$qrspi-*` names are prompt invocations. The optional `qrspi-x` helper is a shell command; it retains its existing flags, artifact headings, and state schema. See [README.md](../README.md#install-the-helper-locally) for the local helper build. Interactive steps can run without it; Autoloop requires it.

## Authorize role delegation

Add a section like this to the target project's `AGENTS.md` when adopting QRSPI:

```markdown
## QRSPI subagents

When I invoke or authorize a QRSPI skill, spawn the subagents that its
instructions require within that step or approved Autoloop phase scope.
Query, Research, and Review must use new contexts with no inherited chat
history and only their listed inputs. If those contexts are unavailable,
stop that isolated step and explain the missing capability. Optional
explanation requires my opt-in. Preserve the workflow's human gates and
runtime permissions. This authorizes delegation, not external messages,
pushing, publishing, merging, deployment, or a wider feature scope.
```

This repository's own [AGENTS.md](../AGENTS.md) includes authorization for its maintainers. The skill's runtime contract also makes the required delegation explicit. Authorization does not create tools or override enforced permissions.

## Configure the running client

Use a client that can delegate to fresh subagents without copying the main conversation. Read the client’s actual spawn interface and explicitly select its history-free mode; different clients expose different controls. A named role, child agent, or compacted conversation alone does not establish isolation. Stop Query, Research, or Review if that capability is unavailable. A separate clean session with the complete bundled role and allowed inputs is the manual alternative.

No custom-agent registration or configuration file is required by these skills. If the local Codex release supports it, an optional concurrency setting is:

```toml
[agents]
max_concurrent_threads_per_session = 4
```

Merge this into the appropriate configuration; keep the user's existing settings. Select the model and reasoning level in the session. Roles inherit that selection unless the user explicitly chooses another model, including for an independent final review. The [official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) describes current configuration and model controls; supported settings can vary by client version.

## Preserve the isolation boundaries

- Query receives the raw request and human clarifications, plus question-only lists on reruns. It gathers no repository facts. It may return the complete artifact for the parent to save verbatim.
- Research receives only questions and authorized source locations. Recursive searches exclude all `qrspi/` trees, including tracked artifacts, so feature intent and design discussion do not leak into evidence gathering. Reruns answer all current questions from current source evidence.
- Review receives the spec, plan, scoped code, and selected evidence. It receives no implementer conversation, explanation, confidence, or claimed test results. Each repair and re-review in Autoloop uses a new agent.

Fresh history does not remove ambient project instructions or restrict filesystem access. If project instructions inject forbidden intent or evidence into a role, use a clean session/workspace or stop. Tool-use contracts guide behavior; enforceable access isolation requires runtime permissions or a restricted workspace. See [the complete runtime contract](runtime.md).

## Migration from the Claude-oriented checkout

All eleven skill folders and names now use `qrspi-*`, including `qrspi-explore` and `qrspi-autoloop`. Replace invocations such as `/qrspi-x:query` with `$qrspi-query`; replace named-agent dispatch with the full bundled role and explicit input envelope. Role files no longer carry Claude `tools`, `model`, or color frontmatter. Skill frontmatter uses portable `name` and `description`; adjacent-step guidance lives in the body.

Existing workspaces remain usable: `request.md`, `queries.md`, `research.md`, optional `approach.md`, `spec.md`, plan files, reviews, and helper state keep their existing formats. Shape reruns receive the exact previous approach backup to preserve the human decision. Research reruns refresh evidence instead of inheriting old answers. Human gates, backup numbering, review labels, verdict rules, and Autoloop's one-repair limit remain intact.

The legacy Claude manifest, release workflows, and helper source remain unchanged. Packaging and installer scripts are outside this port's finalized scope; install the self-contained skill folders directly. These plain role files are not drop-in Claude named-agent definitions.
