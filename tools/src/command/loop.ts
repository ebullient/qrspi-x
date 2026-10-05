import type { ActionHelp, CommandHelp } from "./Help.ts";
import { blocked, type CommandResult, ok } from "./Result.ts";
import {
    commonOptions,
    resolveRoot,
    resolveServices,
    type Services,
} from "./Root.ts";

const startHelp: ActionHelp = {
    name: "start",
    summary:
        "Resolve a selector and create loop-state.json. Use all, one phase id, a row range like 2..4, or a comma list like 1,3.",
    usage: "qrspi-x loop start <selector> --feature <feature> --project <path>",
    flags: [...commonOptions],
    examples: [
        "qrspi-x loop start all --feature widget --project .",
        "qrspi-x loop start 2..4 --feature widget --project .",
        "qrspi-x loop start 1,3 --feature widget --project .",
    ],
};

const advanceHelp: ActionHelp = {
    name: "advance",
    summary:
        "Use after the current phase is complete and marked [x] to move the loop pointer to the next phase; it does not clear a stop.",
    usage: "qrspi-x loop advance --feature <feature> --project <path>",
    flags: [...commonOptions],
    example: "qrspi-x loop advance --feature widget --project .",
};

const stopHelp: ActionHelp = {
    name: "stop",
    summary:
        "Record a stop (agent self-stop or human intervention). Called only by autoloop itself.",
    usage: 'qrspi-x loop stop "<reason>" --feature <feature> --project <path>',
    flags: [...commonOptions],
    example:
        'qrspi-x loop stop "dirty-tree after repair" --feature widget --project .',
};

const okHelp: ActionHelp = {
    name: "ok",
    summary:
        "Use only after status reports acknowledge-required and a human has resolved the stop; clears the stop without advancing the phase.",
    usage: 'qrspi-x loop ok ["<reason>"] --feature <feature> --project <path>',
    flags: [...commonOptions],
    example:
        'qrspi-x loop ok "retried with --base" --feature widget --project .',
};

const abandonHelp: ActionHelp = {
    name: "abandon",
    summary:
        "End the run (reject a proposed scope, or end an active one). Removes loop-state.json.",
    usage: 'qrspi-x loop abandon "<reason>" --feature <feature> --project <path>',
    flags: [...commonOptions],
    example:
        'qrspi-x loop abandon "scope too large" --feature widget --project .',
};

export const help: CommandHelp = {
    name: "loop",
    summary:
        "Own loop-state.json's scope and lifecycle: start/advance/stop/ok/abandon.",
    actions: [startHelp, advanceHelp, stopHelp, okHelp, abandonHelp],
};

export type LoopStartOpts = {
    feature: string;
    project: string;
    selector: string;
};

export type LoopAdvanceOpts = {
    feature: string;
    project: string;
};

export type LoopReasonOpts = {
    feature: string;
    project: string;
    reason?: string;
};

/**
 * `--stop`/`--ok`/`--abandon` all write the same shape: a `kind: "loop"`
 * entry with `action` set to the flag name, alongside whatever
 * `loopState` write actually changes the lifecycle state. Keyed on
 * action+text so a retry with the same reason (or the same no-reason
 * `--ok`) writes nothing new — same idempotency mechanism as start/log's
 * begin/end, reusing `conditionalAppend` rather than new matching
 * logic.
 */
async function writeLoopEntry(
    services: Services,
    action: "stop" | "ok" | "abandon",
    reason: string | undefined,
): Promise<void> {
    if (action !== "stop" && reason === undefined) {
        return;
    }
    await services.history.conditionalAppend(
        { kind: "loop", action },
        { text: reason },
        {
            kind: "loop",
            action,
            ...(reason !== undefined ? { text: reason } : {}),
        },
    );
}

export async function start(
    opts: LoopStartOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const resolved = resolveServices(root, opts.project, services);

    try {
        const phaseIds = await resolved.loopState.start(opts.selector);
        return ok({ phaseIds });
    } catch (err) {
        // loopState.start() propagates LoopAlreadyRunningError and
        // whatever resolveScope() throws (DependencyCycleError,
        // UnknownPhaseError, or a plain Error for a malformed selector,
        // e.g. an invalid range) unwrapped — every one of them means the
        // same thing here: refuse, write nothing.
        if (err instanceof Error) {
            return blocked([{ code: "loop-refused", message: err.message }]);
        }
        throw err;
    }
}

export async function advance(
    opts: LoopAdvanceOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const resolved = resolveServices(root, opts.project, services);
    await resolved.loopState.advance();
    return ok();
}

export async function stop(
    opts: LoopReasonOpts & { reason: string },
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const resolved = resolveServices(root, opts.project, services);
    await resolved.loopState.stop(opts.reason);
    await writeLoopEntry(resolved, "stop", opts.reason);
    return ok();
}

export async function loopOk(
    opts: LoopReasonOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const resolved = resolveServices(root, opts.project, services);
    await resolved.loopState.ok();
    await writeLoopEntry(resolved, "ok", opts.reason);
    const status = await resolved.loopState.status();
    return ok({ action: status?.action });
}

export async function abandon(
    opts: LoopReasonOpts & { reason: string },
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const resolved = resolveServices(root, opts.project, services);
    await writeLoopEntry(resolved, "abandon", opts.reason);
    await resolved.loopState.abandon();
    return ok();
}
