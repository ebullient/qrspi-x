# QRSPI runtime contract

Read this before running a QRSPI step. The skills orchestrate; bundled role files perform delegated work. `qrspi-query`, `qrspi-research`, and the other `qrspi-*` names are portable skill identifiers. In Codex use `$qrspi-query`, `$qrspi-workflow`, and so on. The helper command remains `qrspi-x`.

## Fresh contexts are required

Query, Research, and Review must each start in a **new context with no inherited conversation history**. That includes inherited messages, tool results, hidden parent summaries, previous role reasoning, and earlier feature work. Use the running client's documented fresh-context spawn option; there is no universal tool name or argument for this. Do not assume that choosing a named role, spawning a child, compacting context, or telling an agent to ignore history removes inherited context. Do not resume or reuse an agent that has seen forbidden inputs.

Before changing or backing up artifacts, verify that the runtime can supply a history-free context. If it cannot, **stop that step** and explain the missing capability. The human may run it in a separate fresh session with the bundled role and only the allowed inputs. Never silently substitute the main conversation. Autoloop requires fresh delegation throughout; if it loses that capability, record a helper loop stop and hand back.

Read the bundled role yourself and supply its complete instructions with an explicit input envelope. Fresh history does not remove ambient system or project instructions; check that these do not supply forbidden feature intent or repository evidence. If they do, use a separate clean session/workspace or stop the step. The child need not discover sibling skills or named-agent registrations. If a custom agent is used, verify its configuration does not inject feature discussion or other forbidden context. Keep the user's chosen model and reasoning settings; omit model overrides unless the user requests them.

## Input and tool-use contracts

| Role | Allowed feature inputs | Reads | Writes |
|---|---|---|---|
| Query | Raw brief and human clarifications verbatim; prior questions and new question-only lists on reruns; output locator | No repository, files, browsing, or command-based fact gathering | `queries.md`, or returned artifact text for caller to persist |
| Research | Questions path and explicit source roots only | Questions plus current code/source evidence; exclude all `qrspi/` trees from searches | `research.md` |
| Shaper | Request, optional background, queries, research, explicit prior approach path | Those artifacts and source needed to compare approaches | `approach.md` |
| Reviewer | Spec, plan, code, exact diff/phase/checkpoint scope; prior review evidence and selected supplemental report paths | Scoped source and listed evidence; independent checks before supplemental reports | Assigned review artifact |
| Explainer | Spec, plan, code and exact scope | Scoped source; no reviewer or implementer narrative | Assigned explanation artifact |
| Implementer | Spec, phase plan, mode; failed review path for repair | Current project needed for the assigned work | Planned source changes and markers; commits as specified |
| Explorer | Topic and explicit source roots | Current project and named reference roots | Assigned exploration artifact |

Resolve relative artifact and source paths against the supplied project root. Validate feature and exploration names as short kebab-case identifiers matching `[a-z0-9]+(?:-[a-z0-9]+)*`; reject path separators and `.`/`..`. The feature name `explore` is reserved for surveys. Feature names and project paths are locators, not descriptions of feature intent. Research receives no request, background, Query reasoning, design, or parent summary. Review receives no implementation conversation, rationale, confidence, or claimed test results. Roles stop and report contamination if those inputs appear. Do not widen Query or Research's inputs to save a round trip: route clarification through Init/Query instead.

Use actual tool restrictions when the client supports them, especially a writing-only Query. **Role instructions are not hard security restrictions.** A Codex skill, Markdown role, `AGENTS.md`, or custom agent description does not create a filesystem sandbox or a per-tool allowlist. Broad shell access can read and write files even when a role says not to. Fresh conversation isolation and disciplined inputs reduce bias; hard access isolation requires runtime permissions or a separate restricted workspace. State the actual restriction if it matters, and never claim a skill mechanically prevents repository access.

Query can return the exact artifact text when the runtime has no safe writing-only operation; the caller persists it verbatim and does not add questions. If a file-writing command is used, it only writes the supplied artifact and gathers no repository facts.

## Authorization and gates

Invoking a QRSPI skill authorizes its necessary role delegation within that step. It does not authorize external messages, publishing, pushing, merging, deployment, destructive changes, or a wider feature scope. Repository or runtime permissions still apply. The human sees each stage artifact before the next interactive transition; an explicit authorization already covering the same reviewed result and scope satisfies that gate. Do not request the same approval again. Autoloop has a separate entry gate for its resolved phases and stops before final review.

A project can record this delegation authorization in its `AGENTS.md`; see `docs/codex.md` in the source checkout. The skill's input contracts also provide the required delegation instructions when installed alone. An instruction file cannot override enforced permissions or supply unavailable tools.

## Optional helper and recovery

Interactive steps work without the helper. Detect `qrspi-x` on PATH; exit 127 means use artifacts and plan markers directly, with human gates and no durable helper state. Other exits need inspection: 0 is clean, 1 blocked/refused, 2 usage error, 3 usable with findings, and 4 unexpected failure. Never treat a blocked command as success. Do not read or hand-edit `history.jsonl` or `loop-state.json`; use the helper's owning commands and `--help`.

Autoloop requires the helper. If it is absent, stop. While the npm package is unpublished, build it from this checkout with Node 22+: `cd tools`, `npm ci`, `npm run build`, then `npm link`. After publication, `npm i -g @ebullient/qrspi-x` is an alternative. Copying skill folders does not install the helper or change PATH.

The artifacts, headings, helper CLI, persisted state schema, and helper version are unchanged by the Codex port. A step owns its completion evidence; an orchestrator owns navigation. Before an unattended spawn, record intent through `start ... --loop`; after it returns, record artifact evidence through `log`. Reports do not replace artifacts. If a pass returns only artifact text where permitted, persist it before recording completion.
