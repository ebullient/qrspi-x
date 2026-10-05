import {
    rename as fsRename,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stagingAt } from "../../src/plugin/Staging.ts";
import { buildZip, fakeExecFile } from "../fixtures.ts";

const repoSlug = "ebullient/qrspi-x";

function validZip(): Buffer {
    return buildZip([
        {
            path: "qrspi-manifest.json",
            content: JSON.stringify({ version: "1.0.0" }),
        },
        { path: "agents/foo.md", content: "agent content" },
        { path: "skills/bar.md", content: "skill content" },
        { path: "README.md", content: "readme content" },
    ]);
}

function execFileWritingArchive(archive: Buffer) {
    return fakeExecFile({
        "release download": async (args) => {
            const outputIndex = args.indexOf("--output");
            const destPath = args[outputIndex + 1];
            await writeFile(destPath, archive);
            return { stdout: "", stderr: "" };
        },
    });
}

async function seedPreviousInstall(targetDir: string): Promise<void> {
    await mkdir(join(targetDir, "agents"), { recursive: true });
    await writeFile(join(targetDir, "agents", "old.md"), "old content");
    await writeFile(
        join(targetDir, "qrspi-manifest.json"),
        JSON.stringify({
            version: "0.1.0",
            payloadPaths: ["agents"],
            releaseTag: "0.1.0",
            downloadedAt: "2026-01-01T00:00:00.000Z",
            archiveHash: "sha256:previous",
        }),
    );
}

async function snapshot(dir: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    async function walk(current: string, prefix: string): Promise<void> {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(join(current, entry.name), relPath);
            } else {
                files[relPath] = await readFile(
                    join(current, entry.name),
                    "utf8",
                );
            }
        }
    }
    await walk(dir, "");
    return files;
}

describe("stagingAt", () => {
    let workspace: string;
    let targetDir: string;

    beforeEach(async () => {
        workspace = await mkdtemp(join(tmpdir(), "staging-test-"));
        targetDir = join(workspace, "plugin");
    });

    afterEach(async () => {
        await rm(workspace, { recursive: true, force: true });
    });

    it("downloads, extracts, stamps, and commits on the happy path", async () => {
        const execFile = execFileWritingArchive(validZip());
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
        });

        const downloadResult = await staging.download("1.0.0");
        expect(downloadResult.ok).toBe(true);
        if (!downloadResult.ok) return;

        const result = await staging.extractAndCommit(
            downloadResult.archivePath,
            "1.0.0",
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.manifest).toMatchObject({
            version: "1.0.0",
            releaseTag: "1.0.0",
            downloadedAt: expect.any(String),
            archiveHash: expect.any(String),
            payloadPaths: ["README.md", "agents", "skills"],
        });

        const installed = await snapshot(targetDir);
        expect(installed["agents/foo.md"]).toBe("agent content");
        expect(installed["skills/bar.md"]).toBe("skill content");
        expect(installed["README.md"]).toBe("readme content");
        const manifestOnDisk = JSON.parse(installed["qrspi-manifest.json"]);
        expect(manifestOnDisk).toEqual(result.manifest);
    });

    it("leaves a previous install untouched when the download fails", async () => {
        await seedPreviousInstall(targetDir);
        const before = await snapshot(targetDir);

        const execFile = fakeExecFile();
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
        });

        const result = await staging.download("1.0.0");

        expect(result).toMatchObject({
            ok: false,
            reason: "download-failed",
            message: expect.any(String),
        });
        expect(await snapshot(targetDir)).toEqual(before);
    });

    it("leaves a previous install untouched when the caller aborts after download (e.g. attestation failure) and calls cleanup", async () => {
        await seedPreviousInstall(targetDir);
        const before = await snapshot(targetDir);

        const execFile = execFileWritingArchive(validZip());
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
        });

        const downloadResult = await staging.download("1.0.0");
        expect(downloadResult.ok).toBe(true);
        if (!downloadResult.ok) return;

        await downloadResult.cleanup();

        expect(await snapshot(targetDir)).toEqual(before);
    });

    it("leaves a previous install untouched when extraction fails", async () => {
        await seedPreviousInstall(targetDir);
        const before = await snapshot(targetDir);

        const notAZip = Buffer.from("this is not a zip file");
        const execFile = execFileWritingArchive(notAZip);
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
        });

        const downloadResult = await staging.download("1.0.0");
        expect(downloadResult.ok).toBe(true);
        if (!downloadResult.ok) return;

        const result = await staging.extractAndCommit(
            downloadResult.archivePath,
            "1.0.0",
        );

        expect(result).toMatchObject({
            ok: false,
            reason: "extraction-failed",
            message: expect.any(String),
        });
        expect(await snapshot(targetDir)).toEqual(before);
    });

    it("leaves a previous install untouched when the manifest fails validation after stamping", async () => {
        await seedPreviousInstall(targetDir);
        const before = await snapshot(targetDir);

        const badZip = buildZip([
            { path: "qrspi-manifest.json", content: JSON.stringify({}) },
            { path: "README.md", content: "readme content" },
        ]);
        const execFile = execFileWritingArchive(badZip);
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
        });

        const downloadResult = await staging.download("1.0.0");
        expect(downloadResult.ok).toBe(true);
        if (!downloadResult.ok) return;

        const result = await staging.extractAndCommit(
            downloadResult.archivePath,
            "1.0.0",
        );

        expect(result).toMatchObject({
            ok: false,
            reason: "invalid-manifest",
            message: expect.any(String),
        });
        expect(await snapshot(targetDir)).toEqual(before);
    });

    it("restores the previous install when the final commit rename fails", async () => {
        await seedPreviousInstall(targetDir);
        const before = await snapshot(targetDir);
        let renames = 0;
        const rename = async (
            ...paths: Parameters<typeof fsRename>
        ): Promise<void> => {
            renames += 1;
            if (renames === 3) {
                const error = new Error("final rename failed") as Error & {
                    code: string;
                };
                error.code = "EIO";
                throw error;
            }
            await fsRename(...paths);
        };
        const execFile = execFileWritingArchive(validZip());
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
            rename,
        });
        const downloadResult = await staging.download("1.0.0");
        expect(downloadResult.ok).toBe(true);
        if (!downloadResult.ok) return;

        await expect(
            staging.extractAndCommit(downloadResult.archivePath, "1.0.0"),
        ).rejects.toThrow("final rename failed");
        expect(await snapshot(targetDir)).toEqual(before);
    });

    it("does not treat a backup rename I/O failure as an absent target", async () => {
        await seedPreviousInstall(targetDir);
        let renames = 0;
        const rename = async (
            ...paths: Parameters<typeof fsRename>
        ): Promise<void> => {
            renames += 1;
            if (renames === 2) {
                const error = new Error("backup rename failed") as Error & {
                    code: string;
                };
                error.code = "EIO";
                throw error;
            }
            await fsRename(...paths);
        };
        const execFile = execFileWritingArchive(validZip());
        const staging = stagingAt(targetDir, repoSlug, workspace, {
            execFile,
            rename,
        });
        const downloadResult = await staging.download("1.0.0");
        expect(downloadResult.ok).toBe(true);
        if (!downloadResult.ok) return;

        await expect(
            staging.extractAndCommit(downloadResult.archivePath, "1.0.0"),
        ).rejects.toThrow("backup rename failed");
    });
});
