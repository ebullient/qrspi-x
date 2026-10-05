# QRSPI Runtime Contract

This is the canonical runtime contract for QRSPI-X. Skills and role definitions describe the work; the runtime adapter supplies or reports the capabilities that make the role's boundaries real.

## Role inputs and outputs

The caller gives a role only the feature name or topic and the explicitly listed artifacts, evidence, paths, and task mode for that role. A role writes the artifact or source changes named by its caller and reports completion through that on-disk output. The caller checks the output, markers, and verification evidence rather than treating a reply alone as completion.

## Required capabilities

- **Fresh context:** isolated roles start without inherited conversation turns or unrelated implementation reasoning.
- **Tool restrictions:** the runtime applies the declared minimum tools; Query's `Write`-only boundary is a required capability, not a suggestion.
- **Filesystem permissions:** the runtime grants only the read/write scope required by the role. Implementer is the role that edits existing product files; other roles write only their assigned artifacts unless their skill says otherwise.
- **Durable writes:** role outputs and progress markers are written to the package or the project's `./qrspi/` workspace before the caller advances.
- **Human gates:** the interactive orchestrator stops for approval at its documented boundary. Autoloop changes the granularity of the gate, not whether the human owns approval and final review.

Prompt guidance is advisory when the runtime cannot enforce one of these capabilities. The adapter must identify the guarantee as degraded or unsupported; it must not represent a general-purpose fallback as equivalent to a registered role with enforced permissions.

## Dispatch and evidence

Named-agent registration is preferred when available so the runtime can apply its role settings. Otherwise, the caller reads the package-relative `agents/<role>.md` definition and spawns a fresh general-purpose context with the narrowest available tools and only the listed inputs. The fallback remains operationally compatible, but any capability the runtime cannot enforce is advisory.

Completion evidence is the assigned artifact, source diff, progress marker, verification result, and—where the helper is available—the helper record. Review evidence is the review artifact on disk, not an agent's unpersisted reply.
