import { execFile as nodeExecFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseGitHubRepo } from "../workspace/Git.ts";
import type { CommandHelp } from "./Help.ts";
import { resolveRoot, resolveServices, type Services } from "./Root.ts";

const defaultRun = promisify(nodeExecFile);

export type ExecFileFn = (
    file: string,
    args: readonly string[],
    options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export type ImportOpts = {
    number: string;
    project: string;
    feature?: string;
    repo?: string;
};

export type ImportExecutionServices = Partial<Services> & {
    execFile?: ExecFileFn;
    fetch?: typeof fetch;
};

import type { CommandResult } from "./Result.ts";

export const help: CommandHelp = {
    name: "import",
    summary: "Fetch a GitHub issue or pull request into request.md.",
    usage: "qrspi-x import <number> [--feature <name>] [--repo <owner/repo | url>] [--project <path>]",
    flags: [
        {
            flag: "<number>",
            required: true,
            description: "GitHub issue or PR number (e.g. 42 or #42).",
        },
        {
            flag: "--feature <name>",
            required: false,
            description:
                "Explicit feature name instead of default gh-<repo>-<n>.",
        },
        {
            flag: "--repo <owner/repo | url>",
            required: false,
            description:
                "Target repo (shorthand or URL); defaults to project's git origin remote.",
        },
        {
            flag: "--project <path>",
            required: false,
            description:
                "The project root holding ./.qrspi/; defaults to the current directory.",
        },
    ],
};

export async function runImport(
    opts: ImportOpts,
    services: ImportExecutionServices = {},
): Promise<CommandResult> {
    const issueNumber = parseIssueNumber(opts.number);
    if (issueNumber === undefined) {
        return {
            exitCode: 1,
            text: `Invalid issue number "${opts.number}".\nProvide a positive issue or pull request number (e.g. 42 or #42).`,
        };
    }

    let explicitRepo: { owner: string; repo: string } | undefined;
    if (opts.repo) {
        try {
            explicitRepo = parseGitHubRepo(opts.repo);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (message.startsWith("Unsupported host")) {
                return {
                    exitCode: 1,
                    text: `${message}\nOnly github.com repositories are supported.`,
                };
            }
            return {
                exitCode: 1,
                text: `${message}\nProvide a valid GitHub repository shorthand (owner/repo) or URL.`,
            };
        }
    }

    const resolvedServices = resolveServices(
        resolveRoot(opts.project, "tmp"),
        opts.project,
        services,
    );
    const execFile = services.execFile ?? (defaultRun as unknown as ExecFileFn);
    const fetchFn = services.fetch ?? fetch;

    // Execute fetch
    const fetchRes = await executeFetch(
        issueNumber,
        explicitRepo,
        opts,
        resolvedServices,
        execFile,
        fetchFn,
    );
    if (!fetchRes.ok) {
        if (fetchRes.kind === "ambiguous") {
            return {
                exitCode: 1,
                text: `${fetchRes.message}\nSpecify the repository with --repo <owner/repo | url>.`,
            };
        }
        if (fetchRes.kind === "not-found") {
            return {
                exitCode: 1,
                text: `${fetchRes.message}\nDouble-check the repository and issue/PR number.`,
            };
        }
        return {
            exitCode: 1,
            text: `${fetchRes.message}\nEnsure you have access to the repository (e.g. gh auth login for private repositories).`,
        };
    }

    // Validate / derive feature name
    let featureName: string;
    if (opts.feature) {
        if (!isValidFeatureName(opts.feature)) {
            return {
                exitCode: 1,
                text: `Feature name "${opts.feature}" is invalid.\nFeature names must match [a-z0-9]+(-[a-z0-9]+)*.`,
            };
        }
        featureName = opts.feature;
    } else {
        const normRepo = normalizeRepoName(fetchRes.data.repo);
        featureName = `gh-${normRepo}-${fetchRes.data.number}`;
    }

    const featureRoot = resolveRoot(opts.project, featureName);

    // Check collision
    try {
        await access(featureRoot);
        return {
            exitCode: 1,
            text: `Feature workspace already exists at ${featureRoot}.\nResume work there or specify a distinct name with --feature <name>.`,
        };
    } catch {
        // Directory does not exist, good to proceed
    }

    // Create directory and write request.md
    await mkdir(featureRoot, { recursive: true });
    const title = fetchRes.data.title;
    const body = fetchRes.data.body;
    const content =
        body.trim().length > 0 ? `# ${title}\n\n${body}\n` : `# ${title}\n`;
    const requestPath = join(featureRoot, "request.md");
    await writeFile(requestPath, content, "utf8");

    return {
        exitCode: 0,
        feature: featureName,
        path: requestPath,
        source: {
            owner: fetchRes.data.owner,
            repo: fetchRes.data.repo,
            number: fetchRes.data.number,
            fetchedVia: fetchRes.data.fetchedVia,
        },
        text: `Imported ${fetchRes.data.owner}/${fetchRes.data.repo}#${fetchRes.data.number} into ${requestPath} (via ${fetchRes.data.fetchedVia}).\nNext: qrspi-x:init ${featureName} (or qrspi-x:query ${featureName} to skip straight to Query).`,
    };
}

function parseIssueNumber(input: string): number | undefined {
    const match = input.trim().match(/^#?(\d+)$/);
    if (!match) return undefined;
    return Number.parseInt(match[1], 10);
}

function isNotFoundErr(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const msg =
        `${(err as { message?: string }).message || ""} ${(err as { stderr?: string }).stderr || ""} ${(err as { stdout?: string }).stdout || ""}`.toLowerCase();
    return (
        msg.includes("could not resolve to an issue or pull request") ||
        msg.includes("could not resolve to an issue") ||
        msg.includes("could not resolve to a pull request") ||
        msg.includes("not found") ||
        msg.includes("404") ||
        msg.includes("no issue found") ||
        msg.includes("no pull request found")
    );
}

function isNoRepoErr(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const msg =
        `${(err as { message?: string }).message || ""} ${(err as { stderr?: string }).stderr || ""} ${(err as { stdout?: string }).stdout || ""}`.toLowerCase();
    return (
        msg.includes("not a git repository") ||
        msg.includes("no git remote") ||
        msg.includes("could not determine base repo") ||
        msg.includes("no default repository") ||
        msg.includes(
            "none of the git remotes configured for this repository point to a known github host",
        )
    );
}

function isValidFeatureName(name: string): boolean {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

function normalizeRepoName(repo: string): string {
    return repo
        .toLowerCase()
        .replace(/[._]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

type FetchedData = {
    title: string;
    body: string;
    owner: string;
    repo: string;
    number: number;
    fetchedVia: "gh" | "rest";
};

type FetchOutcome =
    | { ok: true; data: FetchedData }
    | {
          ok: false;
          kind: "not-found" | "ambiguous" | "fetch-failed";
          message: string;
      };

async function executeFetch(
    issueNumber: number,
    explicitRepo: { owner: string; repo: string } | undefined,
    opts: ImportOpts,
    services: Partial<Services>,
    execFile: ExecFileFn,
    fetchFn: typeof fetch,
): Promise<FetchOutcome> {
    const git = services.git;
    let owner = explicitRepo?.owner;
    let repo = explicitRepo?.repo;

    // 1. Try gh
    const baseArgs = [String(issueNumber)];
    if (owner && repo) {
        baseArgs.push("--repo", `${owner}/${repo}`);
    }
    baseArgs.push("--json", "title,body");

    let ghOutcome:
        | { ok: true; title: string; body: string }
        | {
              ok: false;
              reason: "not-found" | "no-repo" | "other";
              error: unknown;
          };

    try {
        const { stdout } = await execFile(
            "gh",
            ["issue", "view", ...baseArgs],
            {
                cwd: opts.project,
            },
        );
        const json = JSON.parse(stdout) as { title?: string; body?: string };
        ghOutcome = {
            ok: true,
            title: json.title ?? "",
            body: json.body ?? "",
        };
    } catch (issueErr) {
        if (isNoRepoErr(issueErr)) {
            ghOutcome = { ok: false, reason: "no-repo", error: issueErr };
        } else if (isNotFoundErr(issueErr)) {
            try {
                const { stdout } = await execFile(
                    "gh",
                    ["pr", "view", ...baseArgs],
                    {
                        cwd: opts.project,
                    },
                );
                const json = JSON.parse(stdout) as {
                    title?: string;
                    body?: string;
                };
                ghOutcome = {
                    ok: true,
                    title: json.title ?? "",
                    body: json.body ?? "",
                };
            } catch (prErr) {
                if (isNoRepoErr(prErr)) {
                    ghOutcome = { ok: false, reason: "no-repo", error: prErr };
                } else if (isNotFoundErr(prErr)) {
                    ghOutcome = {
                        ok: false,
                        reason: "not-found",
                        error: prErr,
                    };
                } else {
                    ghOutcome = { ok: false, reason: "other", error: prErr };
                }
            }
        } else {
            ghOutcome = { ok: false, reason: "other", error: issueErr };
        }
    }

    if (ghOutcome.ok) {
        if (!owner || !repo) {
            const inferred = await git?.originRepo();
            if (inferred) {
                owner = inferred.owner;
                repo = inferred.repo;
            }
        }
        if (owner && repo) {
            return {
                ok: true,
                data: {
                    title: ghOutcome.title,
                    body: ghOutcome.body,
                    owner,
                    repo,
                    number: issueNumber,
                    fetchedVia: "gh",
                },
            };
        }
    }

    // If gh failed or owner/repo not resolved, check git remote inference for REST
    if (!owner || !repo) {
        const inferred = await git?.originRepo();
        if (inferred) {
            owner = inferred.owner;
            repo = inferred.repo;
        } else {
            return {
                ok: false,
                kind: "ambiguous",
                message: `Reference "#${issueNumber}" has no target repository specified and none could be inferred from git remote. Specify --repo <owner/repo | url>.`,
            };
        }
    }

    // 2. Try REST fallback
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
        const res = await fetchFn(url, {
            headers: { "User-Agent": "qrspi-x-import" },
        });
        if (res.status === 404) {
            if (!ghOutcome.ok && ghOutcome.reason === "not-found") {
                return {
                    ok: false,
                    kind: "not-found",
                    message: `Issue/PR #${issueNumber} not found in repository ${owner}/${repo}.`,
                };
            }
            return {
                ok: false,
                kind: "fetch-failed",
                message: `Failed to fetch ${owner}/${repo}#${issueNumber}: gh failed and REST fallback returned 404.`,
            };
        }
        if (!res.ok) {
            return {
                ok: false,
                kind: "fetch-failed",
                message: `Failed to fetch ${owner}/${repo}#${issueNumber}: gh failed and REST fallback returned HTTP ${res.status}.`,
            };
        }
        const data = (await res.json()) as { title?: string; body?: string };
        return {
            ok: true,
            data: {
                title: data.title ?? "",
                body: data.body ?? "",
                owner,
                repo,
                number: issueNumber,
                fetchedVia: "rest",
            },
        };
    } catch (restErr) {
        if (!ghOutcome.ok && ghOutcome.reason === "not-found") {
            return {
                ok: false,
                kind: "not-found",
                message: `Issue/PR #${issueNumber} not found in repository ${owner}/${repo}.`,
            };
        }
        return {
            ok: false,
            kind: "fetch-failed",
            message: `Failed to fetch ${owner}/${repo}#${issueNumber}: gh failed and REST error: ${restErr instanceof Error ? restErr.message : String(restErr)}`,
        };
    }
}
