import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    QRSPI_X_REPO,
    runInit,
    runInstall,
    runRemove,
    runStatus,
    runUpdate,
} from "../../src/command/plugin.ts";
import type {
    AttestationResult,
    FreshnessResult,
    GitHub,
    ResolveReleaseResult,
} from "../../src/plugin/GitHub.ts";
import { gitHubAt } from "../../src/plugin/GitHub.ts";
import type {
    DownloadResult,
    ExtractAndCommitResult,
    Staging,
} from "../../src/plugin/Staging.ts";
import {
    placeTarget,
    probeTarget,
    targetPathFor,
} from "../../src/plugin/Target.ts";
import { buildZip, fakeExecFile } from "../fixtures.ts";

function fakeGitHub(opts: {
    resolveRelease?: ResolveReleaseResult;
    verifyAttestation?: AttestationResult;
    checkFreshness?: FreshnessResult;
}): GitHub & {
    resolveRelease: ReturnType<typeof vi.fn>;
    verifyAttestation: ReturnType<typeof vi.fn>;
    checkFreshness: ReturnType<typeof vi.fn>;
} {
    const resolveRelease: ResolveReleaseResult = opts.resolveRelease ?? {
        ok: true,
        tag: "1.0.0",
    };
    const verifyAttestation: AttestationResult = opts.verifyAttestation ?? {
        ok: true,
    };
    const checkFreshness: FreshnessResult = opts.checkFreshness ?? {
        status: "up-to-date",
    };
    return {
        resolveRelease: vi.fn(async () => resolveRelease),
        verifyAttestation: vi.fn(async () => verifyAttestation),
        checkFreshness: vi.fn(async () => checkFreshness),
    };
}

function fakeStaging(opts: {
    download?: DownloadResult;
    extractAndCommit?: ExtractAndCommitResult;
}): Staging & {
    download: ReturnType<typeof vi.fn>;
    extractAndCommit: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
} {
    const cleanup = vi.fn(async () => {});
    const download: DownloadResult = opts.download ?? {
        ok: true,
        archivePath: "/tmp/fake/release.zip",
        cleanup,
    };
    const extractAndCommit: ExtractAndCommitResult = opts.extractAndCommit ?? {
        ok: true,
        manifest: {
            version: "1.0.0",
            payloadPaths: ["agents", "README.md"],
            releaseTag: "1.0.0",
            downloadedAt: "2026-01-01T00:00:00.000Z",
            archiveHash: "sha256:abc",
        },
    };
    return {
        download: vi.fn(async () => download),
        extractAndCommit: vi.fn(async () => extractAndCommit),
        cleanup,
    };
}

describe("plugin install", () => {
    it("resolves the release, then downloads, verifies, and stages it in order", async () => {
        const github = fakeGitHub({});
        const staging = fakeStaging({});

        const result = await runInstall({}, { github, staging });

        expect(result.exitCode).toBe(0);
        expect(result.release).toBe("1.0.0");
        expect(result.version).toBe("1.0.0");
        expect(result.text).toEqual(expect.stringContaining("1.0.0"));

        expect(github.resolveRelease).toHaveBeenCalledWith(undefined);
        expect(staging.download).toHaveBeenCalledWith("1.0.0");
        expect(github.verifyAttestation).toHaveBeenCalledWith(
            "/tmp/fake/release.zip",
        );
        expect(staging.extractAndCommit).toHaveBeenCalledWith(
            "/tmp/fake/release.zip",
            "1.0.0",
        );
    });

    it("passes an explicit --release through to resolveRelease (deliberate downgrade)", async () => {
        const github = fakeGitHub({
            resolveRelease: { ok: true, tag: "1.0.0" },
        });
        const staging = fakeStaging({});

        const result = await runInstall(
            { release: "1.0.0" },
            { github, staging },
        );

        expect(result.exitCode).toBe(0);
        expect(github.resolveRelease).toHaveBeenCalledWith("1.0.0");
    });

    it("rejects an invalid/nonexistent --release with no download attempted", async () => {
        const github = fakeGitHub({
            resolveRelease: {
                ok: false,
                reason: "invalid-tag",
                message: '"v1.0.0" is not a valid release tag.',
            },
        });
        const staging = fakeStaging({});

        const result = await runInstall(
            { release: "v1.0.0" },
            { github, staging },
        );

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("invalid-tag");
        expect(staging.download).not.toHaveBeenCalled();
    });

    it("aborts before extraction on attestation failure and cleans up the download", async () => {
        const github = fakeGitHub({
            verifyAttestation: {
                ok: false,
                reason: "verification-failed",
                message: "no attestations found",
            },
        });
        const staging = fakeStaging({});

        const result = await runInstall({}, { github, staging });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("verification-failed");
        expect(result.text).toBe("no attestations found");

        expect(staging.extractAndCommit).not.toHaveBeenCalled();
        expect(staging.cleanup).toHaveBeenCalledOnce();
    });

    it("reports a staging failure (extraction/manifest) as blocked", async () => {
        const github = fakeGitHub({});
        const staging = fakeStaging({
            extractAndCommit: {
                ok: false,
                reason: "invalid-manifest",
                message: "missing required fields",
            },
        });

        const result = await runInstall({}, { github, staging });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("invalid-manifest");
    });
});

describe("plugin init", () => {
    let workDir: string;
    let home: string;
    let installDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), "qrspi-init-"));
        home = join(workDir, "home");
        installDir = join(home, ".qrspi", "plugin");
        await mkdir(join(installDir, "agents"), { recursive: true });
        await writeFile(join(installDir, "README.md"), "readme content");
        await writeFile(
            join(installDir, "qrspi-manifest.json"),
            JSON.stringify({
                version: "1.0.0",
                payloadPaths: ["agents", "README.md"],
                releaseTag: "1.0.0",
                downloadedAt: "2026-10-01T00:00:00.000Z",
                archiveHash: "sha256:abc123",
            }),
        );
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    it("places fresh content (symlink by default) for each supported agent", async () => {
        for (const agent of ["claude", "codex", "bob"] as const) {
            const result = await runInit({ agent }, { homeDir: home });
            expect(result.exitCode).toBe(0);
            expect(result.agent).toBe(agent);
            expect(result.mode).toBe("symlink");
            expect(result.target).toBe(targetPathFor(agent, home));
        }
    });

    it("fails cleanly when init runs before any install", async () => {
        await rm(installDir, { recursive: true, force: true });

        const result = await runInit({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("not-installed");
    });

    it("surfaces a real install-check error distinctly from not-installed", async () => {
        // readdir on a file fails with ENOTDIR, a portable stand-in
        // for a real (non-ENOENT) error.
        await rm(installDir, { recursive: true, force: true });
        await writeFile(installDir, "not a directory");

        const result = await runInit({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("install-check-failed");
    });

    it("rejects an unknown agent name, listing supported agents", async () => {
        const result = await runInit({ agent: "cursor" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("unknown-agent");
    });

    it("rejects an inherited Object.prototype property name as an agent", async () => {
        const result = await runInit({ agent: "toString" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("unknown-agent");
    });

    it("surfaces a real probing error distinctly rather than placing content", async () => {
        // A manifest file the probe can't read (EACCES) is a portable
        // stand-in for a real (non-ENOENT) probing error, not "absent"
        // or "unmanaged".
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        const manifestPath = join(targetDir, "qrspi-manifest.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                version: "1.0.0",
                payloadPaths: ["agents", "README.md"],
                releaseTag: "1.0.0",
                downloadedAt: "2026-10-01T00:00:00.000Z",
                archiveHash: "sha256:abc123",
            }),
        );
        await chmod(manifestPath, 0o000);

        try {
            const result = await runInit(
                { agent: "claude" },
                { homeDir: home },
            );

            expect(result.exitCode).toBe(1);
            expect(result.code).toEqual("probe-failed");
        } finally {
            await chmod(manifestPath, 0o644);
        }
    });

    it("refuses an unmanaged existing target with no changes", async () => {
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "notes.md"), "foreign content");

        const result = await runInit({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("unmanaged-target");
    });

    it("honors an explicit --copy request", async () => {
        const result = await runInit(
            { agent: "claude", copy: true },
            { homeDir: home },
        );

        expect(result.exitCode).toBe(0);
        expect(result.mode).toBe("copy");
    });

    it("honors an explicit --symlink request", async () => {
        const result = await runInit(
            { agent: "claude", symlink: true },
            { homeDir: home },
        );

        expect(result.exitCode).toBe(0);
        expect(result.mode).toBe("symlink");
    });

    it("rejects --copy and --symlink together", async () => {
        const result = await runInit(
            { agent: "claude", copy: true, symlink: true },
            { homeDir: home },
        );

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("conflicting-mode");
    });

    it("repeat init on an already-managed target is an idempotent re-placement in the same mode", async () => {
        const first = await runInit(
            { agent: "claude", copy: true },
            { homeDir: home },
        );
        expect(first.exitCode).toBe(0);
        expect(first.mode).toBe("copy");

        const second = await runInit({ agent: "claude" }, { homeDir: home });

        expect(second.exitCode).toBe(0);
        expect(second.mode).toBe("copy");
    });

    it("repeat init on an already-symlinked target stays a symlink", async () => {
        const targetDir = targetPathFor("claude", home);
        await mkdir(join(targetDir, ".."), { recursive: true });
        await symlink(installDir, targetDir);

        const result = await runInit({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(0);
        expect(result.mode).toBe("symlink");
    });

    describe("--force against an unmanaged target", () => {
        const unmanagedShapes: [
            string,
            (targetDir: string) => Promise<void>,
        ][] = [
            [
                "a foreign file at the target path",
                async (targetDir) => {
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await writeFile(targetDir, "foreign file content");
                },
            ],
            [
                "a foreign directory with arbitrary content",
                async (targetDir) => {
                    await mkdir(targetDir, { recursive: true });
                    await writeFile(
                        join(targetDir, "notes.md"),
                        "foreign content",
                    );
                },
            ],
            [
                "a dangling symlink",
                async (targetDir) => {
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await symlink(join(tmpdir(), "does-not-exist"), targetDir);
                },
            ],
            [
                "a symlink resolving elsewhere",
                async (targetDir) => {
                    const elsewhere = join(tmpdir(), "qrspi-elsewhere");
                    await mkdir(elsewhere, { recursive: true });
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await symlink(elsewhere, targetDir);
                },
            ],
        ];

        for (const [name, seed] of unmanagedShapes) {
            it(`force-clears and places fresh content over ${name}`, async () => {
                const targetDir = targetPathFor("claude", home);
                await seed(targetDir);

                const result = await runInit(
                    { agent: "claude", force: true },
                    { homeDir: home },
                );

                expect(result.exitCode).toBe(0);
                expect(result.mode).toBe("symlink");
            });

            it(`without --force, is unchanged against ${name} (still blocked, no filesystem changes)`, async () => {
                const targetDir = targetPathFor("claude", home);
                await seed(targetDir);

                const result = await runInit(
                    { agent: "claude" },
                    { homeDir: home },
                );

                expect(result.exitCode).toBe(1);
                expect(result.code).toEqual("unmanaged-target");
            });
        }

        it("has no effect against an absent target (places fresh content, no cleanup attempted)", async () => {
            const clearUnmanaged = vi.fn(async () => {});

            const result = await runInit(
                { agent: "claude", force: true },
                { homeDir: home, clearUnmanaged },
            );

            expect(result.exitCode).toBe(0);
            expect(result.mode).toBe("symlink");
            expect(clearUnmanaged).not.toHaveBeenCalled();
        });

        it("reports a force-cleanup failure as a blocked result", async () => {
            const targetDir = targetPathFor("claude", home);
            await mkdir(targetDir, { recursive: true });
            await writeFile(join(targetDir, "notes.md"), "foreign content");
            const clearUnmanaged = async (): Promise<void> => {
                throw new Error("EACCES");
            };

            const result = await runInit(
                { agent: "claude", force: true },
                { homeDir: home, clearUnmanaged },
            );

            expect(result.exitCode).toBe(1);
            expect(result.code).toEqual("cleanup-failed");
        });

        it("doesn't collide with the existing managed-other-mode replacement path", async () => {
            const first = await runInit(
                { agent: "claude", copy: true },
                { homeDir: home },
            );
            expect(first.exitCode).toBe(0);
            expect(first.mode).toBe("copy");

            const clearUnmanaged = vi.fn(async () => {});
            const result = await runInit(
                { agent: "claude", symlink: true, force: true },
                { homeDir: home, clearUnmanaged },
            );

            expect(result.exitCode).toBe(0);
            expect(result.mode).toBe("symlink");
            // Routed through the existing managed-replacement path, not
            // the unmanaged-cleanup path.
            expect(clearUnmanaged).not.toHaveBeenCalled();
        });
    });
});

describe("plugin update", () => {
    let workDir: string;
    let home: string;
    let installDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), "qrspi-update-"));
        home = join(workDir, "home");
        installDir = join(home, ".qrspi", "plugin");
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    function fakeStagingWith(manifestFields: {
        version: string;
        archiveHash: string;
    }): Staging & { cleanup: ReturnType<typeof vi.fn> } {
        const cleanup = vi.fn(async () => {});
        return {
            download: vi.fn(
                async (): Promise<DownloadResult> => ({
                    ok: true,
                    archivePath: "/tmp/fake/release.zip",
                    cleanup,
                }),
            ),
            extractAndCommit: vi.fn(
                async (): Promise<ExtractAndCommitResult> => {
                    // Mirrors Staging.extractAndCommit's real effect: stamps
                    // the manifest it also writes to installDir, since
                    // runUpdate reads that file back off disk afterward.
                    const manifest = {
                        version: manifestFields.version,
                        payloadPaths: ["agents", "README.md"],
                        releaseTag: manifestFields.version,
                        downloadedAt: "2026-01-01T00:00:00.000Z",
                        archiveHash: manifestFields.archiveHash,
                    };
                    await mkdir(join(installDir, "agents"), {
                        recursive: true,
                    });
                    await writeFile(join(installDir, "README.md"), "readme");
                    await writeFile(
                        join(installDir, "qrspi-manifest.json"),
                        JSON.stringify(manifest),
                    );
                    return { ok: true, manifest };
                },
            ),
            cleanup,
        };
    }

    it("refreshes only the central payload when no agents were previously initialized", async () => {
        const github = fakeGitHub({});
        const staging = fakeStagingWith({
            version: "1.1.0",
            archiveHash: "sha256:new",
        });

        const result = await runUpdate({}, { homeDir: home, github, staging });

        expect(result.exitCode).toBe(0);
        expect(result.agents).toEqual([
            { agent: "claude", outcome: "skipped-not-initialized" },
            { agent: "codex", outcome: "skipped-not-initialized" },
            { agent: "bob", outcome: "skipped-not-initialized" },
        ]);
    });

    it("leaves an already-current agent untouched and reports it as such, not updated", async () => {
        const github = fakeGitHub({});
        const firstStaging = fakeStagingWith({
            version: "1.0.0",
            archiveHash: "sha256:same",
        });
        await runInstall({}, { github, staging: firstStaging });
        await runInit({ agent: "claude", copy: true }, { homeDir: home });

        const secondStaging = fakeStagingWith({
            version: "1.0.0",
            archiveHash: "sha256:same",
        });
        const before = await readFile(
            join(targetPathFor("claude", home), "qrspi-manifest.json"),
            "utf8",
        );

        const result = await runUpdate(
            {},
            { homeDir: home, github, staging: secondStaging },
        );

        expect(result.exitCode).toBe(0);
        expect(result.agents).toContainEqual({
            agent: "claude",
            outcome: "already-current",
            mode: "copy",
        });
        const after = await readFile(
            join(targetPathFor("claude", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(after).toBe(before);
    });

    it("refreshes a copy-mode agent whose manifest reports an older version/hash", async () => {
        const github = fakeGitHub({});
        await runInstall(
            {},
            {
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:old",
                }),
            },
        );
        await runInit({ agent: "claude", copy: true }, { homeDir: home });

        const result = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.1.0",
                    archiveHash: "sha256:new",
                }),
            },
        );

        expect(result.exitCode).toBe(0);
        expect(result.agents).toContainEqual({
            agent: "claude",
            outcome: "updated",
            mode: "copy",
        });
        const refreshed = await readFile(
            join(targetPathFor("claude", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(refreshed).version).toBe("1.1.0");
    });

    it("one agent succeeds then the next fails: the first's update and the refreshed central payload stay in place, exit is non-zero, and the report is accurate", async () => {
        const github = fakeGitHub({});
        await runInstall(
            {},
            {
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:old",
                }),
            },
        );
        await runInit({ agent: "claude", copy: true }, { homeDir: home });
        await runInit({ agent: "codex", copy: true }, { homeDir: home });

        // Simulates a re-placement failure for codex specifically (e.g.
        // a permissions error), via a custom `place` that delegates to
        // the real placeTarget for every other agent.
        const codexTarget = targetPathFor("codex", home);
        const place = vi.fn(
            async (
                targetDir: string,
                installDir: string,
                requested: "copy" | "symlink" | undefined,
            ) => {
                if (targetDir === codexTarget) {
                    return {
                        ok: false as const,
                        reason: "symlink-unavailable" as const,
                        message: "simulated failure",
                    };
                }
                return placeTarget(targetDir, installDir, requested);
            },
        );

        const result = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.1.0",
                    archiveHash: "sha256:new",
                }),
                place,
            },
        );

        expect(result.exitCode).toBe(1);
        expect(result.agents).toEqual([
            { agent: "claude", outcome: "updated", mode: "copy" },
            {
                agent: "codex",
                outcome: "failed",
                reason: "symlink-unavailable",
                message: "simulated failure",
            },
            {
                agent: "bob",
                outcome: "failed",
                reason: "not-reached",
                message: "Not reached: an earlier agent's update failed.",
            },
        ]);

        // claude's update and the refreshed central payload remain.
        const claudeManifest = await readFile(
            join(targetPathFor("claude", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(claudeManifest).version).toBe("1.1.0");
        const centralManifest = await readFile(
            join(installDir, "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(centralManifest).version).toBe("1.1.0");
    });

    it("reports a thrown placement error (e.g. EACCES) the same way as a returned placement failure, rather than letting it escape uncaught", async () => {
        const github = fakeGitHub({});
        await runInstall(
            {},
            {
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:old",
                }),
            },
        );
        await runInit({ agent: "claude", copy: true }, { homeDir: home });
        await runInit({ agent: "codex", copy: true }, { homeDir: home });

        const codexTarget = targetPathFor("codex", home);
        const place = vi.fn(
            async (
                targetDir: string,
                installDir: string,
                requested: "copy" | "symlink" | undefined,
            ) => {
                if (targetDir === codexTarget) {
                    throw Object.assign(new Error("permission denied"), {
                        code: "EACCES",
                    });
                }
                return placeTarget(targetDir, installDir, requested);
            },
        );

        const result = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.1.0",
                    archiveHash: "sha256:new",
                }),
                place,
            },
        );

        expect(result.exitCode).toBe(1);
        expect(result.agents).toEqual([
            { agent: "claude", outcome: "updated", mode: "copy" },
            {
                agent: "codex",
                outcome: "failed",
                reason: "placement-failed",
                message: "permission denied",
            },
            {
                agent: "bob",
                outcome: "failed",
                reason: "not-reached",
                message: "Not reached: an earlier agent's update failed.",
            },
        ]);

        // claude's update and the refreshed central payload remain,
        // same no-rollback guarantee as a returned placement failure.
        const claudeManifest = await readFile(
            join(targetPathFor("claude", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(claudeManifest).version).toBe("1.1.0");
    });

    it("re-running after a partial failure re-probes fresh and retries only what's still not current, redoing nothing already done", async () => {
        const github = fakeGitHub({});
        await runInstall(
            {},
            {
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:old",
                }),
            },
        );
        await runInit({ agent: "claude", copy: true }, { homeDir: home });
        await runInit({ agent: "codex", copy: true }, { homeDir: home });

        // First update to 1.1.0: codex's re-placement fails, so claude
        // updates but codex and bob (not reached) don't.
        const codexTarget = targetPathFor("codex", home);
        const failingPlace = vi.fn(
            async (
                targetDir: string,
                installDir: string,
                requested: "copy" | "symlink" | undefined,
            ) =>
                targetDir === codexTarget
                    ? {
                          ok: false as const,
                          reason: "symlink-unavailable" as const,
                          message: "simulated failure",
                      }
                    : placeTarget(targetDir, installDir, requested),
        );
        const firstUpdate = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.1.0",
                    archiveHash: "sha256:new",
                }),
                place: failingPlace,
            },
        );
        expect(firstUpdate.exitCode).toBe(1);

        // Second update, to 1.2.0, with placement no longer failing:
        // claude (last updated to 1.1.0) is not current against 1.2.0
        // and is retried; codex (still at 1.0.0) is also retried; the
        // real placeTarget call count proves claude is re-placed once
        // here, not twice for both runs combined.
        const place = vi.fn(placeTarget);
        const secondUpdate = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.2.0",
                    archiveHash: "sha256:newer",
                }),
                place,
            },
        );

        expect(secondUpdate.exitCode).toBe(0);
        expect(secondUpdate.agents).toEqual([
            { agent: "claude", outcome: "updated", mode: "copy" },
            { agent: "codex", outcome: "updated", mode: "copy" },
            { agent: "bob", outcome: "skipped-not-initialized" },
        ]);
        expect(place).toHaveBeenCalledTimes(2);

        const claudeManifest = await readFile(
            join(targetPathFor("claude", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(claudeManifest).version).toBe("1.2.0");
        const codexManifest = await readFile(
            join(targetPathFor("codex", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(codexManifest).version).toBe("1.2.0");
    });

    it("reports an unmanaged-target agent as a failed agent and continues the run", async () => {
        const github = fakeGitHub({});
        await runInstall(
            {},
            {
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:old",
                }),
            },
        );
        const claudeTarget = targetPathFor("claude", home);
        await mkdir(claudeTarget, { recursive: true });
        await writeFile(join(claudeTarget, "notes.md"), "foreign content");

        const result = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.1.0",
                    archiveHash: "sha256:new",
                }),
            },
        );

        expect(result.exitCode).toBe(1);
        expect(result.agents).toEqual([
            {
                agent: "claude",
                outcome: "failed",
                reason: "unmanaged-target",
                message: expect.stringContaining(
                    "not a QRSPI-X-managed target",
                ),
            },
            { agent: "codex", outcome: "skipped-not-initialized" },
            { agent: "bob", outcome: "skipped-not-initialized" },
        ]);
    });

    it("stops with no agent probing attempted when install itself fails", async () => {
        // An existing, already-placed claude target: if runUpdate probed
        // agents after this install failure, it would show up here.
        await runInstall(
            {},
            {
                github: fakeGitHub({}),
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:old",
                }),
            },
        );
        await runInit({ agent: "claude", copy: true }, { homeDir: home });

        const github = fakeGitHub({
            resolveRelease: {
                ok: false,
                reason: "invalid-tag",
                message: '"bogus" is not a valid release tag.',
            },
        });
        const place = vi.fn(placeTarget);

        const result = await runUpdate(
            { release: "bogus" },
            { homeDir: home, github, place },
        );

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("invalid-tag");
        expect(result.agents).toBeUndefined();
        expect(place).not.toHaveBeenCalled();
    });

    describe("--force against an unmanaged agent", () => {
        const unmanagedShapes: [
            string,
            (targetDir: string) => Promise<void>,
        ][] = [
            [
                "a foreign file at the target path",
                async (targetDir) => {
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await writeFile(targetDir, "foreign file content");
                },
            ],
            [
                "a foreign directory with arbitrary content",
                async (targetDir) => {
                    await mkdir(targetDir, { recursive: true });
                    await writeFile(
                        join(targetDir, "notes.md"),
                        "foreign content",
                    );
                },
            ],
            [
                "a dangling symlink",
                async (targetDir) => {
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await symlink(join(tmpdir(), "does-not-exist"), targetDir);
                },
            ],
            [
                "a symlink resolving elsewhere",
                async (targetDir) => {
                    const elsewhere = join(tmpdir(), "qrspi-elsewhere");
                    await mkdir(elsewhere, { recursive: true });
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await symlink(elsewhere, targetDir);
                },
            ],
        ];

        for (const [name, seed] of unmanagedShapes) {
            it(`force-clears and places fresh content over ${name}, reporting updated`, async () => {
                const github = fakeGitHub({});
                await runInstall(
                    {},
                    {
                        github,
                        staging: fakeStagingWith({
                            version: "1.0.0",
                            archiveHash: "sha256:same",
                        }),
                    },
                );
                const targetDir = targetPathFor("claude", home);
                await seed(targetDir);

                const result = await runUpdate(
                    { force: true },
                    {
                        homeDir: home,
                        github,
                        staging: fakeStagingWith({
                            version: "1.0.0",
                            archiveHash: "sha256:same",
                        }),
                    },
                );

                expect(result.exitCode).toBe(0);
                expect(result.agents).toContainEqual(
                    expect.objectContaining({
                        agent: "claude",
                        outcome: "updated",
                    }),
                );
            });

            it(`without --force, is unchanged against ${name} (failed/unmanaged-target, no filesystem changes)`, async () => {
                const github = fakeGitHub({});
                await runInstall(
                    {},
                    {
                        github,
                        staging: fakeStagingWith({
                            version: "1.0.0",
                            archiveHash: "sha256:same",
                        }),
                    },
                );
                const targetDir = targetPathFor("claude", home);
                await seed(targetDir);

                const result = await runUpdate(
                    {},
                    {
                        homeDir: home,
                        github,
                        staging: fakeStagingWith({
                            version: "1.0.0",
                            archiveHash: "sha256:same",
                        }),
                    },
                );

                expect(result.agents).toContainEqual(
                    expect.objectContaining({
                        agent: "claude",
                        outcome: "failed",
                        reason: "unmanaged-target",
                    }),
                );
            });
        }

        it("affects only the unmanaged agent, leaving an absent and an already-current agent untouched", async () => {
            const github = fakeGitHub({});
            await runInstall(
                {},
                {
                    github,
                    staging: fakeStagingWith({
                        version: "1.0.0",
                        archiveHash: "sha256:same",
                    }),
                },
            );
            // codex: already-current.
            await runInit({ agent: "codex", copy: true }, { homeDir: home });
            // bob: unmanaged.
            const bobTarget = targetPathFor("bob", home);
            await mkdir(bobTarget, { recursive: true });
            await writeFile(join(bobTarget, "notes.md"), "foreign content");
            // claude: left absent.

            const result = await runUpdate(
                { force: true },
                {
                    homeDir: home,
                    github,
                    staging: fakeStagingWith({
                        version: "1.0.0",
                        archiveHash: "sha256:same",
                    }),
                },
            );

            expect(result.exitCode).toBe(0);
            expect(result.agents).toEqual([
                { agent: "claude", outcome: "skipped-not-initialized" },
                { agent: "codex", outcome: "already-current", mode: "copy" },
                { agent: "bob", outcome: "updated", mode: "symlink" },
            ]);
        });

        it("stops the run and reports when force-cleanup succeeds but the subsequent placement fails", async () => {
            const github = fakeGitHub({});
            await runInstall(
                {},
                {
                    github,
                    staging: fakeStagingWith({
                        version: "1.0.0",
                        archiveHash: "sha256:same",
                    }),
                },
            );
            const claudeTarget = targetPathFor("claude", home);
            await mkdir(claudeTarget, { recursive: true });
            await writeFile(join(claudeTarget, "notes.md"), "foreign content");

            const place = vi.fn(
                async (
                    targetDir: string,
                    _installDir: string,
                    _requested: "copy" | "symlink" | undefined,
                ) => {
                    if (targetDir === claudeTarget) {
                        throw Object.assign(new Error("permission denied"), {
                            code: "EACCES",
                        });
                    }
                    throw new Error("unexpected placeTarget call");
                },
            );

            const result = await runUpdate(
                { force: true },
                {
                    homeDir: home,
                    github,
                    staging: fakeStagingWith({
                        version: "1.0.0",
                        archiveHash: "sha256:same",
                    }),
                    place,
                },
            );

            expect(result.exitCode).toBe(1);
            expect(result.agents).toEqual([
                {
                    agent: "claude",
                    outcome: "failed",
                    reason: "placement-failed",
                    message: "permission denied",
                },
                {
                    agent: "codex",
                    outcome: "failed",
                    reason: "not-reached",
                    message: "Not reached: an earlier agent's update failed.",
                },
                {
                    agent: "bob",
                    outcome: "failed",
                    reason: "not-reached",
                    message: "Not reached: an earlier agent's update failed.",
                },
            ]);
        });
    });
});

describe("plugin status", () => {
    let workDir: string;
    let home: string;
    let installDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), "qrspi-status-"));
        home = join(workDir, "home");
        installDir = join(home, ".qrspi", "plugin");
        await mkdir(join(installDir, "agents"), { recursive: true });
        await writeFile(join(installDir, "README.md"), "readme content");
        await writeFile(
            join(installDir, "qrspi-manifest.json"),
            JSON.stringify({
                version: "1.0.0",
                payloadPaths: ["agents", "README.md"],
                releaseTag: "1.0.0",
                downloadedAt: "2026-10-01T00:00:00.000Z",
                archiveHash: "sha256:abc123",
            }),
        );
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    async function snapshot(dir: string): Promise<string[]> {
        try {
            return (await readdir(dir, { recursive: true })) as string[];
        } catch {
            return [];
        }
    }

    it("reports installed version, per-agent placement, and freshness after install plus some init calls", async () => {
        await runInit({ agent: "claude", symlink: true }, { homeDir: home });
        await runInit({ agent: "codex", copy: true }, { homeDir: home });
        const github = fakeGitHub({
            checkFreshness: { status: "update-available", latest: "1.1.0" },
        });

        const result = await runStatus({ homeDir: home, github });

        expect(result.exitCode).toBe(0);
        expect(result.installed).toBe(true);
        expect(result.version).toBe("1.0.0");
        expect(result.agents).toEqual([
            { agent: "claude", present: true, mode: "symlink" },
            { agent: "codex", present: true, mode: "copy" },
            { agent: "bob", present: false },
        ]);
        expect(result.freshness).toEqual({
            status: "update-available",
            latest: "1.1.0",
        });
        expect(github.checkFreshness).toHaveBeenCalledWith("1.0.0");
    });

    it("reports not-installed and every agent absent when nothing was installed, but still attempts freshness", async () => {
        await rm(installDir, { recursive: true, force: true });
        const github = fakeGitHub({});

        const result = await runStatus({ homeDir: home, github });

        expect(result.exitCode).toBe(0);
        expect(result.installed).toBe(false);
        expect(result.version).toBeUndefined();
        expect(result.agents).toEqual([
            { agent: "claude", present: false },
            { agent: "codex", present: false },
            { agent: "bob", present: false },
        ]);
        expect(github.checkFreshness).toHaveBeenCalledWith("");
    });

    it("actually queries GitHub for freshness with nothing installed, through the real GitHub wiring (not a mock)", async () => {
        // Exercises the real gitHubAt()/checkFreshness seam, not a
        // fully mocked GitHub — a mock can assert it was *called* with
        // "" without proving checkFreshness itself does anything with
        // that call, which is exactly where the short-circuit bug lived.
        await rm(installDir, { recursive: true, force: true });
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([{ tagName: "2.0.0" }]),
                stderr: "",
            }),
        });
        const github = gitHubAt(QRSPI_X_REPO, home, { execFile });

        const result = await runStatus({ homeDir: home, github });

        expect(result.exitCode).toBe(0);
        expect(result.installed).toBe(false);
        expect(result.freshness).toEqual({
            status: "unknown",
            latest: "2.0.0",
        });
    });

    it("still exits 0 and reports local info when the freshness check itself fails", async () => {
        const github = fakeGitHub({
            checkFreshness: { status: "unknown", message: "rate limited" },
        });

        const result = await runStatus({ homeDir: home, github });

        expect(result.exitCode).toBe(0);
        expect(result.installed).toBe(true);
        expect(result.freshness).toEqual({
            status: "unknown",
            message: "rate limited",
        });
        expect(result.text).toBe(
            "Installed version 1.0.0. Error checking available releases: rate limited",
        );
    });

    it("reports up to date in the human-readable text when freshness matches the installed version", async () => {
        const github = fakeGitHub({
            checkFreshness: { status: "up-to-date" },
        });

        const result = await runStatus({ homeDir: home, github });

        expect(result.text).toBe("Installed version 1.0.0. Up to date.");
    });

    it("treats a foreign/unmanaged target as present-but-unmanaged, not an error", async () => {
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "notes.md"), "foreign content");
        const github = fakeGitHub({});

        const result = await runStatus({ homeDir: home, github });

        expect(result.exitCode).toBe(0);
        expect(result.agents).toContainEqual({
            agent: "claude",
            present: true,
            mode: "unmanaged",
        });
    });

    it("surfaces a real probing error distinctly as a command failure", async () => {
        // A manifest file the probe can't read (EACCES) is a portable
        // stand-in for a real (non-ENOENT) probing error, not "absent"
        // or "unmanaged".
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        const manifestPath = join(targetDir, "qrspi-manifest.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                version: "1.0.0",
                payloadPaths: ["agents", "README.md"],
                releaseTag: "1.0.0",
                downloadedAt: "2026-10-01T00:00:00.000Z",
                archiveHash: "sha256:abc123",
            }),
        );
        await chmod(manifestPath, 0o000);
        const github = fakeGitHub({});

        try {
            const result = await runStatus({ homeDir: home, github });

            expect(result.exitCode).toBe(1);
            expect(result.code).toEqual("probe-failed");
        } finally {
            await chmod(manifestPath, 0o644);
        }
    });

    it("surfaces a real central-manifest read error distinctly as a command failure", async () => {
        // A directory where the manifest file is expected: readFile
        // throws EISDIR, a portable stand-in for a real (non-ENOENT)
        // read error, same trick as the probe-failed case above.
        const manifestPath = join(installDir, "qrspi-manifest.json");
        await rm(manifestPath, { force: true });
        await mkdir(manifestPath, { recursive: true });
        const github = fakeGitHub({});

        const result = await runStatus({ homeDir: home, github });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("manifest-read-failed");
        expect(github.checkFreshness).not.toHaveBeenCalled();
    });

    it("makes no filesystem changes under any outcome", async () => {
        const before = await snapshot(workDir);
        const github = fakeGitHub({});

        await runStatus({ homeDir: home, github });

        const after = await snapshot(workDir);
        expect(after).toEqual(before);
    });
});

describe("plugin install -> init -> update -> status round trip", () => {
    let workDir: string;
    let home: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), "qrspi-roundtrip-"));
        home = join(workDir, "home");
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    function fakeStagingWith(manifestFields: {
        version: string;
        archiveHash: string;
    }): Staging {
        const installDir = join(home, ".qrspi", "plugin");
        return {
            download: vi.fn(
                async (): Promise<DownloadResult> => ({
                    ok: true,
                    archivePath: "/tmp/fake/release.zip",
                    cleanup: vi.fn(async () => {}),
                }),
            ),
            extractAndCommit: vi.fn(
                async (): Promise<ExtractAndCommitResult> => {
                    const manifest = {
                        version: manifestFields.version,
                        payloadPaths: ["agents", "README.md"],
                        releaseTag: manifestFields.version,
                        downloadedAt: "2026-01-01T00:00:00.000Z",
                        archiveHash: manifestFields.archiveHash,
                    };
                    await mkdir(join(installDir, "agents"), {
                        recursive: true,
                    });
                    await writeFile(join(installDir, "README.md"), "readme");
                    await writeFile(
                        join(installDir, "qrspi-manifest.json"),
                        JSON.stringify(manifest),
                    );
                    return { ok: true, manifest };
                },
            ),
        };
    }

    it("agrees on what's installed and current across install, mixed-mode init, update against a newer release, and status", async () => {
        const github = fakeGitHub({});

        // install
        const installResult = await runInstall(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:v1",
                }),
            },
        );
        expect(installResult.exitCode).toBe(0);

        // init, mixing copy and symlink mode across agents
        const claudeInit = await runInit(
            { agent: "claude", symlink: true },
            { homeDir: home },
        );
        const codexInit = await runInit(
            { agent: "codex", copy: true },
            { homeDir: home },
        );
        expect(claudeInit.exitCode).toBe(0);
        expect(codexInit.exitCode).toBe(0);
        // bob is deliberately left un-initialized.

        // update, against a newer release
        const updateResult = await runUpdate(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.1.0",
                    archiveHash: "sha256:v2",
                }),
            },
        );
        expect(updateResult.exitCode).toBe(0);
        expect(updateResult.agents).toEqual([
            // A symlink target always resolves to the central payload,
            // so it's already current and never re-placed.
            { agent: "claude", outcome: "already-current", mode: "symlink" },
            // A copy target's manifest still says 1.0.0, so it's
            // refreshed.
            { agent: "codex", outcome: "updated", mode: "copy" },
            { agent: "bob", outcome: "skipped-not-initialized" },
        ]);

        // status agrees: claude/codex present in their original modes,
        // bob absent, and the installed version is the updated one.
        const statusResult = await runStatus({ homeDir: home, github });
        expect(statusResult.exitCode).toBe(0);
        expect(statusResult.version).toBe("1.1.0");
        expect(statusResult.agents).toEqual([
            { agent: "claude", present: true, mode: "symlink" },
            { agent: "codex", present: true, mode: "copy" },
            { agent: "bob", present: false },
        ]);

        // codex's copied manifest matches the updated central one.
        const codexManifest = await readFile(
            join(targetPathFor("codex", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(codexManifest).version).toBe("1.1.0");
    });

    it("install -> init --force against a pre-seeded foreign directory -> status reports the agent present and managed", async () => {
        const github = fakeGitHub({});

        const installResult = await runInstall(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:v1",
                }),
            },
        );
        expect(installResult.exitCode).toBe(0);

        // Pre-seed claude's target with foreign content init would
        // otherwise refuse to touch.
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "notes.md"), "foreign content");

        const initResult = await runInit(
            { agent: "claude", force: true },
            { homeDir: home },
        );
        expect(initResult.exitCode).toBe(0);

        const statusResult = await runStatus({ homeDir: home, github });
        expect(statusResult.exitCode).toBe(0);
        expect(statusResult.agents).toContainEqual({
            agent: "claude",
            present: true,
            mode: "symlink",
        });
    });

    it("install -> init -> target manually replaced with foreign content -> remove --force -> status reports the agent not present", async () => {
        const github = fakeGitHub({});

        const installResult = await runInstall(
            {},
            {
                homeDir: home,
                github,
                staging: fakeStagingWith({
                    version: "1.0.0",
                    archiveHash: "sha256:v1",
                }),
            },
        );
        expect(installResult.exitCode).toBe(0);

        const initResult = await runInit(
            { agent: "claude", copy: true },
            { homeDir: home },
        );
        expect(initResult.exitCode).toBe(0);

        // Manually replace the managed target with foreign content.
        const targetDir = targetPathFor("claude", home);
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "notes.md"), "foreign content");

        const removeResult = await runRemove(
            { agent: "claude", force: true },
            { homeDir: home },
        );
        expect(removeResult.exitCode).toBe(0);

        const statusResult = await runStatus({ homeDir: home, github });
        expect(statusResult.exitCode).toBe(0);
        expect(statusResult.agents).toContainEqual({
            agent: "claude",
            present: false,
        });
    });

    it("install -> init -> remove using the real 5-entry package-release.sh payload shape (.claude-plugin, README.md, LICENSE, skills, agents)", async () => {
        // Every other fixture in this file uses a reduced 2-3 entry
        // payload for brevity. This test exercises the real extraction
        // path (stagingAt's own listTopLevelEntries, not a faked
        // Staging) against the actual archive shape
        // .github/scripts/package-release.sh produces, so init's
        // copy-mode placement and remove's declared-paths deletion are
        // proven against every top-level entry a real release ships,
        // not just a couple of them.
        const archive = buildZip([
            {
                path: "qrspi-manifest.json",
                content: JSON.stringify({ version: "1.0.0" }),
            },
            {
                path: ".claude-plugin/plugin.json",
                content: '{"name":"qrspi-x"}',
            },
            { path: "README.md", content: "readme content" },
            { path: "LICENSE", content: "license text" },
            { path: "skills/qrspi-x/SKILL.md", content: "skill content" },
            { path: "agents/query.md", content: "agent content" },
        ]);
        const execFile = fakeExecFile({
            "release download": async (args) => {
                const outputIndex = args.indexOf("--output");
                const destPath = args[outputIndex + 1] as string;
                await writeFile(destPath, archive);
                return { stdout: "", stderr: "" };
            },
        });
        const github = fakeGitHub({});

        const installResult = await runInstall(
            {},
            { homeDir: home, execFile, github },
        );
        expect(installResult.exitCode).toBe(0);

        const installDir = join(home, ".qrspi", "plugin");
        const centralManifest = JSON.parse(
            await readFile(join(installDir, "qrspi-manifest.json"), "utf8"),
        );
        expect(centralManifest.payloadPaths.sort()).toEqual(
            [
                ".claude-plugin",
                "README.md",
                "LICENSE",
                "skills",
                "agents",
            ].sort(),
        );

        const initResult = await runInit(
            { agent: "claude", copy: true },
            { homeDir: home },
        );
        expect(initResult.exitCode).toBe(0);

        const targetDir = targetPathFor("claude", home);
        expect(
            await readFile(
                join(targetDir, ".claude-plugin", "plugin.json"),
                "utf8",
            ),
        ).toBe('{"name":"qrspi-x"}');
        expect(await readFile(join(targetDir, "LICENSE"), "utf8")).toBe(
            "license text",
        );

        const removeResult = await runRemove(
            { agent: "claude" },
            { homeDir: home },
        );
        expect(removeResult.exitCode).toBe(0);
        await expect(
            readFile(join(targetDir, "LICENSE"), "utf8"),
        ).rejects.toThrow();

        const statusResult = await runStatus({ homeDir: home, github });
        expect(statusResult.agents).toContainEqual({
            agent: "claude",
            present: false,
        });
    });
});

describe("plugin remove", () => {
    let workDir: string;
    let home: string;
    let installDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), "qrspi-remove-"));
        home = join(workDir, "home");
        installDir = join(home, ".qrspi", "plugin");
        await mkdir(join(installDir, "agents"), { recursive: true });
        await writeFile(join(installDir, "README.md"), "readme content");
        await writeFile(
            join(installDir, "qrspi-manifest.json"),
            JSON.stringify({
                version: "1.0.0",
                payloadPaths: ["agents", "README.md"],
                releaseTag: "1.0.0",
                downloadedAt: "2026-10-01T00:00:00.000Z",
                archiveHash: "sha256:abc123",
            }),
        );
    });

    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    it("removes a previously-initialized agent, confirmed absent by a subsequent status", async () => {
        await runInit({ agent: "claude", copy: true }, { homeDir: home });

        const result = await runRemove({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(0);
        expect(result.removed).toBe(true);
        const status = await runStatus({
            homeDir: home,
            github: fakeGitHub({}),
        });
        expect(status.agents).toContainEqual({
            agent: "claude",
            present: false,
        });
    });

    it("reports a never-initialized agent as a no-op success", async () => {
        const result = await runRemove({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(0);
        expect(result.removed).toBe(false);
    });

    it("refuses an unmanaged target with no changes", async () => {
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "notes.md"), "foreign content");

        const result = await runRemove({ agent: "claude" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("unmanaged-target");
        expect(await readdir(targetDir)).toEqual(["notes.md"]);
    });

    it("reports a forced unmanaged cleanup failure as a blocked result", async () => {
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "notes.md"), "foreign content");
        const clearUnmanaged = async (): Promise<void> => {
            throw new Error("EACCES");
        };

        const result = await runRemove(
            { agent: "claude", force: true },
            { homeDir: home, clearUnmanaged },
        );

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("cleanup-failed");
        expect(result.text).toContain("EACCES");
    });

    it("surfaces removeTarget's extras-block as a blocked CommandResult naming the extra path, then succeeds once --force is passed through", async () => {
        // removeTarget's own blocked/forced file-removal mechanics are
        // already proven in Target.test.ts; this only checks that
        // runRemove surfaces that outcome as the right CommandResult
        // (exit code, finding code, text) and that --force actually
        // reaches removeTarget's `force` parameter.
        await runInit({ agent: "claude", copy: true }, { homeDir: home });
        const targetDir = targetPathFor("claude", home);
        await writeFile(join(targetDir, "notes.md"), "foreign content");

        const blockedResult = await runRemove(
            { agent: "claude" },
            { homeDir: home },
        );
        expect(blockedResult.exitCode).toBe(1);
        expect(blockedResult.code).toEqual("blocked-by-extras");
        expect(blockedResult.text).toContain("notes.md");

        const forcedResult = await runRemove(
            { agent: "claude", force: true },
            { homeDir: home },
        );
        expect(forcedResult.exitCode).toBe(0);
    });

    it("rejects an unknown agent name, listing supported agents", async () => {
        const result = await runRemove({ agent: "cursor" }, { homeDir: home });

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("unknown-agent");
    });

    it("only touches the named agent's target, never another agent's target or the central payload", async () => {
        await runInit({ agent: "claude", copy: true }, { homeDir: home });
        await runInit({ agent: "codex", copy: true }, { homeDir: home });

        await runRemove({ agent: "claude" }, { homeDir: home });

        const codexManifest = await readFile(
            join(targetPathFor("codex", home), "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(codexManifest).version).toBe("1.0.0");
        const centralManifest = await readFile(
            join(installDir, "qrspi-manifest.json"),
            "utf8",
        );
        expect(JSON.parse(centralManifest).version).toBe("1.0.0");
    });

    it("surfaces a real probing error distinctly rather than attempting removal", async () => {
        // A manifest file the probe can't read (EACCES) is a portable
        // stand-in for a real (non-ENOENT) probing error, not "absent"
        // or "unmanaged".
        const targetDir = targetPathFor("claude", home);
        await mkdir(targetDir, { recursive: true });
        const manifestPath = join(targetDir, "qrspi-manifest.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                version: "1.0.0",
                payloadPaths: ["agents", "README.md"],
                releaseTag: "1.0.0",
                downloadedAt: "2026-10-01T00:00:00.000Z",
                archiveHash: "sha256:abc123",
            }),
        );
        await chmod(manifestPath, 0o000);

        const result = await runRemove({ agent: "claude" }, { homeDir: home });
        await chmod(manifestPath, 0o644);

        expect(result.exitCode).toBe(1);
        expect(result.code).toEqual("probe-failed");
    });

    describe("--force against an unmanaged target", () => {
        const unmanagedShapes: [
            string,
            (targetDir: string) => Promise<void>,
        ][] = [
            [
                "a foreign file at the target path",
                async (targetDir) => {
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await writeFile(targetDir, "foreign file content");
                },
            ],
            [
                "a foreign directory with arbitrary content",
                async (targetDir) => {
                    await mkdir(targetDir, { recursive: true });
                    await writeFile(
                        join(targetDir, "notes.md"),
                        "foreign content",
                    );
                },
            ],
            [
                "a dangling symlink",
                async (targetDir) => {
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await symlink(join(tmpdir(), "does-not-exist"), targetDir);
                },
            ],
            [
                "a symlink resolving elsewhere",
                async (targetDir) => {
                    const elsewhere = join(tmpdir(), "qrspi-elsewhere");
                    await mkdir(elsewhere, { recursive: true });
                    await mkdir(join(targetDir, ".."), {
                        recursive: true,
                    });
                    await symlink(elsewhere, targetDir);
                },
            ],
        ];

        for (const [name, seed] of unmanagedShapes) {
            it(`force-clears and reports success over ${name}, leaving the target absent`, async () => {
                const targetDir = targetPathFor("claude", home);
                await seed(targetDir);

                const result = await runRemove(
                    { agent: "claude", force: true },
                    { homeDir: home },
                );

                expect(result.exitCode).toBe(0);
                expect(result.removed).toBe(true);
                const probe = await probeTarget(targetDir, installDir);
                expect(probe).toEqual({ state: "absent" });
            });

            it(`without --force, is unchanged against ${name} (still blocked, no filesystem changes)`, async () => {
                const targetDir = targetPathFor("claude", home);
                await seed(targetDir);

                const result = await runRemove(
                    { agent: "claude" },
                    { homeDir: home },
                );

                expect(result.exitCode).toBe(1);
                expect(result.code).toEqual("unmanaged-target");
            });
        }

        it("leaves the existing managed-copy-mode extras behavior unaffected (--force there still only trims declared paths)", async () => {
            await runInit({ agent: "claude", copy: true }, { homeDir: home });
            const targetDir = targetPathFor("claude", home);
            await writeFile(join(targetDir, "notes.md"), "foreign content");

            const result = await runRemove(
                { agent: "claude", force: true },
                { homeDir: home },
            );

            expect(result.exitCode).toBe(0);
            // The declared paths and manifest are gone, but the extra
            // file and the directory containing it remain — the
            // managed-mode guarantee, not the unmanaged-style
            // whole-target delete.
            expect(await readdir(targetDir)).toEqual(["notes.md"]);
        });

        it("has no effect against an absent target (not installed, no error, no cleanup attempted)", async () => {
            const clearUnmanaged = vi.fn(async () => {});

            const result = await runRemove(
                { agent: "claude", force: true },
                { homeDir: home, clearUnmanaged },
            );

            expect(result.exitCode).toBe(0);
            expect(result.removed).toBe(false);
            expect(clearUnmanaged).not.toHaveBeenCalled();
        });
    });
});
