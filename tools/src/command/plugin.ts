import { execFile as nodeExecFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
    type FreshnessResult,
    type GitHub,
    type GitHubRepo,
    gitHubAt,
} from "../plugin/GitHub.ts";
import { type PluginManifest, parseManifest } from "../plugin/Manifest.ts";
import { type Staging, stagingAt } from "../plugin/Staging.ts";
import {
    AGENT_NAMES,
    type AgentName,
    clearUnmanagedTarget,
    isAgentName,
    isCurrent,
    type PlaceMode,
    type ProbeResult,
    placeTarget,
    probeTarget,
    removeTarget,
    targetPathFor,
} from "../plugin/Target.ts";
import type { ActionHelp, CommandHelp } from "./Help.ts";
import { type CommandResult, ok } from "./Result.ts";

const defaultRun = promisify(nodeExecFile);

export type ExecFileFn = (
    file: string,
    args: readonly string[],
    options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * `plugin install`/`update`/`status`/`remove` always target this repo,
 * never a locally configured git remote, so it is a fixed constant
 * rather than something resolved per-invocation.
 */
export const QRSPI_X_REPO: GitHubRepo = {
    owner: "ebullient",
    repo: "qrspi-x",
};

const releaseFlag = {
    flag: "--release <tag>",
    required: false,
    description:
        "Install this release tag instead of GitHub's own latest-eligible release.",
};

const installHelp: ActionHelp = {
    name: "install",
    summary:
        "Download, verify, and stage a release into ~/.qrspi/plugin, replacing any existing content.",
    flags: [releaseFlag],
    example: "qrspi-x plugin install --release 1.2.3",
};

const initHelp: ActionHelp = {
    name: "init",
    summary: "Place the installed plugin content at one agent's fixed target.",
    flags: [
        {
            flag: "--agent <claude|codex|bob>",
            required: true,
            description: "Which agent's fixed target to place content at.",
        },
        {
            flag: "--copy",
            required: false,
            description: "Force copy mode. Mutually exclusive with --symlink.",
        },
        {
            flag: "--symlink",
            required: false,
            description:
                "Force symlink mode, failing cleanly if unavailable rather than falling back. Mutually exclusive with --copy.",
        },
        {
            flag: "--force",
            required: false,
            description:
                "Don't refuse an unmanaged (foreign) target; delete it and place fresh content there instead, for the one named agent. No effect on an absent or already-managed target.",
        },
    ],
    example: "qrspi-x plugin init --agent claude",
};

const statusHelp: ActionHelp = {
    name: "status",
    summary:
        "Report the installed version, each agent's placement, and GitHub release freshness. Makes no changes.",
    flags: [],
    example: "qrspi-x plugin status",
};

const updateHelp: ActionHelp = {
    name: "update",
    summary:
        "Re-run install, then re-place every initialized agent not already current with the freshly staged release.",
    flags: [
        releaseFlag,
        {
            flag: "--force",
            required: false,
            description:
                "Don't refuse an unmanaged (foreign) target; delete it and place fresh content there instead, for each unmanaged agent found during the sweep. No effect on an absent or already-current agent.",
        },
    ],
    example: "qrspi-x plugin update",
};

const removeHelp: ActionHelp = {
    name: "remove",
    summary:
        "Remove one agent's placed files or symlink from its fixed target. Never touches ~/.qrspi/plugin or any other agent.",
    flags: [
        {
            flag: "--agent <claude|codex|bob>",
            required: true,
            description: "Which agent's fixed target to remove.",
        },
        {
            flag: "--force",
            required: false,
            description:
                "Don't refuse an unmanaged (foreign) target; delete it instead, for this one agent, with nothing placed afterward. Separately, copy mode only: also proceed when the target directory contains paths beyond the manifest-declared payload, removing only those declared paths and leaving the extras in place. No effect in symlink mode.",
        },
    ],
    example: "qrspi-x plugin remove --agent claude",
};

export const help: CommandHelp = {
    name: "plugin",
    summary:
        "Human-invoked only: install/init/update/status/remove the central plugin payload and agent targets.",
    actions: [installHelp, initHelp, statusHelp, updateHelp, removeHelp],
};

export type PluginInstallOpts = {
    release?: string;
};

export type ProgressFn = (line: string) => void;

const noopProgress: ProgressFn = () => {};

export type PluginInstallServices = {
    execFile?: ExecFileFn;
    homeDir?: string;
    github?: GitHub;
    staging?: Staging;
    onProgress?: ProgressFn;
};

/**
 * Resolves the selected release, verifies its attestation on the
 * downloaded bytes, and only then extracts and commits into
 * `~/.qrspi/plugin` — attestation verification must happen before
 * extraction, with any failure leaving the previous install untouched.
 * `Staging.download`/`extractAndCommit` are split exactly so this
 * ordering can be enforced here rather than inside the staging module,
 * which has no attestation concept of its own.
 *
 * `onProgress` fires once before each of the four stages below. It's a
 * UX-only signal for an interactive terminal (this command is the one
 * place in the CLI with a multi-second network round trip, so silence
 * here reads as a hang) — it carries no state and failures are reported
 * through the returned `CommandResult` exactly as before.
 */
export async function runInstall(
    opts: PluginInstallOpts,
    services: PluginInstallServices = {},
): Promise<CommandResult> {
    const execFile = services.execFile ?? (defaultRun as unknown as ExecFileFn);
    const home = services.homeDir ?? homedir();
    const targetDir = join(home, ".qrspi", "plugin");
    const repoSlug = `${QRSPI_X_REPO.owner}/${QRSPI_X_REPO.repo}`;
    const onProgress = services.onProgress ?? noopProgress;

    const github =
        services.github ?? gitHubAt(QRSPI_X_REPO, home, { execFile });
    const staging =
        services.staging ?? stagingAt(targetDir, repoSlug, home, { execFile });

    onProgress(
        opts.release
            ? `Resolving release ${opts.release}...`
            : "Resolving latest eligible release...",
    );
    const resolved = await github.resolveRelease(opts.release);
    if (!resolved.ok) {
        return fail(resolved.reason, resolved.message);
    }

    onProgress(`Downloading release ${resolved.tag}...`);
    const downloadResult = await staging.download(resolved.tag);
    if (!downloadResult.ok) {
        return fail(downloadResult.reason, downloadResult.message);
    }

    onProgress("Verifying attestation...");
    const attestation = await github.verifyAttestation(
        downloadResult.archivePath,
    );
    if (!attestation.ok) {
        await downloadResult.cleanup();
        return fail(attestation.reason, attestation.message);
    }

    onProgress(`Unpacking into ${targetDir}...`);
    const staged = await staging.extractAndCommit(
        downloadResult.archivePath,
        resolved.tag,
    );
    if (!staged.ok) {
        return fail(staged.reason, staged.message);
    }

    return ok({
        release: resolved.tag,
        version: staged.manifest.version,
        installedAt: targetDir,
        text: `Installed release ${resolved.tag} into ${targetDir}.`,
    });
}

export type PluginInitOpts = {
    agent: string;
    copy?: boolean;
    symlink?: boolean;
    force?: boolean;
};

export type PluginInitServices = {
    homeDir?: string;
    place?: typeof placeTarget;
    clearUnmanaged?: typeof clearUnmanagedTarget;
};

/**
 * Makes the installed plugin content present at one agent's fixed
 * target. Validates name/flags, requires a prior `install`, refuses on
 * an unmanaged target (unless `--force` clears it first), places fresh
 * on absent, and — since the spec leaves "already initialized"
 * undefined — treats a repeat `init` on a managed target as an
 * idempotent re-placement in its detected mode.
 */
export async function runInit(
    opts: PluginInitOpts,
    services: PluginInitServices = {},
): Promise<CommandResult> {
    if (opts.copy && opts.symlink) {
        const message = "--copy and --symlink are mutually exclusive.";
        return fail("conflicting-mode", message);
    }

    if (!isAgentName(opts.agent)) {
        const message = `Unknown agent "${opts.agent}". Supported agents: ${AGENT_NAMES.join(", ")}.`;
        return fail("unknown-agent", message);
    }
    const agent: AgentName = opts.agent;

    const home = services.homeDir ?? homedir();
    const installDir = join(home, ".qrspi", "plugin");
    const installCheck = await checkInstall(installDir);
    if (!installCheck.ok) {
        const message =
            installCheck.reason === "not-installed"
                ? `No plugin install found at ${installDir}. Run "qrspi-x plugin install" first.`
                : `Could not read ${installDir}: ${installCheck.message}`;
        return fail(installCheck.reason, message);
    }

    const inspection = await inspectAgent(agent, home, installDir);
    if ("error" in inspection) {
        return inspection.error;
    }
    const { targetDir, probe } = inspection;
    if (probe.state === "unmanaged" && !opts.force) {
        const message = `${targetDir} is not a QRSPI-X-managed target (${probe.reason}). Refusing to touch it. Re-run with --force to delete it and place fresh content there.`;
        return fail("unmanaged-target", message);
    }

    if (probe.state === "unmanaged" && opts.force) {
        const clearUnmanaged = services.clearUnmanaged ?? clearUnmanagedTarget;
        try {
            await clearUnmanaged(targetDir);
        } catch (err) {
            const message = `Could not clear unmanaged target ${targetDir}: ${errorText(err)}`;
            return fail("cleanup-failed", message);
        }
    }

    // An unmanaged target has no managed mode to preserve, so it
    // resolves the same way an absent target does below.
    const requested: PlaceMode | undefined = opts.copy
        ? "copy"
        : opts.symlink
          ? "symlink"
          : probe.state === "managed"
            ? probe.mode
            : undefined;

    const place = services.place ?? placeTarget;
    const placed = await place(targetDir, installDir, requested);
    if (!placed.ok) {
        return fail(placed.reason, placed.message);
    }

    return ok({
        agent,
        mode: placed.mode,
        target: targetDir,
        text: `Placed ${agent}'s plugin content at ${targetDir} (${placed.mode} mode).`,
    });
}

export type PluginRemoveOpts = {
    agent: string;
    force?: boolean;
};

export type PluginRemoveServices = {
    homeDir?: string;
    remove?: typeof removeTarget;
    clearUnmanaged?: typeof clearUnmanagedTarget;
};

/**
 * Removes one agent's placed content — the inverse of `init` for that
 * one agent. Never touches `~/.qrspi/plugin` or any other agent's
 * target; `installDir` here is only ever used to confirm symlink-mode
 * ownership (that it resolves to the real central install), the same
 * probe every other command shares, not to compare against or refresh
 * anything. An absent target is a success with no changes — the end
 * state already holds. An unmanaged target refuses unless `--force`
 * clears it (delete-and-stop: unlike `init`/`update`, nothing is
 * placed afterward — `remove`'s job ends at "this agent is no longer
 * present"). A managed, extras-blocked copy-mode target without
 * `--force` reports the extra paths and makes no changes; `--force`
 * there has its own, unrelated meaning (Phase 6: trim only the
 * declared paths, leave the extras) and must not be confused with the
 * unmanaged-target cleanup this step adds — the two share a flag name
 * but have different preconditions and code paths.
 */
export async function runRemove(
    opts: PluginRemoveOpts,
    services: PluginRemoveServices = {},
): Promise<CommandResult> {
    if (!isAgentName(opts.agent)) {
        const message = `Unknown agent "${opts.agent}". Supported agents: ${AGENT_NAMES.join(", ")}.`;
        return fail("unknown-agent", message);
    }
    const agent: AgentName = opts.agent;

    const home = services.homeDir ?? homedir();
    const installDir = join(home, ".qrspi", "plugin");
    const inspection = await inspectAgent(agent, home, installDir);
    if ("error" in inspection) {
        return inspection.error;
    }
    const { targetDir, probe } = inspection;
    if (probe.state === "absent") {
        return ok({
            agent,
            removed: false,
            text: `${agent} is not installed at ${targetDir}. Nothing to do.`,
        });
    }
    if (probe.state === "unmanaged") {
        if (!opts.force) {
            const message = `${targetDir} is not a QRSPI-X-managed target (${probe.reason}). Refusing to touch it. Re-run with --force to delete it.`;
            return fail("unmanaged-target", message);
        }

        const clearUnmanaged = services.clearUnmanaged ?? clearUnmanagedTarget;
        try {
            await clearUnmanaged(targetDir);
        } catch (err) {
            const message = `Could not clear unmanaged target ${targetDir}: ${errorText(err)}`;
            return fail("cleanup-failed", message);
        }
        return ok({
            agent,
            removed: true,
            target: targetDir,
            text: `Removed ${agent}'s unmanaged content from ${targetDir}.`,
        });
    }

    const remove = services.remove ?? removeTarget;
    const removed = await remove(targetDir, probe, opts.force === true);
    if (!removed.ok) {
        const message = `${targetDir} contains paths not placed by init: ${removed.extraPaths.join(", ")}. Re-run with --force to remove only the plugin's own paths and leave these in place.`;
        return fail(removed.reason, message);
    }

    return ok({
        agent,
        removed: true,
        target: targetDir,
        text: `Removed ${agent}'s plugin content from ${targetDir}.`,
    });
}

export type PluginUpdateOpts = {
    release?: string;
    force?: boolean;
};

export type PluginUpdateServices = {
    homeDir?: string;
    execFile?: ExecFileFn;
    github?: GitHub;
    staging?: Staging;
    place?: typeof placeTarget;
    clearUnmanaged?: typeof clearUnmanagedTarget;
    onProgress?: ProgressFn;
};

type AgentUpdateOutcome =
    | { agent: AgentName; outcome: "updated"; mode: PlaceMode }
    | { agent: AgentName; outcome: "skipped-not-initialized" }
    | { agent: AgentName; outcome: "already-current"; mode: PlaceMode }
    | { agent: AgentName; outcome: "failed"; reason: string; message: string };

type AgentInspection =
    | {
          targetDir: string;
          probe: Exclude<ProbeResult, { state: "error" }>;
      }
    | { targetDir: string; error: CommandResult };

async function inspectAgent(
    agent: AgentName,
    home: string,
    installDir: string,
): Promise<AgentInspection> {
    const targetDir = targetPathFor(agent, home);
    const probe = await probeTarget(targetDir, installDir);
    if (probe.state === "error") {
        const message = `Could not probe ${targetDir}: ${probe.message}`;
        return { targetDir, error: fail("probe-failed", message) };
    }
    return { targetDir, probe };
}

type UpdatePlacement =
    | { ok: true; mode: PlaceMode }
    | { ok: false; reason: string; message: string };

async function placeForUpdate(
    place: typeof placeTarget,
    targetDir: string,
    installDir: string,
    requested: PlaceMode | undefined,
): Promise<UpdatePlacement> {
    try {
        return await place(targetDir, installDir, requested);
    } catch (err) {
        return {
            ok: false,
            reason: "placement-failed",
            message: errorText(err),
        };
    }
}

/**
 * Re-runs `install`, then re-probes and re-places every agent using the
 * same shared ownership/currentness check `status`/`remove` use. Install
 * runs first and unconditionally stops the whole command on failure — no
 * agent is probed at all — since there is nothing freshly staged yet to
 * compare currentness against. An unmanaged target is reported as a
 * failed agent and the run continues past it, same as `init`'s refusal
 * rule. The first re-placement failure for any other reason stops the
 * run entirely: already-completed agents and the already-replaced
 * central payload are never rolled back, matching spec's no-rollback
 * contract, so the per-agent report is the only record of what a failed
 * run actually got through.
 */
export async function runUpdate(
    opts: PluginUpdateOpts,
    services: PluginUpdateServices = {},
): Promise<CommandResult> {
    const home = services.homeDir ?? homedir();
    const installDir = join(home, ".qrspi", "plugin");

    const installResult = await runInstall(
        { release: opts.release },
        {
            execFile: services.execFile,
            homeDir: home,
            github: services.github,
            staging: services.staging,
            onProgress: services.onProgress,
        },
    );
    if (installResult.exitCode !== 0) {
        return installResult;
    }

    const manifestPath = join(installDir, "qrspi-manifest.json");
    let centralManifest: PluginManifest;
    try {
        const manifestText = await readFile(manifestPath, "utf8");
        const parsed = parseManifest(manifestText);
        if (!parsed) {
            const message = `Freshly staged manifest at ${manifestPath} is invalid.`;
            return fail("invalid-manifest", message);
        }
        centralManifest = parsed;
    } catch (err) {
        const message = `Could not read ${manifestPath}: ${errorText(err)}`;
        return fail("manifest-read-failed", message);
    }

    const place = services.place ?? placeTarget;
    const results: AgentUpdateOutcome[] = [];
    const processedAgents = new Set<AgentName>();
    let stoppedEarly = false;
    const inspections = await Promise.all(
        AGENT_NAMES.map((agent) => inspectAgent(agent, home, installDir)),
    );

    for (const [index, inspection] of inspections.entries()) {
        if (stoppedEarly) {
            break;
        }

        const agent = AGENT_NAMES[index];
        processedAgents.add(agent);
        if ("error" in inspection) {
            return inspection.error;
        }
        const { targetDir, probe } = inspection;

        if (probe.state === "absent") {
            results.push({ agent, outcome: "skipped-not-initialized" });
            continue;
        }

        if (probe.state === "unmanaged") {
            if (!opts.force) {
                results.push({
                    agent,
                    outcome: "failed",
                    reason: "unmanaged-target",
                    message: `${targetDir} is not a QRSPI-X-managed target (${probe.reason}). Refusing to touch it. Re-run with --force to delete it and place fresh content there.`,
                });
                continue;
            }

            try {
                const clearUnmanaged =
                    services.clearUnmanaged ?? clearUnmanagedTarget;
                await clearUnmanaged(targetDir);
            } catch (err) {
                results.push({
                    agent,
                    outcome: "failed",
                    reason: "placement-failed",
                    message: errorText(err),
                });
                stoppedEarly = true;
                continue;
            }
        } else if (isCurrent(probe, centralManifest)) {
            results.push({
                agent,
                outcome: "already-current",
                mode: probe.mode,
            });
            continue;
        }

        const requested = probe.state === "unmanaged" ? undefined : probe.mode;
        const placed = await placeForUpdate(
            place,
            targetDir,
            installDir,
            requested,
        );
        if (!placed.ok) {
            results.push({
                agent,
                outcome: "failed",
                reason: placed.reason,
                message: placed.message,
            });
            stoppedEarly = true;
            continue;
        }
        results.push({ agent, outcome: "updated", mode: placed.mode });
    }

    const notReached = AGENT_NAMES.filter(
        (agent) => !processedAgents.has(agent),
    ).map(
        (agent): AgentUpdateOutcome => ({
            agent,
            outcome: "failed",
            reason: "not-reached",
            message: "Not reached: an earlier agent's update failed.",
        }),
    );
    const allResults = [...results, ...notReached];

    const hasFailure = allResults.some((r) => r.outcome === "failed");

    return {
        exitCode: hasFailure ? 1 : 0,
        release: installResult.release,
        version: installResult.version,
        agents: allResults,
        text: updateSummaryText(installResult, allResults),
    };
}

function updateSummaryText(
    installResult: CommandResult,
    results: AgentUpdateOutcome[],
): string {
    const parts = [String(installResult.text ?? "")];
    for (const r of results) {
        switch (r.outcome) {
            case "updated":
                parts.push(`${r.agent}: updated (${r.mode} mode).`);
                break;
            case "already-current":
                parts.push(`${r.agent}: already current.`);
                break;
            case "skipped-not-initialized":
                parts.push(`${r.agent}: not initialized, skipped.`);
                break;
            case "failed":
                parts.push(`${r.agent}: failed (${r.reason}).`);
                break;
        }
    }
    return parts.join(" ");
}

export type PluginStatusServices = {
    homeDir?: string;
    execFile?: ExecFileFn;
    github?: GitHub;
};

type AgentStatus =
    | { agent: AgentName; present: false }
    | {
          agent: AgentName;
          present: true;
          mode: "symlink" | "copy" | "unmanaged";
      };

/**
 * Reports, never refuses: an absent or unmanaged target is normal
 * status information, not a blocker, unlike `init`/`update`/`remove`,
 * which all treat "unmanaged" as a reason to stop. Only a genuine local
 * I/O failure while probing a target or reading the central manifest is
 * a command failure — a missing or foreign install is just what's
 * there to report.
 */
export async function runStatus(
    services: PluginStatusServices = {},
): Promise<CommandResult> {
    const execFile = services.execFile ?? (defaultRun as unknown as ExecFileFn);
    const home = services.homeDir ?? homedir();
    const installDir = join(home, ".qrspi", "plugin");

    const manifestPath = join(installDir, "qrspi-manifest.json");
    let installedVersion: string | undefined;
    try {
        const manifestText = await readFile(manifestPath, "utf8");
        installedVersion = parseManifest(manifestText)?.version;
    } catch (err) {
        if ((err as { code?: string } | undefined)?.code !== "ENOENT") {
            const message = `Could not read ${manifestPath}: ${errorText(err)}`;
            return fail("manifest-read-failed", message);
        }
    }

    const inspections = await Promise.all(
        AGENT_NAMES.map((agent) => inspectAgent(agent, home, installDir)),
    );
    const agents: AgentStatus[] = [];
    for (const [index, inspection] of inspections.entries()) {
        if ("error" in inspection) {
            return inspection.error;
        }
        const { probe } = inspection;
        const agent = AGENT_NAMES[index];
        if (probe.state === "absent") {
            agents.push({ agent, present: false });
        } else if (probe.state === "managed") {
            agents.push({ agent, present: true, mode: probe.mode });
        } else {
            agents.push({ agent, present: true, mode: "unmanaged" });
        }
    }

    // Always attempted, even with nothing installed: an empty version
    // simply can't parse, so checkFreshness's own "unknown" case covers
    // it, the same as any other unparseable installed version.
    const github =
        services.github ?? gitHubAt(QRSPI_X_REPO, home, { execFile });
    const freshness: FreshnessResult = await github.checkFreshness(
        installedVersion ?? "",
    );

    return ok({
        installed: installedVersion !== undefined,
        version: installedVersion,
        agents,
        freshness,
        text: `${installedVersion ? `Installed version ${installedVersion}.` : "No plugin installed."} ${freshnessText(freshness)}`.trim(),
    });
}

/**
 * Renders the freshness half of `status`'s human-readable summary —
 * whether a newer release is available — which the bare
 * installed/not-installed line above never mentions on its own.
 */
function freshnessText(freshness: FreshnessResult): string {
    switch (freshness.status) {
        case "update-available":
            return `Update available: ${freshness.latest}.`;
        case "up-to-date":
            return "Up to date.";
        case "unknown":
            if (freshness.message) {
                return `Error checking available releases: ${freshness.message}`;
            }
            return freshness.latest
                ? `Latest available: ${freshness.latest}.`
                : "";
    }
}

type InstallCheck =
    | { ok: true }
    | { ok: false; reason: "not-installed" }
    | { ok: false; reason: "install-check-failed"; message: string };

/**
 * Distinguishes "nothing installed" (ENOENT, or an empty readdir) from
 * any other error reading `installDir`, so a real failure (e.g.
 * permissions) is reported distinctly, not hidden behind "run install
 * first".
 */
async function checkInstall(installDir: string): Promise<InstallCheck> {
    let entries: string[];
    try {
        entries = await readdir(installDir);
    } catch (err) {
        if ((err as { code?: string } | undefined)?.code === "ENOENT") {
            return { ok: false, reason: "not-installed" };
        }
        return {
            ok: false,
            reason: "install-check-failed",
            message: errorText(err),
        };
    }
    return entries.length > 0
        ? { ok: true }
        : { ok: false, reason: "not-installed" };
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function fail(code: string, message: string): CommandResult {
    return {
        exitCode: 1,
        code,
        text: message,
    };
}
