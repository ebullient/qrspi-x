import { describe, expect, it } from "vitest";
import { gitHubAt } from "../../src/plugin/GitHub.ts";
import { fakeExecFile } from "../fixtures.ts";

const repo = { owner: "ebullient", repo: "qrspi-x" };

function withStderr(
    message: string,
    stderr: string,
): Error & { stderr: string } {
    const err = new Error(message) as Error & { stderr: string };
    err.stderr = stderr;
    return err;
}

describe("resolveRelease", () => {
    it("rejects an invalid explicit tag before any network call", async () => {
        const execFile = fakeExecFile();
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease("v1.2.3");

        expect(result).toEqual({
            ok: false,
            reason: "invalid-tag",
            message: expect.stringContaining('"v1.2.3"'),
        });
    });

    it("resolves an explicit tag that exists", async () => {
        const execFile = fakeExecFile({
            "release view": async (args) => {
                expect(args).toEqual([
                    "release",
                    "view",
                    "1.2.3",
                    "--repo",
                    "ebullient/qrspi-x",
                    "--json",
                    "tagName",
                ]);
                return {
                    stdout: JSON.stringify({ tagName: "1.2.3" }),
                    stderr: "",
                };
            },
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease("1.2.3");

        expect(result).toEqual({ ok: true, tag: "1.2.3" });
    });

    it("reports not-found for a well-formed tag gh doesn't have", async () => {
        const execFile = fakeExecFile({
            "release view": async () => {
                throw new Error("release not found");
            },
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease("9.9.9");

        expect(result).toEqual({
            ok: false,
            reason: "not-found",
            message: expect.stringContaining("9.9.9"),
        });
    });

    it("reports lookup failures distinctly from a missing release", async () => {
        const error = withStderr("command failed", "authentication required");
        const execFile = fakeExecFile({
            "release view": async () => {
                throw error;
            },
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease("9.9.9");

        expect(result).toEqual({
            ok: false,
            reason: "lookup-failed",
            message: expect.stringContaining("authentication required"),
        });
    });

    it("defaults to gh's own latest-eligible pick, excluding prereleases and drafts", async () => {
        const execFile = fakeExecFile({
            "release list": async (args) => {
                expect(args).toEqual([
                    "release",
                    "list",
                    "--repo",
                    "ebullient/qrspi-x",
                    "--exclude-drafts",
                    "--exclude-pre-releases",
                    "--order",
                    "desc",
                    "--limit",
                    "1",
                    "--json",
                    "tagName",
                ]);
                return {
                    stdout: JSON.stringify([{ tagName: "1.5.0" }]),
                    stderr: "",
                };
            },
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease(undefined);

        expect(result).toEqual({ ok: true, tag: "1.5.0" });
    });

    it("reports no-eligible when gh returns nothing", async () => {
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease(undefined);

        expect(result).toEqual({
            ok: false,
            reason: "no-eligible",
            message: expect.any(String),
        });
    });

    it("reports no-eligible if gh's pick doesn't match the project's tag format", async () => {
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([{ tagName: "v1.5.0" }]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.resolveRelease(undefined);

        expect(result).toEqual({
            ok: false,
            reason: "no-eligible",
            message: expect.any(String),
        });
    });
});

describe("checkFreshness", () => {
    it("reports update-available when a newer eligible release exists", async () => {
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([{ tagName: "1.3.0" }]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.checkFreshness("1.2.0");

        expect(result).toEqual({ status: "update-available", latest: "1.3.0" });
    });

    it("reports up-to-date when only prereleases are newer, since they're excluded as candidates", async () => {
        // gh's own --exclude-pre-releases means "release list" never
        // surfaces a prerelease here; the eligible pick is the installed
        // version itself (no eligible release is actually newer).
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([{ tagName: "1.2.0" }]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.checkFreshness("1.2.0");

        expect(result).toEqual({ status: "up-to-date" });
    });

    it("reports unknown when no eligible release exists at all", async () => {
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.checkFreshness("1.2.0");

        expect(result).toEqual({ status: "unknown" });
    });

    it("still attempts the lookup, and reports the latest tag it found, when the installed version doesn't parse", async () => {
        // Proves the lookup is actually attempted (not skipped) for an
        // unparseable installed version, including "" (nothing
        // installed) — a handler-less fakeExecFile would mask a
        // short-circuit that skips the call entirely, which is exactly
        // the bug this guards against.
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([{ tagName: "1.5.0" }]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.checkFreshness("not-a-version");

        expect(result).toEqual({ status: "unknown", latest: "1.5.0" });
    });

    it("reports bare unknown when the installed version doesn't parse and no eligible release exists either", async () => {
        const execFile = fakeExecFile({
            "release list": async () => ({
                stdout: JSON.stringify([]),
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.checkFreshness("not-a-version");

        expect(result).toEqual({ status: "unknown" });
    });

    it("reports unknown with the error when the release lookup fails", async () => {
        const execFile = fakeExecFile({
            "release list": async () => {
                throw new Error("rate limited");
            },
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.checkFreshness("1.2.0");

        expect(result).toEqual({
            status: "unknown",
            message: expect.stringContaining("rate limited"),
        });
    });
});

describe("verifyAttestation", () => {
    it("reports success without throwing", async () => {
        const execFile = fakeExecFile({
            "attestation verify": async () => ({
                stdout: "[]",
                stderr: "",
            }),
        });
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.verifyAttestation("/tmp/asset.zip");

        expect(result).toEqual({ ok: true });
    });

    it("reports gh-missing, never throws, when gh is not installed", async () => {
        const execFile = fakeExecFile();
        const github = gitHubAt(repo, "/tmp", { execFile });

        const result = await github.verifyAttestation("/tmp/asset.zip");

        expect(result).toEqual({
            ok: false,
            reason: "gh-missing",
            // No --force bypass exists for attestation verification —
            // the message must not imply one.
            message: expect.stringContaining("gh"),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).not.toContain("--force");
        }
    });

    // gh collapses every non-auth failure reason (no attestation, digest
    // mismatch, wrong repo, bare tool error) to the same exit-1 shape, so
    // verifyAttestation has exactly one fallback branch for all of them.
    // One parameterized case proves that branch preserves whatever text
    // gh produced, rather than four copies of the same assertion.
    const nonGhMissingFailures: [string, () => Error][] = [
        [
            "no attestation found",
            () => withStderr("command failed", "no attestations found"),
        ],
        [
            "digest mismatch",
            () => withStderr("command failed", "subject digest does not match"),
        ],
        [
            "wrong source repository",
            () =>
                withStderr(
                    "command failed",
                    "HTTP 404: Not Found (.../repos/someone/else/attestations/...)",
                ),
        ],
        ["a bare tool error", () => new Error("unexpected tool failure")],
    ];

    for (const [label, makeError] of nonGhMissingFailures) {
        it(`reports a generic verification failure for ${label}`, async () => {
            const error = makeError();
            const execFile = fakeExecFile({
                "attestation verify": async () => {
                    throw error;
                },
            });
            const github = gitHubAt(repo, "/tmp", { execFile });

            const result = await github.verifyAttestation("/tmp/asset.zip");

            const expectedText =
                (error as { stderr?: string }).stderr ?? error.message;
            expect(result).toEqual({
                ok: false,
                reason: "verification-failed",
                message: expect.stringContaining(expectedText),
            });
        });
    }
});
