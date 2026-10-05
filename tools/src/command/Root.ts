import { join } from "node:path";
import { type Decisions, decisionsAt } from "../workspace/Decisions.ts";
import { type Git, gitAt } from "../workspace/Git.ts";
import { type HistoryLog, historyAt } from "../workspace/History.ts";
import { type LoopState, loopStateAt } from "../workspace/LoopState.ts";
import { type Workspace, workspaceAt } from "../workspace/Workspace.ts";
import type { FlagHelp } from "./Help.ts";

/**
 * Every command's workspace root: `./.qrspi/<feature>/` under the user's
 * project. See AGENTS.md's "Artifacts and state".
 */
export function resolveRoot(project: string, feature: string): string {
    return join(project, ".qrspi", feature);
}

/**
 * Every real service a command might need, keyed by name. Commands take
 * this as one optional, partial override (`services?: Partial<Services>`)
 * rather than a parameter per service — a caller overriding only `history`
 * (a test, typically) names just that field instead of padding earlier
 * positions with `undefined`. `resolveServices` fills in the rest with the
 * real, root-backed instances.
 */
export type Services = {
    workspace: Workspace;
    loopState: LoopState;
    history: HistoryLog;
    decisions: Decisions;
    git: Git;
};

export function resolveServices(
    root: string,
    project: string,
    overrides: Partial<Services> = {},
): Services {
    const workspace = overrides.workspace ?? workspaceAt(root);
    return {
        workspace,
        loopState: overrides.loopState ?? loopStateAt(root, workspace),
        history: overrides.history ?? historyAt(root),
        decisions: overrides.decisions ?? decisionsAt(root),
        git: overrides.git ?? gitAt(project),
    };
}

export const commonOptions: FlagHelp[] = [
    {
        flag: "--feature <feature>",
        required: true,
        description: "The feature workspace under ./.qrspi/.",
    },
    {
        flag: "--project <path>",
        required: false,
        description:
            "The project root holding ./.qrspi/; defaults to the current directory.",
    },
];
