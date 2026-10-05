import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    abandon,
    advance,
    loopOk,
    start,
    stop,
} from "../../src/command/loop.ts";
import { loopStateAt } from "../../src/workspace/LoopState.ts";
import { workspaceAt } from "../../src/workspace/Workspace.ts";
import { fakeHistory } from "../fixtures.ts";

describe("loop start", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "loop-start-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("resolves scope and returns phaseIds on success", async () => {
        await mkdir(root(), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
| 2 | Second | 1 | . | 1 | [ ] |
`,
        );

        const result = await start({ feature, project, selector: "all" });
        expect(result).toEqual({ exitCode: 0, phaseIds: ["1", "2"] });

        const loop = loopStateAt(root(), workspaceAt(root()));
        expect((await loop.read())?.phaseIds).toEqual(["1", "2"]);
    });

    it("refuses with loop-refused and writes nothing when a loop is already running", async () => {
        await mkdir(root(), { recursive: true });
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

        const result = await start({ feature, project, selector: "all" });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "loop-refused" }),
        ]);
    });

    it("refuses with loop-refused on an unknown phase id in the selector", async () => {
        await mkdir(root(), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [ ] |
`,
        );

        const result = await start({ feature, project, selector: "99" });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toEqual([
            expect.objectContaining({ code: "loop-refused" }),
        ]);
    });
});

describe("loop advance", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "loop-advance-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("moves scope to the next phase once the current one is [x]", async () => {
        await mkdir(root(), { recursive: true });
        await writeFile(
            join(root(), "plan.md"),
            `
| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | First | none | . | 1 | [x] |
| 2 | Second | 1 | . | 1 | [ ] |
`,
        );
        const loop = loopStateAt(root(), workspaceAt(root()));
        await loop.start("all");

        const result = await advance({ feature, project });
        expect(result).toEqual({ exitCode: 0 });
        expect((await loop.read())?.phaseId).toBe("2");
    });

    it("is a silent no-op when there's no loop running", async () => {
        await mkdir(root(), { recursive: true });
        const result = await advance({ feature, project });
        expect(result).toEqual({ exitCode: 0 });
    });
});

describe("loop stop", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "loop-stop-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("records stoppedReason in loop-state.json and a loop/stop entry in history", async () => {
        await mkdir(root(), { recursive: true });
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
        const history = fakeHistory();

        const result = await stop(
            { feature, project, reason: "dirty-tree after repair" },
            { history },
        );
        expect(result).toEqual({ exitCode: 0 });

        expect((await loop.read())?.stoppedReason).toBe(
            "dirty-tree after repair",
        );
        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "loop", action: "stop" },
            { text: "dirty-tree after repair" },
            { kind: "loop", action: "stop", text: "dirty-tree after repair" },
        );
    });
});

describe("loop ok", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "loop-ok-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("clears stoppedReason, writes a reason to history when given, and returns the next action", async () => {
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
        const loop = loopStateAt(root(), workspaceAt(root()));
        await loop.start("all");
        await loop.stop("crashed");
        const history = fakeHistory();

        const result = await loopOk(
            { feature, project, reason: "retried with --base" },
            { history },
        );
        expect(result).toEqual({ exitCode: 0, action: "implement" });

        expect((await loop.read())?.stoppedReason).toBeUndefined();
        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "loop", action: "ok" },
            { text: "retried with --base" },
            { kind: "loop", action: "ok", text: "retried with --base" },
        );
    });

    it("writes nothing to history when no reason is given", async () => {
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
        const loop = loopStateAt(root(), workspaceAt(root()));
        await loop.start("all");
        await loop.stop("crashed");
        const history = fakeHistory();

        const result = await loopOk({ feature, project }, { history });
        expect(result).toEqual({ exitCode: 0, action: "implement" });
        expect(history.conditionalAppend).not.toHaveBeenCalled();
    });
});

describe("loop abandon", () => {
    let project: string;
    const feature = "widget";

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), "loop-abandon-test-"));
    });

    afterEach(async () => {
        await rm(project, { recursive: true, force: true });
    });

    function root(): string {
        return join(project, ".qrspi", feature);
    }

    it("removes loop-state.json and writes a loop/abandon entry to history", async () => {
        await mkdir(root(), { recursive: true });
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
        const history = fakeHistory();

        const result = await abandon(
            { feature, project, reason: "scope too large" },
            { history },
        );
        expect(result).toEqual({ exitCode: 0 });

        expect(await loop.read()).toBeUndefined();
        expect(history.conditionalAppend).toHaveBeenCalledWith(
            { kind: "loop", action: "abandon" },
            { text: "scope too large" },
            { kind: "loop", action: "abandon", text: "scope too large" },
        );
    });
});
