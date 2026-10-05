import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/command/next-file.ts";

describe("next-file", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "next-file-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("returns the first backup path when backups/ doesn't exist yet", async () => {
        const path = await run("spec", { feature, project });
        expect(path).toBe("backups/spec-1.md");
    });

    it("skips used backup numbers", async () => {
        await mkdir(join(root(), "backups"), { recursive: true });
        await writeFile(join(root(), "backups/spec-1.md"), "");

        const path = await run("spec", { feature, project });
        expect(path).toBe("backups/spec-2.md");
    });

    it("returns the bare phase review path when unused, else -r<n>", async () => {
        const first = await run("review", { feature, project, phase: "1" });
        expect(first).toBe("reviews/phase-1.md");

        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(join(root(), "reviews/phase-1.md"), "");

        const second = await run("review", { feature, project, phase: "1" });
        expect(second).toBe("reviews/phase-1-r1.md");
    });

    it("uses the step-level sequence when --step is given", async () => {
        const path = await run("review", {
            feature,
            project,
            phase: "1",
            step: 2,
        });
        expect(path).toBe("reviews/phase-1-step-2.md");
    });

    it("throws when review is requested without --phase", async () => {
        await expect(run("review", { feature, project })).rejects.toThrow(
            "--phase",
        );
    });

    it("throws on an unknown type", async () => {
        await expect(run("bogus", { feature, project })).rejects.toThrow(
            'Unknown next-file type "bogus"',
        );
    });
});
