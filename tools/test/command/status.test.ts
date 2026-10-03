import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/command/status.ts";
import { historyAt } from "../../src/workspace/History.ts";
import { loopStateAt } from "../../src/workspace/LoopState.ts";
import { workspaceAt } from "../../src/workspace/Workspace.ts";

describe("status (no loop active)", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "status-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("reports query at the very start, with no artifacts", async () => {
        await mkdir(root(), { recursive: true });

        const result = await run({ feature, project });
        expect(result.exitCode).toBe(0);
        expect(result.current).toEqual({ step: "query" });
    });

    it("reports implement with phase/planProgress, and next.label", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 2 | [~] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [x] Status marker\n\n### Step 2: B\n- [ ] Status marker\n",
        );

        const result = await run({ feature, project });
        expect(result.exitCode).toBe(0);
        expect(result.current).toMatchObject({
            step: "implement",
            phase: "1",
            planProgress: "1/2 steps",
        });
        expect(result.next).toEqual({ label: "phase-1" });
    });

    it("counts phase steps when a blank line separates headings from markers", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 5 | [~] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            `### Step 1: A

- [ ] Status marker

### Step 2: B

- [ ] Status marker

### Step 3: C

- [ ] Status marker

### Step 4: D

- [ ] Status marker

### Step 5: E

- [ ] Status marker
`,
        );

        const result = await run({ feature, project });

        expect(result.current).toMatchObject({
            step: "implement",
            phase: "1",
            planProgress: "0/5 steps",
        });
    });

    it("surfaces stale-input as a warning finding without blocking", async () => {
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
            "### Step 1: A\n- [ ] Status marker\n",
        );
        await writeFile(join(root(), "spec.md"), "...");

        const { utimes } = await import("node:fs/promises");
        const old = new Date("2020-01-01");
        const recent = new Date("2024-01-01");
        await utimes(join(root(), "plans/plan-phase-1.md"), old, old);
        await utimes(join(root(), "spec.md"), recent, recent);

        const result = await run({ feature, project });
        expect(result.exitCode).toBe(3);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "stale-input" }),
        ]);
        expect(result.current).toMatchObject({ phase: "1" });
    });

    it("reports done once every phase row is [x]", async () => {
        await mkdir(root(), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
`,
        );

        const result = await run({ feature, project });
        expect(result.current).toEqual({ step: "done" });
    });

    it("reports parked ahead of any artifact-derived step, and omits phase facts", async () => {
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
            "### Step 1: A\n- [ ] Status marker\n",
        );
        await historyAt(root()).append({
            kind: "park",
            text: "blocked on infra",
        });

        const result = await run({ feature, project });
        expect(result.current).toEqual({
            step: "parked",
        });
        expect(result.next).toBeUndefined();
    });

    it("reports all-phases-blocked and omits phase facts when every incomplete row is blocked on a dependency", async () => {
        await mkdir(join(root(), "plans"), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | 2 | . | 1 | [ ] |
| 2 | Second | 1 | . | 1 | [ ] |
`,
        );
        await writeFile(
            join(root(), "plans/plan-phase-1.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );
        await writeFile(
            join(root(), "plans/plan-phase-2.md"),
            "### Step 1: A\n- [ ] Status marker\n",
        );

        const result = await run({ feature, project });
        expect(result.exitCode).toBe(3);
        expect(result.current).toEqual({ step: "implement" });
        expect(result.next).toBeUndefined();
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "all-phases-blocked" }),
        ]);
    });
});

describe("status (loop active)", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "status-loop-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("reports loop.* and next.action instead of next.label", async () => {
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

        const result = await run({ feature, project });
        expect(result.exitCode).toBe(0);
        expect(result.next).toEqual({ action: "implement" });
        expect(result.loop).toMatchObject({
            scope: ["1"],
            phaseIds: ["1"],
            cycle: 0,
            phaseId: "1",
            conditions: [],
            stoppedReason: undefined,
            checkpoint: undefined,
        });
    });

    it("surfaces next.label/next.diff for a review action, inside loop.next", async () => {
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
        await loop.writeInFlight("implement", "1", { baseSha: "abc123" });

        const result = await run({ feature, project });
        expect(result.exitCode).toBe(0);
        expect(result.next).toEqual({
            action: "review",
            label: "phase-1",
            diff: "git diff abc123..HEAD",
        });
        expect(result.loop).not.toHaveProperty("label");
        expect(result.loop).not.toHaveProperty("diff");
    });
});
