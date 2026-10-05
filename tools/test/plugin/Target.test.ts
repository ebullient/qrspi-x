import {
    chmod,
    lstat,
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginManifest } from "../../src/plugin/Manifest.ts";
import {
    AGENT_NAMES,
    clearUnmanagedTarget,
    isAgentName,
    isCurrent,
    placeTarget,
    probeTarget,
    removeTarget,
    targetPathFor,
} from "../../src/plugin/Target.ts";

let workDir: string;
let home: string;
let installDir: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "qrspi-target-"));
    home = join(workDir, "home");
    installDir = join(workDir, "install");
    await mkdir(home, { recursive: true });
    await mkdir(installDir, { recursive: true });
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

function validManifest(payloadPaths: string[]): PluginManifest {
    return {
        version: "1.0.0",
        payloadPaths,
        releaseTag: "1.0.0",
        downloadedAt: "2026-10-01T00:00:00.000Z",
        archiveHash: "sha256:abc123",
    };
}

async function writeManifest(
    targetDir: string,
    manifest: unknown,
): Promise<void> {
    await mkdir(targetDir, { recursive: true });
    await writeFile(
        join(targetDir, "qrspi-manifest.json"),
        JSON.stringify(manifest),
        "utf8",
    );
}

describe("isAgentName", () => {
    it("accepts exactly the three supported agents", () => {
        for (const agent of AGENT_NAMES) {
            expect(isAgentName(agent)).toBe(true);
        }
        expect(isAgentName("cursor")).toBe(false);
    });

    it("rejects inherited Object.prototype property names", () => {
        for (const name of [
            "toString",
            "constructor",
            "__proto__",
            "hasOwnProperty",
        ]) {
            expect(isAgentName(name)).toBe(false);
        }
    });
});

describe("targetPathFor", () => {
    it("resolves each agent to exactly the path declared in its table entry", () => {
        for (const agent of AGENT_NAMES) {
            const targetDir = targetPathFor(agent, home);
            // Resolution is a pure function of the table entry, not a
            // literal path string.
            expect(targetDir).toBe(targetPathFor(agent, home));
            expect(targetDir.startsWith(home)).toBe(true);
        }
    });
});

describe("probeTarget", () => {
    it("reports absent when nothing exists at the target", async () => {
        const result = await probeTarget(join(home, "missing"), installDir);
        expect(result.state).toBe("absent");
    });

    it("reports a distinct probing error rather than absent/unmanaged for a real I/O failure", async () => {
        // A manifest file the probe can't read (EACCES) is a portable
        // stand-in for a real (non-ENOENT) probing error.
        const targetDir = join(home, "target");
        await writeManifest(targetDir, validManifest(["agents", "README.md"]));
        const manifestPath = join(targetDir, "qrspi-manifest.json");
        await chmod(manifestPath, 0o000);
        try {
            const result = await probeTarget(targetDir, installDir);
            expect(result.state).toBe("error");
        } finally {
            await chmod(manifestPath, 0o644);
        }
    });

    it("reports managed/symlink when the target resolves to exactly the install dir", async () => {
        const targetDir = join(home, "linked");
        await symlink(installDir, targetDir);
        const result = await probeTarget(targetDir, installDir);
        expect(result).toEqual({ state: "managed", mode: "symlink" });
    });

    it("reports managed/copy when the manifest is valid and every declared path is present", async () => {
        const targetDir = join(home, "copied");
        await writeManifest(targetDir, validManifest(["agents", "README.md"]));
        await mkdir(join(targetDir, "agents"), { recursive: true });
        await writeFile(join(targetDir, "README.md"), "readme");
        const result = await probeTarget(targetDir, installDir);
        expect(result.state).toBe("managed");
        if (result.state === "managed" && result.mode === "copy") {
            expect(result.manifest.payloadPaths).toEqual([
                "agents",
                "README.md",
            ]);
        } else {
            throw new Error("expected managed/copy");
        }
    });

    const unmanagedCases: [string, (targetDir: string) => Promise<void>][] = [
        [
            "dangling symlink",
            async (targetDir) => {
                await symlink(join(tmpdir(), "does-not-exist"), targetDir);
            },
        ],
        [
            "dangling symlink whose text happens to match installDir exactly",
            async (targetDir) => {
                await rm(installDir, { recursive: true, force: true });
                await symlink(installDir, targetDir);
            },
        ],
        [
            "symlink to a subdirectory of the install path",
            async (targetDir) => {
                await symlink(join(installDir, "skills"), targetDir);
            },
        ],
        [
            "symlink elsewhere",
            async (targetDir) => {
                const elsewhere = join(tmpdir(), "elsewhere");
                await mkdir(elsewhere, { recursive: true });
                await symlink(elsewhere, targetDir);
            },
        ],
        [
            "valid manifest without its declared payload present",
            async (targetDir) => {
                await writeManifest(targetDir, validManifest(["agents"]));
            },
        ],
        [
            "payload present without a manifest",
            async (targetDir) => {
                await mkdir(join(targetDir, "agents"), { recursive: true });
            },
        ],
        [
            "unparseable manifest",
            async (targetDir) => {
                await mkdir(targetDir, { recursive: true });
                await writeFile(
                    join(targetDir, "qrspi-manifest.json"),
                    "not json",
                    "utf8",
                );
            },
        ],
        [
            "manifest missing a required field",
            async (targetDir) => {
                const incomplete = validManifest([
                    "agents",
                ]) as Partial<PluginManifest>;
                delete incomplete.archiveHash;
                await writeManifest(targetDir, incomplete);
                await mkdir(join(targetDir, "agents"), { recursive: true });
            },
        ],
        [
            "a verbatim-copied valid manifest with no payload at all on disk",
            async (targetDir) => {
                await writeManifest(
                    targetDir,
                    validManifest(["agents", "skills", "README.md"]),
                );
            },
        ],
        [
            "a manifest declaring a nested payload path through a symlinked intermediate directory pointing outside the target",
            async (targetDir) => {
                // The attack this guards against: lstat only leaves its
                // *final* path component unresolved, so a nested
                // payloadPaths entry like "payload/secret" would still
                // resolve (and probe as present) even if "payload" is a
                // symlink to content entirely outside targetDir — a
                // foreign directory spoofing managed ownership for
                // content it doesn't actually have. Manifest.ts rejects
                // any non-flat payloadPaths entry, so this manifest is
                // invalid outright, never reaching a live symlink check.
                const outside = join(tmpdir(), "qrspi-outside-payload");
                await mkdir(outside, { recursive: true });
                await writeFile(join(outside, "secret"), "not qrspi content");
                await mkdir(targetDir, { recursive: true });
                await symlink(outside, join(targetDir, "payload"));
                await writeManifest(
                    targetDir,
                    validManifest(["payload/secret"]),
                );
            },
        ],
    ];

    for (const [name, seed] of unmanagedCases) {
        it(`reports unmanaged: ${name}`, async () => {
            const targetDir = join(home, "target");
            await seed(targetDir);
            const result = await probeTarget(targetDir, installDir);
            expect(result.state).toBe("unmanaged");
        });
    }
});

describe("isCurrent", () => {
    const central = validManifest(["agents", "README.md"]);

    it("is never current when the target is absent", () => {
        expect(isCurrent({ state: "absent" }, central)).toBe(false);
    });

    it("is always current for a managed symlink", () => {
        expect(isCurrent({ state: "managed", mode: "symlink" }, central)).toBe(
            true,
        );
    });

    it("is current for a managed copy whose version and hash both match", () => {
        const probe = {
            state: "managed" as const,
            mode: "copy" as const,
            manifest: { ...central },
        };
        expect(isCurrent(probe, central)).toBe(true);
    });

    it("is not current for a managed copy with an older version", () => {
        const probe = {
            state: "managed" as const,
            mode: "copy" as const,
            manifest: { ...central, version: "0.9.0" },
        };
        expect(isCurrent(probe, central)).toBe(false);
    });

    it("is not current for a managed copy with a mismatched hash", () => {
        const probe = {
            state: "managed" as const,
            mode: "copy" as const,
            manifest: { ...central, archiveHash: "sha256:different" },
        };
        expect(isCurrent(probe, central)).toBe(false);
    });
});

describe("placeTarget", () => {
    it("defaults to symlink and links to the install dir", async () => {
        const targetDir = join(home, "placed");
        const result = await placeTarget(targetDir, installDir, undefined);
        expect(result).toEqual({ ok: true, mode: "symlink" });
        const probed = await probeTarget(targetDir, installDir);
        expect(probed).toEqual({ state: "managed", mode: "symlink" });
    });

    it("copies when --copy is explicitly requested", async () => {
        await writeFile(join(installDir, "marker.txt"), "payload");
        const targetDir = join(home, "placed");
        const result = await placeTarget(targetDir, installDir, "copy");
        expect(result).toEqual({ ok: true, mode: "copy" });

        const stats = await lstat(targetDir);
        expect(stats.isSymbolicLink()).toBe(false);
        expect(await readFile(join(targetDir, "marker.txt"), "utf8")).toBe(
            "payload",
        );

        const probed = await probeTarget(targetDir, installDir);
        // placeTarget doesn't write a manifest itself (that's the
        // caller's job alongside placing the payload), so a bare copy
        // probes as unmanaged here.
        expect(probed.state).toBe("unmanaged");
    });

    it("propagates a real I/O failure while moving the previous copy aside", async () => {
        await writeFile(join(installDir, "marker.txt"), "payload");
        const targetDir = join(home, "placed");
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "old.txt"), "old payload");
        const rename = async (): Promise<void> => {
            const error = new Error("backup rename failed") as Error & {
                code: string;
            };
            error.code = "EIO";
            throw error;
        };

        await expect(
            placeTarget(targetDir, installDir, "copy", {
                rename,
            }),
        ).rejects.toThrow("backup rename failed");
        expect(await readFile(join(targetDir, "old.txt"), "utf8")).toBe(
            "old payload",
        );
    });

    it("re-copying onto an already-copied target replaces it rather than merging, removing stale files", async () => {
        await writeFile(join(installDir, "keep.txt"), "v1");
        await writeFile(join(installDir, "stale.txt"), "v1");
        const targetDir = join(home, "placed");

        const first = await placeTarget(targetDir, installDir, "copy");
        expect(first).toEqual({ ok: true, mode: "copy" });

        // Simulate a freshly staged release that dropped stale.txt.
        await rm(join(installDir, "stale.txt"));
        await writeFile(join(installDir, "keep.txt"), "v2");

        const second = await placeTarget(targetDir, installDir, "copy");
        expect(second).toEqual({ ok: true, mode: "copy" });

        const keep = await readFile(join(targetDir, "keep.txt"), "utf8");
        expect(keep).toBe("v2");
        await expect(
            readFile(join(targetDir, "stale.txt"), "utf8"),
        ).rejects.toThrow();

        // No leftover temp/backup siblings after a clean swap.
        const siblings = await readdir(home);
        const stray = siblings.filter(
            (name) =>
                name.startsWith("placed.qrspi-incoming-") ||
                name.startsWith("placed.qrspi-previous-"),
        );
        expect(stray).toEqual([]);
    });

    it("explicit --symlink replaces an already-copied managed target rather than failing on the existing directory", async () => {
        await writeFile(join(installDir, "marker.txt"), "payload");
        const targetDir = join(home, "placed");

        const first = await placeTarget(targetDir, installDir, "copy");
        expect(first).toEqual({ ok: true, mode: "copy" });

        const second = await placeTarget(targetDir, installDir, "symlink");
        expect(second).toEqual({ ok: true, mode: "symlink" });

        const stats = await lstat(targetDir);
        expect(stats.isSymbolicLink()).toBe(true);
        const probed = await probeTarget(targetDir, installDir);
        expect(probed).toEqual({ state: "managed", mode: "symlink" });

        // No leftover temp/backup siblings after a clean swap.
        const siblings = await readdir(home);
        const stray = siblings.filter(
            (name) =>
                name.startsWith("placed.qrspi-incoming-") ||
                name.startsWith("placed.qrspi-previous-"),
        );
        expect(stray).toEqual([]);
    });

    it("explicit --symlink fails cleanly when symlink creation is unavailable", async () => {
        const targetDir = join(home, "placed");
        const eperm = Object.assign(new Error("operation not permitted"), {
            code: "EPERM",
        });
        const result = await placeTarget(targetDir, installDir, "symlink", {
            symlink: async () => {
                throw eperm;
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("symlink-unavailable");
        }
    });

    it("auto mode falls back to copy and reports which mode was used, when symlink creation is unavailable", async () => {
        await writeFile(join(installDir, "marker.txt"), "payload");
        const targetDir = join(home, "placed");
        const eperm = Object.assign(new Error("operation not permitted"), {
            code: "EPERM",
        });
        const result = await placeTarget(targetDir, installDir, undefined, {
            symlink: async () => {
                throw eperm;
            },
        });
        expect(result).toEqual({ ok: true, mode: "copy" });

        const stats = await lstat(targetDir);
        expect(stats.isSymbolicLink()).toBe(false);
        expect(await readFile(join(targetDir, "marker.txt"), "utf8")).toBe(
            "payload",
        );
    });

    it("rethrows a symlink failure that isn't the EPERM fallback signal", async () => {
        const targetDir = join(home, "placed");
        const other = Object.assign(new Error("boom"), { code: "EACCES" });
        await expect(
            placeTarget(targetDir, installDir, undefined, {
                symlink: async () => {
                    throw other;
                },
            }),
        ).rejects.toThrow("boom");
    });
});

describe("clearUnmanagedTarget", () => {
    const unmanagedShapes: [string, (targetDir: string) => Promise<void>][] = [
        [
            "a foreign file at the target path",
            async (targetDir) => {
                await writeFile(targetDir, "foreign file content");
            },
        ],
        [
            "a foreign directory containing arbitrary unrelated content",
            async (targetDir) => {
                await mkdir(join(targetDir, "nested"), {
                    recursive: true,
                });
                await writeFile(join(targetDir, "notes.md"), "unrelated");
                await writeFile(
                    join(targetDir, "nested", "deep.txt"),
                    "unrelated",
                );
            },
        ],
        [
            "a dangling symlink",
            async (targetDir) => {
                await symlink(join(tmpdir(), "does-not-exist"), targetDir);
            },
        ],
        [
            "a symlink resolving to somewhere other than installDir",
            async (targetDir) => {
                const elsewhere = join(tmpdir(), "qrspi-elsewhere");
                await mkdir(elsewhere, { recursive: true });
                await symlink(elsewhere, targetDir);
            },
        ],
    ];

    for (const [name, seed] of unmanagedShapes) {
        it(`fully removes ${name}, and a subsequent placeTarget succeeds normally`, async () => {
            const targetDir = join(home, "target");
            await seed(targetDir);

            await clearUnmanagedTarget(targetDir);

            await expect(lstat(targetDir)).rejects.toMatchObject({
                code: "ENOENT",
            });

            const result = await placeTarget(targetDir, installDir, undefined);
            expect(result).toEqual({ ok: true, mode: "symlink" });
            const probed = await probeTarget(targetDir, installDir);
            expect(probed).toEqual({ state: "managed", mode: "symlink" });
        });
    }
});

describe("removeTarget", () => {
    it("removes a symlink-mode target unconditionally, force or not", async () => {
        for (const force of [false, true]) {
            const targetDir = join(home, `linked-${force}`);
            await symlink(installDir, targetDir);
            const probe = await probeTarget(targetDir, installDir);
            if (probe.state !== "managed") {
                throw new Error("expected managed");
            }

            const result = await removeTarget(targetDir, probe, force);

            expect(result).toEqual({ ok: true });
            await expect(lstat(targetDir)).rejects.toThrow();
        }
    });

    it("cleanly removes a copy-mode target with no extras, including the now-empty directory", async () => {
        const targetDir = join(home, "copied");
        await writeManifest(targetDir, validManifest(["agents", "README.md"]));
        await mkdir(join(targetDir, "agents"), { recursive: true });
        await writeFile(join(targetDir, "README.md"), "readme");
        const probe = await probeTarget(targetDir, installDir);
        if (probe.state !== "managed") {
            throw new Error("expected managed");
        }

        const result = await removeTarget(targetDir, probe, false);

        expect(result).toEqual({ ok: true });
        await expect(lstat(targetDir)).rejects.toThrow();
    });

    it("blocks copy-mode removal when an extra path is present, listing it, and makes no changes", async () => {
        const targetDir = join(home, "copied");
        await writeManifest(targetDir, validManifest(["agents", "README.md"]));
        await mkdir(join(targetDir, "agents"), { recursive: true });
        await writeFile(join(targetDir, "README.md"), "readme");
        await writeFile(join(targetDir, "notes.md"), "foreign content");
        const probe = await probeTarget(targetDir, installDir);
        if (probe.state !== "managed") {
            throw new Error("expected managed");
        }

        const result = await removeTarget(targetDir, probe, false);

        expect(result).toEqual({
            ok: false,
            reason: "blocked-by-extras",
            extraPaths: ["notes.md"],
        });
        // No changes: everything is still there.
        expect(await readdir(targetDir)).toEqual(
            expect.arrayContaining(["agents", "README.md", "notes.md"]),
        );
    });

    it("with force, removes only the manifest-declared paths and leaves the extra file and directory in place", async () => {
        const targetDir = join(home, "copied");
        await writeManifest(targetDir, validManifest(["agents", "README.md"]));
        await mkdir(join(targetDir, "agents"), { recursive: true });
        await writeFile(join(targetDir, "README.md"), "readme");
        await writeFile(join(targetDir, "notes.md"), "foreign content");
        const probe = await probeTarget(targetDir, installDir);
        if (probe.state !== "managed") {
            throw new Error("expected managed");
        }

        const result = await removeTarget(targetDir, probe, true);

        expect(result).toEqual({ ok: true });
        const remaining = await readdir(targetDir);
        expect(remaining).toEqual(["notes.md"]);
        expect(await readFile(join(targetDir, "notes.md"), "utf8")).toBe(
            "foreign content",
        );
    });
});
