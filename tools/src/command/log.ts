import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    parseVerdict,
    parseVerdictSummary,
} from "../workspace/ReviewVerdict.ts";
import { parseReviewLabel, reviewPath } from "../workspace/Workspace.ts";
import type { ActionHelp, CommandHelp } from "./Help.ts";
import { blocked, type CommandResult, ok } from "./Result.ts";
import {
    commonOptions,
    resolveRoot,
    resolveServices,
    type Services,
} from "./Root.ts";

/**
 * `log review` only ever takes --label (never --phase — review/SKILL.md
 * and autoloop/SKILL.md both source it from status/next-file and pass it
 * straight through), so phase and re-review-ness come from the label's own
 * shape: `phase-<id>`, `phase-<id>-r<n>`, or `phase-<id>-step-<k>`.
 * `final`/`final-r<n>` have no phase. Workspace owns this label grammar so
 * label parsing and label construction cannot drift apart.
 */
const reasonFlag = {
    flag: '--reason "<why>"',
    required: false,
    description: "A rerun/resume worth noting in history.jsonl.",
};

const implementHelp: ActionHelp = {
    name: "implement",
    summary:
        "Record implement/repair completion: reads plan.md/phase markers, clears inFlight.",
    flags: [
        ...commonOptions,
        {
            flag: "--phase <id>",
            required: true,
            description: "The phase that finished.",
        },
        reasonFlag,
    ],
    example: "qrspi-x log implement --feature widget --project . --phase 1",
};

const repairHelp: ActionHelp = {
    name: "repair",
    summary: "Alias for `log implement` — identical validation, same call.",
    flags: implementHelp.flags,
    example: "qrspi-x log repair --feature widget --project . --phase 1",
};

const reviewHelp: ActionHelp = {
    name: "review",
    summary:
        "Record a review verdict: reads reviews/<label>.md, always writes, updates loop-state.json's checkpoint/conditions.",
    flags: [
        ...commonOptions,
        {
            flag: "--label <label>",
            required: true,
            description:
                "The review artifact's label (from status's next.label or next-file).",
        },
    ],
    example: "qrspi-x log review --feature widget --project . --label phase-1",
};

const parkHelp: ActionHelp = {
    name: "park",
    summary:
        "Mark the feature not-currently-active. Not a gate; always appends to history.jsonl.",
    flags: [...commonOptions, reasonFlag],
    example:
        'qrspi-x log park --feature widget --project . --reason "waiting on design review"',
};

export const help: CommandHelp = {
    name: "log",
    summary:
        "Record completed work, after the fact, from real on-disk evidence.",
    actions: [implementHelp, repairHelp, reviewHelp, parkHelp],
};

export type LogImplementOpts = {
    feature: string;
    project: string;
    phase: string;
    reason?: string;
};

export type LogReviewOpts = {
    feature: string;
    project: string;
    label: string;
};

export type LogParkOpts = {
    feature: string;
    project: string;
    reason?: string;
};

/**
 * `log repair` is a documented alias — same validation, same call, just
 * recorded under whichever name the caller actually used (kind is
 * `implementKind`, "implement" or "repair").
 */
async function logImplement(
    opts: LogImplementOpts,
    implementKind: "implement" | "repair",
    services: Partial<Services>,
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { workspace, loopState, history } = resolveServices(
        root,
        opts.project,
        services,
    );

    if (!(await workspace.isPhaseComplete(opts.phase))) {
        return blocked([
            {
                code: "phase-not-complete",
                message: `Phase ${opts.phase}'s steps aren't all [x] yet.`,
            },
        ]);
    }

    // Always closes start's "begin" with "end"; idempotent per
    // kind+phase — skipped if the last matching entry is already an
    // "end" (a genuine crash-retry with nothing new to close out).
    await history.conditionalAppend(
        { kind: implementKind, phase: opts.phase },
        { action: "end" },
        {
            kind: implementKind,
            action: "end",
            phase: opts.phase,
            ...(opts.reason !== undefined ? { text: opts.reason } : {}),
        },
    );

    await loopState.clearInFlight();
    return ok();
}

export async function implement(
    opts: LogImplementOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    return logImplement(opts, "implement", services);
}

export async function repair(
    opts: LogImplementOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    return logImplement(opts, "repair", services);
}

export async function review(
    opts: LogReviewOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { loopState, history } = resolveServices(
        root,
        opts.project,
        services,
    );

    const path = reviewPath(opts.label);
    const text = await readFile(join(root, path), "utf8");
    const verdict = parseVerdict(text);
    if (!verdict) {
        return blocked([
            {
                code: "no-verdict",
                message: `${path} has no ## Verdict: line yet.`,
            },
        ]);
    }

    const { phaseId, isReReview } = parseReviewLabel(opts.label);
    // outcome records what this verdict means for what happens next.
    // Autoloop acts on a phase review's outcome via next.action
    // (repair/stop/advance); a final review has no phase and nothing acts
    // on it automatically, but "this was the final review" is still worth
    // a durable marker regardless of its verdict.
    const outcome =
        phaseId === undefined
            ? "final"
            : verdict === "FAIL"
              ? isReReview
                  ? "stop"
                  : "repair"
              : "advance";
    const conditions =
        verdict === "PASS WITH CONDITIONS"
            ? [parseVerdictSummary(text) ?? ""]
            : undefined;

    // Closes start review's "begin" for this label; idempotent per
    // kind+label, same mechanism as logImplement above.
    await history.conditionalAppend(
        { kind: "review", label: opts.label },
        { action: "end" },
        {
            kind: "review",
            action: "end",
            label: opts.label,
            ...(phaseId !== undefined ? { phase: phaseId } : {}),
            verdict,
            outcome,
            ...(conditions ? { conditions } : {}),
        },
    );

    if (phaseId !== undefined) {
        await loopState.updateCheckpoint(phaseId, opts.label, verdict);
        await loopState.clearInFlight();
    }

    return ok();
}

export async function park(
    opts: LogParkOpts,
    services: Partial<Services> = {},
): Promise<CommandResult> {
    const root = resolveRoot(opts.project, opts.feature);
    const { history, decisions } = resolveServices(
        root,
        opts.project,
        services,
    );

    if (await history.isParked()) {
        return ok();
    }

    await history.append({
        kind: "park",
        ...(opts.reason !== undefined ? { text: opts.reason } : {}),
    });

    if (opts.reason !== undefined) {
        await decisions.add(opts.reason);
    }

    return ok();
}
