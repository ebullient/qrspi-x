import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    readFile as readFileBuffer,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import yauzl from "yauzl";
import { isValidManifestShape, type PluginManifest } from "./Manifest.ts";

const defaultRun = promisify(nodeExecFile);

export type ExecFileFn = (
    file: string,
    args: readonly string[],
    options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export type DownloadResult =
    | { ok: true; archivePath: string; cleanup: () => Promise<void> }
    | { ok: false; reason: "download-failed"; message: string };

export type ExtractAndCommitResult =
    | { ok: true; manifest: PluginManifest }
    | {
          ok: false;
          reason: "extraction-failed" | "invalid-manifest";
          message: string;
      };

export type Staging = {
    download: (releaseTag: string) => Promise<DownloadResult>;
    extractAndCommit: (
        archivePath: string,
        releaseTag: string,
    ) => Promise<ExtractAndCommitResult>;
};

/**
 * Owns the full stage-then-commit lifecycle for a release's payload at
 * `targetDir` (the caller's `~/.qrspi/plugin`), split into two calls so
 * a caller can verify the downloaded bytes' attestation in between:
 * `download` fetches the release asset into a temporary work directory,
 * and `extractAndCommit` extracts it into a fresh staging directory,
 * stamps + validates the manifest there, then atomically replaces
 * whatever currently lives at `targetDir`. Every step before the final
 * pair of renames operates only on temporary paths, so any failure up
 * to that point — including an aborted attestation check between the
 * two calls — leaves `targetDir` completely untouched.
 */
export function stagingAt(
    targetDir: string,
    repoSlug: string,
    cwd: string,
    deps: {
        execFile?: ExecFileFn;
        rename?: typeof rename;
        rm?: typeof rm;
    } = {},
): Staging {
    const execFile = deps.execFile ?? (defaultRun as unknown as ExecFileFn);
    const doRename = deps.rename ?? rename;
    const doRm = deps.rm ?? rm;

    async function download(releaseTag: string): Promise<DownloadResult> {
        const workDir = await mkdtemp(join(tmpdir(), "qrspi-stage-"));
        const cleanup = () => rm(workDir, { recursive: true, force: true });

        const archivePath = join(workDir, "release.zip");
        const downloadResult = await downloadAsset(
            execFile,
            repoSlug,
            cwd,
            releaseTag,
            archivePath,
        );
        if (!downloadResult.ok) {
            await cleanup();
            return downloadResult;
        }

        return { ok: true, archivePath, cleanup };
    }

    /**
     * Takes the `archivePath` a prior `download` produced; the caller
     * owns calling this (to consume the work directory) or `cleanup()`
     * (to discard it, e.g. on attestation failure) exactly once.
     */
    async function extractAndCommit(
        archivePath: string,
        releaseTag: string,
    ): Promise<ExtractAndCommitResult> {
        const workDir = dirname(archivePath);
        try {
            const archiveBytes = await readFileBuffer(archivePath);
            const archiveHash = createHash("sha256")
                .update(archiveBytes)
                .digest("hex");

            const extractedDir = join(workDir, "extracted");
            await mkdir(extractedDir, { recursive: true });
            const extractResult = await extractZip(archivePath, extractedDir);
            if (!extractResult.ok) {
                return extractResult;
            }

            const manifestName = "qrspi-manifest.json";
            const manifestPath = join(extractedDir, manifestName);
            let authorManifest: unknown;
            try {
                authorManifest = JSON.parse(
                    await readFile(manifestPath, "utf8"),
                );
            } catch (err) {
                return {
                    ok: false,
                    reason: "invalid-manifest",
                    message: `Release ${releaseTag} is missing a readable qrspi-manifest.json: ${errorText(err)}`,
                };
            }

            const payloadPaths = await listTopLevelEntries(
                extractedDir,
                manifestName,
            );

            const stamped = {
                ...(authorManifest as Record<string, unknown>),
                releaseTag,
                downloadedAt: new Date().toISOString(),
                archiveHash,
                payloadPaths,
            };

            if (!isValidManifestShape(stamped)) {
                return {
                    ok: false,
                    reason: "invalid-manifest",
                    message: `Release ${releaseTag}'s manifest is missing required fields after stamping installer metadata.`,
                };
            }

            await writeFile(
                manifestPath,
                JSON.stringify(stamped, null, 4),
                "utf8",
            );

            await commit(extractedDir);

            return { ok: true, manifest: stamped };
        } finally {
            await rm(workDir, { recursive: true, force: true });
        }
    }

    /**
     * The only two operations that touch `targetDir`: move whatever is
     * there aside, move the staged directory in. Both are same-filesystem
     * renames (staging and backup paths are siblings of `targetDir`), so
     * each is atomic; the prior install is only ever gone once the new
     * one is already in place.
     */
    async function commit(extractedDir: string): Promise<void> {
        await mkdir(dirname(targetDir), { recursive: true });
        const backupDir = `${targetDir}.previous-${Date.now()}`;
        const stagedDir = `${targetDir}.incoming-${Date.now()}`;

        await doRename(extractedDir, stagedDir);

        let hadPrevious = true;
        try {
            await doRename(targetDir, backupDir);
        } catch (err) {
            if (!isNotFound(err)) {
                throw err;
            }
            hadPrevious = false;
        }

        try {
            await doRename(stagedDir, targetDir);
        } catch (err) {
            let cleanupErr: unknown;
            try {
                await doRm(stagedDir, { recursive: true, force: true });
            } catch (error) {
                cleanupErr = error;
            }
            if (hadPrevious) {
                try {
                    await doRename(backupDir, targetDir);
                } catch (restoreErr) {
                    const errors = [err, restoreErr];
                    if (cleanupErr) errors.push(cleanupErr);
                    throw new AggregateError(
                        errors,
                        "Failed to install the staged plugin and restore the previous install",
                    );
                }
            }
            if (cleanupErr) {
                throw new AggregateError(
                    [err, cleanupErr],
                    "Failed to install the staged plugin and clean up its temporary directory",
                );
            }
            throw err;
        }

        if (hadPrevious) {
            await doRm(backupDir, { recursive: true, force: true });
        }
    }

    return { download, extractAndCommit };
}

async function downloadAsset(
    execFile: ExecFileFn,
    repoSlug: string,
    cwd: string,
    releaseTag: string,
    destPath: string,
): Promise<
    { ok: true } | { ok: false; reason: "download-failed"; message: string }
> {
    try {
        await execFile(
            "gh",
            [
                "release",
                "download",
                releaseTag,
                "--repo",
                repoSlug,
                "--pattern",
                "*.zip",
                "--output",
                destPath,
                "--clobber",
            ],
            { cwd },
        );
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            reason: "download-failed",
            message: `Failed to download release ${releaseTag} from ${repoSlug}: ${errorText(err)}`,
        };
    }
}

/**
 * Lists the extracted archive's top-level entries, excluding the
 * manifest file itself, sorted for a deterministic manifest. This is
 * computed from what actually landed on disk rather than trusted from
 * the author-written manifest, so `update`/`cleanup` can later validate
 * an agent target's payload against ground truth instead of a claim
 * that could drift from it.
 */
async function listTopLevelEntries(
    extractedDir: string,
    exclude: string,
): Promise<string[]> {
    const entries = await readdir(extractedDir);
    return entries.filter((entry) => entry !== exclude).sort();
}

/**
 * Extracts every entry in the zip into `destDir`, rejecting any entry
 * whose name would resolve outside `destDir` (zip-slip) via yauzl's own
 * `validateFileName`.
 */
async function extractZip(
    archivePath: string,
    destDir: string,
): Promise<
    { ok: true } | { ok: false; reason: "extraction-failed"; message: string }
> {
    try {
        const zipfile = await yauzl.openPromise(archivePath, {
            lazyEntries: false,
        });
        try {
            for await (const entry of zipfile.eachEntry()) {
                const invalid = yauzl.validateFileName(entry.fileName);
                if (invalid) {
                    throw new Error(
                        `Unsafe path in release archive: ${entry.fileName} (${invalid})`,
                    );
                }

                const entryPath = join(destDir, entry.fileName);
                if (entry.fileName.endsWith("/")) {
                    await mkdir(entryPath, { recursive: true });
                    continue;
                }

                await mkdir(dirname(entryPath), { recursive: true });
                const readStream = await zipfile.openReadStreamPromise(entry);
                await writeStreamToFile(readStream, entryPath);
            }
        } finally {
            zipfile.close();
        }
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            reason: "extraction-failed",
            message: `Failed to extract release archive: ${errorText(err)}`,
        };
    }
}

function writeStreamToFile(
    readStream: NodeJS.ReadableStream,
    destPath: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        readStream.on("data", (chunk) => chunks.push(chunk as Buffer));
        readStream.on("end", async () => {
            try {
                await writeFile(destPath, Buffer.concat(chunks));
                resolve();
            } catch (err) {
                reject(err);
            }
        });
        readStream.on("error", reject);
    });
}

function errorText(err: unknown): string {
    if (err && typeof err === "object") {
        const stderr = (err as { stderr?: string }).stderr;
        if (stderr?.trim()) {
            return stderr.trim();
        }
        const message = (err as { message?: string }).message;
        if (message) {
            return message;
        }
    }
    return String(err);
}

function isNotFound(err: unknown): boolean {
    return (err as { code?: string } | undefined)?.code === "ENOENT";
}
