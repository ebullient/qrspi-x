import {
    cp,
    lstat,
    mkdir,
    readdir,
    readFile,
    readlink,
    rename,
    rm,
    symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
    isCurrentWith,
    type PluginManifest,
    parseManifest,
} from "./Manifest.ts";

export type AgentName = "claude" | "codex" | "bob";

/**
 * The only three supported agents and their fixed, adapter-resolved
 * global targets. Adding a later agent means appending one entry here —
 * nothing else in this module, or any caller, names an agent directly.
 */
const AGENT_TARGETS: Record<AgentName, (home: string) => string> = {
    claude: (home) => join(home, ".claude", "skills", "qrspi-x"),
    codex: (home) => join(home, ".agents", "skills", "qrspi-x"),
    bob: (home) => join(home, ".bob", "plugins", "qrspi-x"),
};

export const AGENT_NAMES = Object.keys(AGENT_TARGETS) as AgentName[];

/**
 * Uses `Object.hasOwn`, not `in` — `in` also matches an inherited
 * `Object.prototype` name (`toString`, `constructor`, ...).
 */
export function isAgentName(value: string): value is AgentName {
    return Object.hasOwn(AGENT_TARGETS, value);
}

/**
 * Resolves an agent's fixed target directory. `home` defaults to the
 * real home directory; tests inject a temp one.
 */
export function targetPathFor(
    agent: AgentName,
    home: string = homedir(),
): string {
    return AGENT_TARGETS[agent](home);
}

export type ProbeResult =
    | { state: "absent" }
    | { state: "managed"; mode: "symlink" }
    | { state: "managed"; mode: "copy"; manifest: PluginManifest }
    | { state: "unmanaged"; reason: string }
    | { state: "error"; message: string };

/**
 * The single shared ownership check every command (`init`, `update`,
 * `status`, `remove`) must call. Managed two ways: a symlink resolving
 * to exactly `installDir`, or a copy whose manifest is valid and every
 * path its `payloadPaths` lists is present. Reads `payloadPaths` from
 * the manifest rather than a fixed name list, since it's
 * installer-computed from what actually landed on disk.
 */
export async function probeTarget(
    targetDir: string,
    installDir: string,
): Promise<ProbeResult> {
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
        stats = await lstat(targetDir);
    } catch (err) {
        if (!isNotFound(err)) {
            return { state: "error", message: errorText(err) };
        }
        return { state: "absent" };
    }

    if (stats.isSymbolicLink()) {
        // readlink only reads the link's own text and never fails on a
        // dangling link (only *following* one does) — a link whose text
        // matches installDir exactly still needs its own existence
        // checked, or a target dangling to a never-installed or
        // removed ~/.qrspi/plugin would be reported managed. A readlink
        // failure here means the path stopped being a symlink between
        // the lstat above and now (TOCTOU), a real error, not dangling.
        let resolved: string;
        try {
            resolved = resolve(dirname(targetDir), await readlink(targetDir));
        } catch (err) {
            return { state: "error", message: errorText(err) };
        }
        if (resolved !== resolve(installDir)) {
            return {
                state: "unmanaged",
                reason: `symlink resolves to ${resolved}, not ${installDir}`,
            };
        }
        try {
            await lstat(resolved);
        } catch (err) {
            if (!isNotFound(err)) {
                return { state: "error", message: errorText(err) };
            }
            return { state: "unmanaged", reason: "dangling symlink" };
        }
        return { state: "managed", mode: "symlink" };
    }

    // A plain file can never hold a copy-mode manifest alongside it —
    // reading "<file>/qrspi-manifest.json" would fail with ENOTDIR, a
    // real I/O error unrelated to whether this target is managed. Catch
    // that shape up front so a foreign file classifies as unmanaged
    // like any other non-QRSPI-X content, rather than as a probing
    // error.
    if (!stats.isDirectory()) {
        return { state: "unmanaged", reason: "a file, not a directory" };
    }

    const manifestPath = join(targetDir, "qrspi-manifest.json");
    let manifestText: string;
    try {
        manifestText = await readFile(manifestPath, "utf8");
    } catch (err) {
        if (!isNotFound(err)) {
            return { state: "error", message: errorText(err) };
        }
        return { state: "unmanaged", reason: "no manifest found" };
    }

    const manifest = parseManifest(manifestText);
    if (!manifest) {
        return { state: "unmanaged", reason: "manifest is invalid" };
    }

    for (const payloadPath of manifest.payloadPaths) {
        try {
            await lstat(join(targetDir, payloadPath));
        } catch (err) {
            if (!isNotFound(err)) {
                return { state: "error", message: errorText(err) };
            }
            return {
                state: "unmanaged",
                reason: `manifest-declared path "${payloadPath}" is missing`,
            };
        }
    }

    return { state: "managed", mode: "copy", manifest };
}

function isNotFound(err: unknown): boolean {
    return (err as { code?: string } | undefined)?.code === "ENOENT";
}

/**
 * Whether a managed target still matches the just-staged central
 * manifest, used by `update` to decide whether to re-place it. An
 * absent target is never current — it's not a candidate for update at
 * all, since `update` never initializes an agent that was never
 * `init`-ed. A symlink is always current: it resolves to exactly
 * `installDir` (that's what `managed`/`symlink` means), so it already
 * points at whatever was just staged there. A copy is current exactly
 * when its own manifest's version and hash match the central one.
 */
export function isCurrent(
    probe: ProbeResult,
    centralManifest: PluginManifest,
): boolean {
    if (probe.state !== "managed") {
        return false;
    }
    if (probe.mode === "symlink") {
        return true;
    }
    return isCurrentWith(probe.manifest, centralManifest);
}

export type PlaceMode = "symlink" | "copy";

export type PlaceResult =
    | { ok: true; mode: PlaceMode }
    | { ok: false; reason: "symlink-unavailable"; message: string };

export type PlaceDeps = {
    symlink?: typeof symlink;
    cp?: typeof cp;
    rename?: typeof rename;
    rm?: typeof rm;
};

/**
 * Links or copies `installDir`'s content into `targetDir`. With no
 * explicit `requested` mode, tries a symlink and falls back to copy
 * only on `EPERM` (Node's signal for "can't create a symlink here",
 * e.g. Windows without developer mode); any other symlink error is
 * rethrown. An explicit `requested` mode never falls back.
 */
export async function placeTarget(
    targetDir: string,
    installDir: string,
    requested: PlaceMode | undefined,
    deps: PlaceDeps = {},
): Promise<PlaceResult> {
    const doSymlink = deps.symlink ?? symlink;
    const doCopy = deps.cp ?? cp;
    const doRename = deps.rename ?? rename;
    const doRm = deps.rm ?? rm;

    /**
     * Copies into a temp directory, then swaps the old target aside and
     * the new one in. `fs.cp`'s `recursive: true` merges into an
     * existing destination rather than replacing it, which would leave
     * stale files `probeTarget` can't detect; swapping rather than
     * removing first also means `targetDir` is never briefly missing
     * (same ordering as `Staging.ts`'s `commit()`).
     */
    async function copy(): Promise<PlaceResult> {
        await mkdir(dirname(targetDir), { recursive: true });
        const tempPath = `${targetDir}.qrspi-incoming-${Date.now()}`;
        await doCopy(installDir, tempPath, { recursive: true });

        const backupPath = `${targetDir}.qrspi-previous-${Date.now()}`;
        let hadPrevious = true;
        try {
            await doRename(targetDir, backupPath);
        } catch (err) {
            if (!isNotFound(err)) {
                throw err;
            }
            hadPrevious = false;
        }

        try {
            await doRename(tempPath, targetDir);
        } catch (err) {
            await doRm(tempPath, { recursive: true, force: true });
            if (hadPrevious) {
                await doRename(backupPath, targetDir);
            }
            throw err;
        }

        if (hadPrevious) {
            await doRm(backupPath, { recursive: true, force: true });
        }
        return { ok: true, mode: "copy" };
    }

    /**
     * Creates the new symlink at a temp path, then renames it into
     * place. Renaming a symlink onto an existing symlink (or onto
     * nothing) is a direct, atomic swap. Renaming onto an existing real
     * *directory* (a previously managed copy-mode target) is refused by
     * the OS unless that directory is empty, so only in that case is the
     * existing target moved aside first and restored if the swap fails —
     * the same recoverable pattern `copy()` uses.
     */
    async function link(): Promise<PlaceResult> {
        await mkdir(dirname(targetDir), { recursive: true });
        const tempPath = `${targetDir}.qrspi-incoming-${Date.now()}`;
        await doSymlink(installDir, tempPath);

        const replacingDirectory = await isExistingDirectory(targetDir);
        if (!replacingDirectory) {
            try {
                await rename(tempPath, targetDir);
            } catch (err) {
                await rm(tempPath, { force: true });
                throw err;
            }
            return { ok: true, mode: "symlink" };
        }

        const backupPath = `${targetDir}.qrspi-previous-${Date.now()}`;
        await rename(targetDir, backupPath);
        try {
            await rename(tempPath, targetDir);
        } catch (err) {
            await rm(tempPath, { force: true });
            await rename(backupPath, targetDir);
            throw err;
        }
        await rm(backupPath, { recursive: true, force: true });
        return { ok: true, mode: "symlink" };
    }

    if (requested === "copy") {
        return copy();
    }

    try {
        return await link();
    } catch (err) {
        if (!isEperm(err)) {
            throw err;
        }
        if (requested === "symlink") {
            return {
                ok: false,
                reason: "symlink-unavailable",
                message: `Cannot create a symlink at ${targetDir}: ${errorText(err)}`,
            };
        }
        return copy();
    }
}

function isEperm(err: unknown): boolean {
    return (err as { code?: string } | undefined)?.code === "EPERM";
}

/**
 * True only for a real directory at `path` — never a symlink (even one
 * pointing at a directory) and never "absent". `lstat` (not `stat`) is
 * what makes that distinction: it reports the entry itself rather than
 * following it, so a symlink target reports `isSymbolicLink()`, not
 * `isDirectory()`, here.
 */
async function isExistingDirectory(path: string): Promise<boolean> {
    try {
        const stats = await lstat(path);
        return stats.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Deletes whatever currently occupies `targetDir`, regardless of shape
 * (foreign file, foreign directory with arbitrary contents, dangling
 * symlink, or symlink pointing elsewhere) — a single recursive `rm`
 * already handles all four shapes uniformly, since `rm` removes a
 * symlink itself rather than following it.
 *
 * Deliberately simpler than `removeTarget`: it has no manifest or
 * declared-payload concept to respect, because by definition an
 * unmanaged target has no QRSPI-X-attributable content to preserve —
 * everything there is foreign and the whole thing goes. Callers must
 * only invoke this after `probeTarget` has classified the target as
 * `unmanaged`; it must never be reachable for an `absent` or `managed`
 * target, since it would delete QRSPI-X-owned content.
 */
export async function clearUnmanagedTarget(targetDir: string): Promise<void> {
    await rm(targetDir, { recursive: true, force: true });
}

const MANIFEST_FILE_NAME = "qrspi-manifest.json";

export type RemoveResult =
    | { ok: true }
    | { ok: false; reason: "blocked-by-extras"; extraPaths: string[] };

/**
 * Removes a managed target — the inverse of `placeTarget`. Callers must
 * never call this on an absent or unmanaged target; that's decided
 * before removal is reached (see `probeTarget`).
 *
 * A symlink-mode target is removed unconditionally: just the link
 * itself, no manifest/payload check, `force` irrelevant — the ownership
 * check that got a caller here already proved it resolves to exactly
 * `installDir`, so there's nothing else to reason about.
 *
 * A copy-mode target's removal is scoped to exactly the manifest's
 * declared payload paths plus the manifest file, then the now-empty
 * directory. Anything else present blocks removal unless `force` is
 * given, in which case only the declared paths/manifest are removed and
 * the extras — and the directory containing them — are left in place.
 */
export async function removeTarget(
    targetDir: string,
    probe: ProbeResult & { state: "managed" },
    force: boolean,
): Promise<RemoveResult> {
    if (probe.mode === "symlink") {
        await rm(targetDir, { force: true });
        return { ok: true };
    }

    const declared = new Set([
        ...probe.manifest.payloadPaths,
        MANIFEST_FILE_NAME,
    ]);
    const entries = await readdir(targetDir);
    const extraPaths = entries.filter((entry) => !declared.has(entry));

    if (extraPaths.length > 0 && !force) {
        return { ok: false, reason: "blocked-by-extras", extraPaths };
    }

    for (const entry of entries) {
        if (declared.has(entry)) {
            await rm(join(targetDir, entry), { recursive: true, force: true });
        }
    }

    if (extraPaths.length === 0) {
        await rm(targetDir, { recursive: true, force: true });
    }

    return { ok: true };
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
