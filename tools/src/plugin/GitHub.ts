import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { parseReleaseTag } from "./Manifest.ts";

const defaultRun = promisify(nodeExecFile);

export type ExecFileFn = (
    file: string,
    args: readonly string[],
    options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export type GitHubRepo = {
    owner: string;
    repo: string;
};

export type ResolveReleaseResult =
    | { ok: true; tag: string }
    | {
          ok: false;
          reason: "invalid-tag" | "not-found" | "lookup-failed" | "no-eligible";
          message: string;
      };

export type AttestationResult =
    | { ok: true }
    | {
          ok: false;
          reason: "gh-missing" | "verification-failed";
          message: string;
      };

export type FreshnessResult =
    | { status: "update-available"; latest: string }
    | { status: "up-to-date" }
    | { status: "unknown"; message?: string; latest?: string };

export type GitHub = {
    resolveRelease: (
        requested: string | undefined,
    ) => Promise<ResolveReleaseResult>;
    verifyAttestation: (assetPath: string) => Promise<AttestationResult>;
    checkFreshness: (installedVersion: string) => Promise<FreshnessResult>;
};

/**
 * Wraps release listing and attestation verification against a single
 * repository, always supplied by the caller — the installer always
 * targets `ebullient/qrspi-x`, never a locally configured git remote.
 */
export function gitHubAt(
    repository: GitHubRepo,
    cwd: string,
    deps: { execFile?: ExecFileFn } = {},
): GitHub {
    const execFile = deps.execFile ?? (defaultRun as unknown as ExecFileFn);
    const repoSlug = `${repository.owner}/${repository.repo}`;

    /**
     * An explicit `--release` value is validated against the project's
     * tag format before any network call, so a malformed tag never
     * reaches `gh` and never produces a confusing "not found". Beyond
     * that, resolution leans entirely on `gh`: `--exclude-pre-releases`
     * for eligibility (GitHub's own prerelease flag is the authority,
     * not a tag's `-suffix`) and `gh`'s own release ordering for
     * "latest" in the default case, rather than re-deriving either.
     */
    async function resolveRelease(
        requested: string | undefined,
    ): Promise<ResolveReleaseResult> {
        if (requested !== undefined) {
            if (!parseReleaseTag(requested)) {
                return {
                    ok: false,
                    reason: "invalid-tag",
                    message: `"${requested}" is not a valid release tag. Expected unprefixed SemVer (e.g. 1.2.3), matching the project's release-tag format.`,
                };
            }

            const exists = await releaseExists(requested);
            if (exists.status === "error") {
                return {
                    ok: false,
                    reason: "lookup-failed",
                    message: `Failed to look up release "${requested}" in ${repoSlug}: ${exists.message}`,
                };
            }
            if (exists.status === "not-found") {
                return {
                    ok: false,
                    reason: "not-found",
                    message: `Release "${requested}" was not found in ${repoSlug}.`,
                };
            }
            return { ok: true, tag: requested };
        }

        const latest = await latestEligibleTag();
        if (!latest) {
            return {
                ok: false,
                reason: "no-eligible",
                message: `No eligible release tag found in ${repoSlug}.`,
            };
        }
        return { ok: true, tag: latest };
    }

    async function releaseExists(
        tag: string,
    ): Promise<
        | { status: "exists" }
        | { status: "not-found" }
        | { status: "error"; message: string }
    > {
        try {
            await execFile(
                "gh",
                [
                    "release",
                    "view",
                    tag,
                    "--repo",
                    repoSlug,
                    "--json",
                    "tagName",
                ],
                { cwd },
            );
            return { status: "exists" };
        } catch (err) {
            if (isNotFoundError(err)) {
                return { status: "not-found" };
            }
            return { status: "error", message: errorText(err) };
        }
    }

    async function latestEligibleTag(): Promise<string | undefined> {
        const { stdout } = await execFile(
            "gh",
            [
                "release",
                "list",
                "--repo",
                repoSlug,
                "--exclude-drafts",
                "--exclude-pre-releases",
                "--order",
                "desc",
                "--limit",
                "1",
                "--json",
                "tagName",
            ],
            { cwd },
        );
        const releases = JSON.parse(stdout) as { tagName: string }[];
        const tag = releases[0]?.tagName;
        return tag && parseReleaseTag(tag) ? tag : undefined;
    }

    /**
     * Fails closed: no attestation found, digest mismatch, wrong source
     * repository, or any tool/API error (including a missing `gh`
     * binary or missing credentials) all produce a reported failure,
     * never a thrown exception and never a false "verified." `gh`
     * collapses every non-auth failure reason to exit code 1 with no
     * further distinction available, so this never branches on *why*
     * verification failed — only that it did.
     */
    async function verifyAttestation(
        assetPath: string,
    ): Promise<AttestationResult> {
        try {
            await execFile(
                "gh",
                [
                    "attestation",
                    "verify",
                    assetPath,
                    "--repo",
                    repoSlug,
                    "--format",
                    "json",
                ],
                { cwd },
            );
            return { ok: true };
        } catch (err) {
            if (isGhMissing(err)) {
                return {
                    ok: false,
                    reason: "gh-missing",
                    message:
                        "GitHub CLI (gh) is required to verify release attestations and was not found. Install gh and try again; attestation verification cannot be skipped.",
                };
            }
            return {
                ok: false,
                reason: "verification-failed",
                message: `Attestation verification failed for ${assetPath}: ${errorText(err)}`,
            };
        }
    }

    /**
     * Compares the installed version against the latest eligible release
     * (reusing the same prerelease-excluding selection `resolveRelease`'s
     * default case uses, so the two never disagree on what counts as a
     * candidate). The lookup itself is always attempted, even when the
     * installed version won't parse (e.g. "" when nothing is installed),
     * so "unknown" still carries whatever latest release GitHub reports;
     * only the numeric comparison is skipped when there's nothing valid
     * to compare it against — no eligible release exists, or the
     * installed version doesn't parse — and the whole result degrades
     * to "unknown" plus the underlying error if the release lookup
     * itself fails, rather than throwing.
     */
    async function checkFreshness(
        installedVersion: string,
    ): Promise<FreshnessResult> {
        let latestTag: string | undefined;
        try {
            latestTag = await latestEligibleTag();
        } catch (err) {
            return { status: "unknown", message: errorText(err) };
        }

        if (!latestTag) {
            return { status: "unknown" };
        }

        const latest = parseReleaseTag(latestTag);
        if (!latest) {
            return { status: "unknown" };
        }

        const installed = parseReleaseTag(installedVersion);
        if (!installed) {
            // The lookup succeeded even though there's nothing to
            // compare it against — report what GitHub has, not bare
            // unknown.
            return { status: "unknown", latest: latestTag };
        }

        const isNewer =
            latest.major !== installed.major
                ? latest.major > installed.major
                : latest.minor !== installed.minor
                  ? latest.minor > installed.minor
                  : latest.patch > installed.patch;

        return isNewer
            ? { status: "update-available", latest: latestTag }
            : { status: "up-to-date" };
    }

    return { resolveRelease, verifyAttestation, checkFreshness };
}

function isGhMissing(err: unknown): boolean {
    const code = (err as { code?: string } | undefined)?.code;
    return code === "ENOENT";
}

function errorText(err: unknown): string {
    if (err && typeof err === "object") {
        const stderr = (err as { stderr?: string }).stderr;
        if (stderr?.trim()) {
            return stderr.trim();
        }
        const message = (err as { message?: string }).message;
        if (message) {
            return message;
        }
    }
    return String(err);
}

function isNotFoundError(err: unknown): boolean {
    const code = (err as { code?: string } | undefined)?.code;
    const stderr = (err as { stderr?: string } | undefined)?.stderr ?? "";
    const message = (err as { message?: string } | undefined)?.message ?? "";
    return (
        code === "GH_NOT_FOUND" ||
        /release not found/i.test(`${stderr}\n${message}`)
    );
}
