import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { implement, park, repair, review } from "../../src/command/log.ts";
import { implement as startImplement } from "../../src/command/start.ts";
import { decisionsAt } from "../../src/workspace/Decisions.ts";
import { historyAt } from "../../src/workspace/History.ts";
import { loopStateAt } from "../../src/workspace/LoopState.ts";
import { workspaceAt } from "../../src/workspace/Workspace.ts";
import { fakeGit, fakeHistory } from "../fixtures.ts";

describe("log implement", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "log-implement-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    const planFixture = `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`;

    it("blocks with phase-not-complete when steps aren't all [x]", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(join(root(), "plan.md"), planFixture);
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
        );

        const result = await implement({ feature, project, phase: "1" });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "phase-not-complete" }),
        ]);
    });

    it("logs completed steps without re-reading the dependency graph", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 2 | Second | missing | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-2.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );

        const result = await implement({
            feature,
            project,
            phase: "2",
        });

        expect(result).toEqual({ exitCode: 0 });
    });

    it('writes an action:"end" entry via conditionalAppend, even with no --reason', async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(join(root(), "plan.md"), planFixture);
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        const history = fakeHistory();

        const result = await implement(
            { feature, project, phase: "1" },
            { history },
        );
        expect(result).toEqual({ exitCode: 0 });

        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "implement", phase: "1" },
            { action: "end" },
            { kind: "implement", action: "end", phase: "1" },
        );
    });

    it("adds a text field when --reason is given", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(join(root(), "plan.md"), planFixture);
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );
        const history = fakeHistory();

        const result = await implement(
            {
                feature,
                project,
                phase: "1",
                reason: "resuming after a merge conflict",
            },
            { history },
        );
        expect(result).toEqual({ exitCode: 0 });

        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "implement", phase: "1" },
            { action: "end" },
            {
                kind: "implement",
                action: "end",
                phase: "1",
                text: "resuming after a merge conflict",
            },
        );
    });

    it("clears inFlight when a loop is running", async () => {
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
        await loop.writeInFlight("implement", "1", { baseSha: "sha-1" });

        await implement({ feature, project, phase: "1" });

        const state = await loop.read();
        expect(state?.inFlight).toBeUndefined();
    });
});

describe("log repair", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "log-repair-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("is a documented alias: same validation, recorded under kind 'repair'", async () => {
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

        const result = await repair({
            feature,
            project,
            phase: "1",
            reason: "fixed the FAIL findings",
        });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: "repair", phase: "1" });
    });
});

describe("log review", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "log-review-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("blocks with no-verdict when the artifact has no Verdict line yet", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: PENDING\n",
        );

        const result = await review({ feature, project, label: "phase-1" });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "no-verdict" }),
        ]);
    });

    it("records a FAIL on a first review with outcome 'repair'", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: FAIL\n\nMissing tests.\n",
        );

        const result = await review({ feature, project, label: "phase-1" });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            kind: "review",
            label: "phase-1",
            phase: "1",
            verdict: "FAIL",
            outcome: "repair",
        });
    });

    it("records a FAIL on a re-review (-r<n>) with outcome 'stop'", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1-r1.md"),
            "## Verdict: FAIL\n\nStill broken.\n",
        );

        const result = await review({
            feature,
            project,
            label: "phase-1-r1",
        });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries[0]).toMatchObject({
            verdict: "FAIL",
            outcome: "stop",
        });
    });

    it("records PASS WITH CONDITIONS with the verdict summary as the condition note", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: PASS WITH CONDITIONS\n\nAdd a test for the timeout edge case.\n",
        );

        const result = await review({ feature, project, label: "phase-1" });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries[0]).toMatchObject({
            verdict: "PASS WITH CONDITIONS",
            outcome: "advance",
            conditions: ["Add a test for the timeout edge case."],
        });
    });

    it("records outcome 'final' for a label with no phase", async () => {
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/final.md"),
            "## Verdict: PASS\n\nShips it.\n",
        );

        const result = await review({ feature, project, label: "final" });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries[0]).toMatchObject({ verdict: "PASS", outcome: "final" });
        expect(entries[0].phase).toBeUndefined();
    });

    it("updates loop-state.json's checkpoint/conditions and clears inFlight when a loop is running", async () => {
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
        await mkdir(join(root(), "reviews"), { recursive: true });
        await writeFile(
            join(root(), "reviews/phase-1.md"),
            "## Verdict: PASS WITH CONDITIONS\n\nAdd a test for the timeout edge case.\n",
        );

        const ws = workspaceAt(root());
        const loop = loopStateAt(root(), ws);
        await loop.start("all");
        await loop.writeInFlight("review", "1", {
            label: "phase-1",
            baseSha: "sha-1",
        });

        await review({ feature, project, label: "phase-1" });

        const state = await loop.read();
        expect(state?.checkpoint).toEqual({
            phaseId: "1",
            label: "phase-1",
            verdict: "PASS WITH CONDITIONS",
        });
        expect(state?.conditions).toEqual([{ phaseId: "1", label: "phase-1" }]);
        expect(state?.inFlight).toBeUndefined();
    });
});

describe("start + log implement, end to end", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "start-log-implement-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("pairs one begin with one end for a single phase completion", async () => {
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

        await startImplement(
            { feature, project, phase: "1" },
            { git: fakeGit() },
        );

        // steps actually get done between start and log, in real usage
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n",
        );

        await implement({ feature, project, phase: "1" });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries).toEqual([
            {
                kind: "implement",
                action: "begin",
                phase: "1",
                timestamp: expect.any(String),
            },
            {
                kind: "implement",
                action: "end",
                phase: "1",
                timestamp: expect.any(String),
            },
        ]);
    });
});

describe("log park", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "log-park-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("appends a park entry with no --reason", async () => {
        const result = await park({ feature, project });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries).toEqual([
            { kind: "park", timestamp: expect.any(String) },
        ]);
        expect(await decisionsAt(root()).read()).toBe("");
    });

    it("appends to both history.jsonl and decisions.md when --reason is given", async () => {
        const result = await park({
            feature,
            project,
            reason: "waiting on design review",
        });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries[0]).toMatchObject({
            kind: "park",
            text: "waiting on design review",
        });
        expect(await decisionsAt(root()).read()).toBe(
            "- waiting on design review\n",
        );
    });

    it("is a no-op when already parked", async () => {
        await park({ feature, project, reason: "first reason" });
        const result = await park({
            feature,
            project,
            reason: "second reason",
        });
        expect(result).toEqual({ exitCode: 0 });

        const entries = await historyAt(root()).read({ all: true });
        expect(entries).toHaveLength(1);
        expect(await decisionsAt(root()).read()).toBe("- first reason\n");
    });
});
