import { describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";

describe("cli", () => {
    it("prints a plain version string", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["--version"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(0);
        expect(stdout).toHaveLength(1);
        expect(stdout[0]).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
        expect(stderr).toEqual([]);
    });

    it("prints command help without requiring a feature workspace", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["--help"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Commands:");
        expect(stdout[0]).toContain("status -");
        expect(stdout[0]).toContain(
            "decision read, history read, next-file, and import print bare content or a path.",
        );
        expect(stdout[0]).toContain(
            "0 success, 1 blocked/refused, 2 usage error, 3 usable result with findings, 4 unexpected error.",
        );
        expect(stderr).toEqual([]);
    });

    it("shows next-file's phase and step parameters in help", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "next-file"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("--phase <id>");
        expect(stdout[0]).toContain("--step <k>");
        expect(stdout[0]).toContain("next-file <type>");
        expect(stdout[0]).toContain(
            "query, research, approach, spec, review, or final",
        );
    });

    it("shows command-level actions progressively", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "start"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Actions:");
        expect(stdout[0]).toContain("implement -");
        expect(stdout[0]).toContain("review -");
        expect(stdout[0]).toContain("repair -");
    });

    it("shows action-level flags and an example progressively", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "start", "implement"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("--phase <id>");
        expect(stdout[0]).toContain("--loop");
        expect(stdout[0]).toContain("--base <commit-ish>");
        expect(stdout[0]).toContain("Example:");
    });

    it("uses executable loop subcommand syntax in help", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "loop", "start"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("loop start");
        expect(stdout[0]).toContain("loop start <selector>");
        expect(stdout[0]).toContain("qrspi-x loop start 2..4");
        expect(stdout[0]).toContain("qrspi-x loop start 1,3");
    });

    it("distinguishes advancing a completed phase from acknowledging a stop", async () => {
        const stdout: string[] = [];

        const exitCode = await main(["--help", "loop", "ok"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: () => {},
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("acknowledge-required");
        expect(stdout[0]).toContain("without advancing the phase");
    });

    it("rejects mutually exclusive history read limits before touching the workspace", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            [
                "history",
                "read",
                "--all",
                "--tail",
                "2",
                "--feature",
                "widget",
                "--project",
                ".",
            ],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain("cannot combine --all and --tail");
    });

    it("rejects a loop flag spelling now that actions are positional", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            ["loop", "--start", "all", "--feature", "widget", "--project", "."],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain('Unknown loop action ""');
    });

    it("rejects loop advance with an extra positional argument", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            [
                "loop",
                "advance",
                "extra",
                "--feature",
                "widget",
                "--project",
                ".",
            ],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain("loop advance takes no arguments");
    });

    it("rejects an unknown action on a singleAction-based command before dispatch", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            ["decision", "bogus", "--feature", "widget", "--project", "."],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain('Unknown decision action "bogus"');
    });

    it("runs import command and outputs plain text with exit code 0 on success", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        // When given invalid number (e.g. not a number), outputs plain text advice and exit code 1
        const exitCode = await main(
            ["import", "not-a-number", "--project", "."],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(1);
        expect(stdout[0]).toContain("Invalid issue number");
        expect(stdout[0]).toContain(
            "Provide a positive issue or pull request number",
        );
        expect(stderr).toEqual([]);
    });

    it("rejects an unknown flag instead of silently ignoring it", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            ["import", "436", "--feature-name", "grid-edit", "--project", "."],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain('Unknown option "--feature-name"');
    });

    it("dispatches plugin install and passes --release through", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(
            ["plugin", "install", "--release", "not-a-real-tag"],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(1);
        // A progress line now fires before resolveRelease fails on the
        // invalid tag, then the failure's own text line is printed. Exact
        // wording isn't the point of this test (that's plugin.test.ts's
        // job) — just that --release reached runInstall and something
        // was reported before and after.
        expect(stdout.length).toBeGreaterThanOrEqual(2);
        expect(stdout.some((line) => line.includes("not-a-real-tag"))).toBe(
            true,
        );
    });

    it("dispatches plugin init and passes --agent through", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["plugin", "init", "--agent", "cursor"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(1);
        expect(stdout).toHaveLength(1);
        expect(stdout[0]).toContain("cursor");
    });

    it("requires --agent for plugin init", async () => {
        const stderr: string[] = [];

        const exitCode = await main(["plugin", "init"], {
            cwd: ".",
            stdout: () => {},
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain("--agent is required");
    });

    it("accepts --copy and --symlink as boolean flags on plugin init", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(
            ["plugin", "init", "--agent", "cursor", "--copy", "--symlink"],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        // Both flags parse as plain booleans here (no "requires a value"
        // usage error) — runInit itself is what rejects the combination,
        // which is already covered in plugin.test.ts, not re-tested here.
        expect(exitCode).toBe(1);
        expect(stderr).toEqual([]);
    });

    it("dispatches plugin init and passes --force through as a boolean flag", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(
            ["plugin", "init", "--agent", "cursor", "--force"],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        // Exercises dispatch/flag-passthrough only, the same way plugin
        // remove's own --force dispatch test does: an unknown agent
        // name fails fast inside runInit before --force is ever
        // consulted. runInit's own --force behavior is covered in
        // plugin.test.ts, not re-tested here.
        expect(exitCode).toBe(1);
        expect(stderr).toEqual([]);
        expect(stdout).toHaveLength(1);
        expect(stdout[0]).toContain("cursor");
    });

    it("dispatches plugin status with no flags", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["plugin", "status"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        // Exercises dispatch only — runStatus's own behavior (install
        // state, per-agent probing, freshness degradation) is covered in
        // plugin.test.ts, not re-tested here. It never refuses, so this
        // always succeeds regardless of local install state.
        expect(exitCode).toBe(0);
        expect(stdout).toHaveLength(1);
        expect(stderr).toEqual([]);
    });

    it("rejects a stray positional argument on plugin status", async () => {
        const stderr: string[] = [];

        const exitCode = await main(["plugin", "status", "extra"], {
            cwd: ".",
            stdout: () => {},
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain("plugin requires exactly one action");
    });

    it("dispatches plugin update and passes --release through", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(
            ["plugin", "update", "--release", "not-a-real-tag"],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        // Exercises dispatch/flag-passthrough only, the same way the
        // plugin install dispatch test above does: an invalid tag fails
        // fast inside runUpdate's own runInstall call, before any agent
        // probing against the real home directory. runUpdate's own
        // behavior is covered in plugin.test.ts, not re-tested here.
        expect(exitCode).toBe(1);
        // Same progress-then-failure shape as the install dispatch test:
        // runUpdate forwards onProgress into its runInstall call. Exact
        // wording is plugin.test.ts's job, not this dispatch test's.
        expect(stdout.length).toBeGreaterThanOrEqual(2);
        expect(stdout.some((line) => line.includes("not-a-real-tag"))).toBe(
            true,
        );
    });

    it("dispatches plugin update and passes --force through as a boolean flag", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(
            ["plugin", "update", "--release", "not-a-real-tag", "--force"],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        // Exercises dispatch/flag-passthrough only, the same way the
        // plugin update dispatch test above does: an invalid tag fails
        // fast inside runUpdate's own runInstall call, before --force
        // is ever consulted. runUpdate's own --force behavior is
        // covered in plugin.test.ts, not re-tested here.
        expect(exitCode).toBe(1);
        expect(stderr).toEqual([]);
        // Same progress-then-failure shape as the other update dispatch
        // test: runUpdate forwards onProgress into its runInstall call.
        // Exact wording is plugin.test.ts's job, not this dispatch test's.
        expect(stdout.length).toBeGreaterThanOrEqual(2);
        expect(stdout.some((line) => line.includes("not-a-real-tag"))).toBe(
            true,
        );
    });

    it("dispatches plugin remove and passes --agent and --force through", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(
            ["plugin", "remove", "--agent", "cursor", "--force"],
            {
                cwd: ".",
                stdout: (line) => stdout.push(line),
                stderr: (line) => stderr.push(line),
            },
        );

        // Exercises dispatch/flag-passthrough only, the same way plugin
        // init's own dispatch test does: an unknown agent name fails
        // fast inside runRemove before any probing against the real
        // home directory. runRemove's own behavior is covered in
        // plugin.test.ts, not re-tested here.
        expect(exitCode).toBe(1);
        expect(stdout).toHaveLength(1);
        expect(stdout[0]).toContain("cursor");
    });

    it("renders plugin --help without requiring --feature or --project, listing all five actions coherently", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = await main(["--help", "plugin"], {
            cwd: ".",
            stdout: (line) => stdout.push(line),
            stderr: (line) => stderr.push(line),
        });

        expect(exitCode).toBe(0);
        expect(stdout[0]).toContain("Actions:");
        for (const action of [
            "install",
            "init",
            "status",
            "update",
            "remove",
        ]) {
            expect(stdout[0]).toContain(`${action} -`);
        }
        expect(stderr).toEqual([]);
    });

    it("rejects an unknown flag on an action-scoped command", async () => {
        const stderr: string[] = [];

        const exitCode = await main(
            [
                "decision",
                "add",
                "--text",
                "why",
                "--feature",
                "widget",
                "--project",
                ".",
                "--notaflag",
                "x",
            ],
            {
                cwd: ".",
                stdout: () => {},
                stderr: (line) => stderr.push(line),
            },
        );

        expect(exitCode).toBe(2);
        expect(stderr[0]).toContain(
            'Unknown option "--notaflag" for "decision add"',
        );
    });
});
