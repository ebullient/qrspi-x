import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { implement, repair, review } from "../../src/command/start.ts";
import { loopStateAt } from "../../src/workspace/LoopState.ts";
import { workspaceAt } from "../../src/workspace/Workspace.ts";
import { fakeGit, fakeHistory } from "../fixtures.ts";

describe("start implement", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "start-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("blocks with dirty-tree when the working tree isn't clean", async () => {
        await mkdir(root(), { recursive: true });
        const result = await implement(
            { feature, project, phase: "1" },
            { git: fakeGit({ clean: false }) },
        );
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "dirty-tree" }),
        ]);
    });

    it("blocks with incomplete-dependency when the phase isn't satisfied", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
| 2 | Second | 1 | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-2.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const result = await implement(
            { feature, project, phase: "2" },
            { git: fakeGit() },
        );
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "incomplete-dependency" }),
        ]);
    });

    it("returns phaseId on success without --loop, writing nothing", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const result = await implement(
            { feature, project, phase: "1" },
            { git: fakeGit() },
        );
        expect(result).toEqual({ exitCode: 0, phaseId: "1" });

        const loop = loopStateAt(root(), workspaceAt(root()));
        expect(await loop.read()).toBeUndefined();
    });

    it("writes inFlight with the base SHA under --loop", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");

        const result = await implement(
            { feature, project, phase: "1", loop: true },
            { git: fakeGit({ sha: "sha-1" }) },
        );
        expect(result).toEqual({ exitCode: 0, phaseId: "1" });

        const state = await loop.read();
        expect(state?.inFlight).toEqual({ task: "implement", phaseId: "1" });
        expect(state?.bases["1"]).toBe("sha-1");
    });

    it('writes an action:"begin" entry for this phase via conditionalAppend', async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );
        const history = fakeHistory();

        const result = await implement(
            { feature, project, phase: "1" },
            { git: fakeGit(), history },
        );
        expect(result).toEqual({ exitCode: 0, phaseId: "1" });

        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "implement", phase: "1" },
            { action: "begin" },
            expect.objectContaining({
                kind: "implement",
                action: "begin",
                phase: "1",
            }),
        );
    });

    it("does not warn when the recorded base is still an ancestor of HEAD (ordinary forward progress)", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");
        await loop.writeInFlight("implement", "1", { baseSha: "sha-1" });
        await loop.clearInFlight();

        // sha-1 is still reachable from HEAD (sha-2) — just normal
        // progress, not a rewrite, so no finding and the base is untouched
        const result = await implement(
            { feature, project, phase: "1", loop: true },
            { git: fakeGit({ sha: "sha-2", ancestors: ["sha-1"] }) },
        );
        expect(result).toEqual({ exitCode: 0, phaseId: "1" });

        const state = await loop.read();
        expect(state?.bases["1"]).toBe("sha-1");
    });

    it("warns with base-not-ancestor when the recorded base is no longer reachable", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");
        await loop.writeInFlight("implement", "1", { baseSha: "sha-1" });
        await loop.clearInFlight();

        // sha-1 is not reachable from HEAD (sha-2) — history was rewritten
        const result = await implement(
            { feature, project, phase: "1", loop: true },
            { git: fakeGit({ sha: "sha-2", ancestors: [] }) },
        );
        expect(result.exitCode).toBe(3);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "base-not-ancestor" }),
        ]);
        expect(result.phaseId).toBe("1");

        // the stale base is left on record — never auto-corrected
        const state = await loop.read();
        expect(state?.bases["1"]).toBe("sha-1");

        // the explicit --base retry is what clears it
        const retried = await implement(
            { feature, project, phase: "1", loop: true, base: "sha-2" },
            { git: fakeGit({ sha: "sha-2", ancestors: [] }) },
        );
        expect(retried).toEqual({ exitCode: 0, phaseId: "1" });
        expect((await loop.read())?.bases["1"]).toBe("sha-2");
    });

    it("warns with phase-base-reset when steps are begun but no base is recorded", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [~] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");

        const result = await implement(
            { feature, project, phase: "1", loop: true },
            { git: fakeGit({ sha: "sha-1" }) },
        );
        expect(result.exitCode).toBe(3);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "phase-base-reset" }),
        ]);

        const state = await loop.read();
        expect(state?.bases["1"]).toBe("sha-1");
    });
});

describe("start review", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "start-review-test-"));
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("returns the next review label without --loop", async () => {
        const result = await review(
            { feature, project, phase: "1" },
            { git: fakeGit() },
        );
        expect(result).toEqual({ exitCode: 0, label: "phase-1" });
    });

    it("blocks review until the phase file is complete", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const result = await review(
            { feature, project, phase: "1" },
            { git: fakeGit() },
        );

        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "phase-not-complete" }),
        ]);
    });

    it("reuses the latest pending review without allocating a new label", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: PENDING\n",
        );

        const result = await review(
            { feature, project, phase: "1" },
            { git: fakeGit() },
        );

        expect(result).toEqual({ exitCode: 0, label: "phase-1" });
    });

    it('writes an action:"begin" entry for this label via conditionalAppend', async () => {
        const history = fakeHistory();

        const result = await review(
            { feature, project, phase: "1" },
            { git: fakeGit(), history },
        );
        expect(result).toEqual({ exitCode: 0, label: "phase-1" });

        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "review", label: "phase-1" },
            { action: "begin" },
            expect.objectContaining({
                kind: "review",
                action: "begin",
                label: "phase-1",
                phase: "1",
            }),
        );
    });

    it("writes inFlight and returns label+diff under --loop", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");

        const result = await review(
            { feature, project, phase: "1", loop: true, base: "sha-1" },
            { git: fakeGit({ sha: "sha-1" }) },
        );
        expect(result).toEqual({
            exitCode: 0,
            label: "phase-1",
            diff: "git diff sha-1..HEAD",
        });

        const state = await loop.read();
        expect(state?.inFlight).toEqual({
            task: "review",
            phaseId: "1",
            label: "phase-1",
        });
    });

    it("reuses an in-flight review label when retrying after a pending stub exists", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: PENDING\n",
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");
        await loop.writeInFlight("review", "1", {
            label: "phase-1",
            baseSha: "sha-1",
        });

        const result = await review(
            { feature, project, phase: "1", loop: true },
            { git: fakeGit({ sha: "sha-1" }) },
        );

        expect(result).toEqual({
            exitCode: 0,
            label: "phase-1",
            diff: "git diff sha-1..HEAD",
        });
    });
});

describe("start repair", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "start-repair-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("blocks with no-fail-review when no review exists yet", async () => {
        const result = await repair({ feature, project, phase: "1" });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "no-fail-review" }),
        ]);
    });

    it("blocks with no-fail-review when the last review isn't a FAIL", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: PASS\n",
        );

        const result = await repair({ feature, project, phase: "1" });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "no-fail-review" }),
        ]);
    });

    it("returns the FAIL review's path without --loop", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: FAIL\n",
        );

        const result = await repair({ feature, project, phase: "1" });
        expect(result).toEqual({ exitCode: 0, review: "reviews/phase-1.md" });
    });

    it('writes an action:"begin" entry via conditionalAppend once there\'s a FAIL to repair', async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: FAIL\n",
        );
        const history = fakeHistory();

        await repair({ feature, project, phase: "1" }, { history });

        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "repair", phase: "1" },
            { action: "begin" },
            expect.objectContaining({
                kind: "repair",
                action: "begin",
                phase: "1",
            }),
        );
    });

    it("consumes the one --loop repair attempt, then refuses a second", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: FAIL\n",
        );
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");

        const first = await repair({
            feature,
            project,
            phase: "1",
            loop: true,
        });
        expect(first).toEqual({ exitCode: 0, review: "reviews/phase-1.md" });

        // log review would normally cache this; set it directly since
        // log.ts doesn't exist yet
        await loop.updateCheckpoint("1", "phase-1", "FAIL");

        // the re-review's existence (PENDING or real) is what LoopState's
        // repairSpent() check looks for
        await writeFile(
            join(root(), "reviews/phase-1-r1.md"),
            "## Verdict: PENDING\n",
        );

        const second = await repair({
            feature,
            project,
            phase: "1",
            loop: true,
        });
        expect(second.exitCode).toBe(1);
        expect(second.findings).toEqual([
            expect.objectContaining({ code: "repair-already-spent" }),
        ]);
    });

    it("does not write repair history when the --loop attempt is already spent", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: FAIL\n",
        );
        await writeFile(join(root(), "reviews/phase-1-r1.md"), "...\n");
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );

        const loop = loopStateAt(root(), workspaceAt(root()));
        await loop.start("all");

        const result = await repair({
            feature,
            project,
            phase: "1",
            loop: true,
        });
        expect(result.exitCode).toBe(1);
        expect(
            await workspaceAt(root()).lastFile("review", { phase: "1" }),
        ).toBe("reviews/phase-1-r1.md");
        await expect(
            readFile(join(root(), "history.jsonl"), "utf8"),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });
});
