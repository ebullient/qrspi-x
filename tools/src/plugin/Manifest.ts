export type PluginManifest = {
    version: string;
    payloadPaths: string[];
    releaseTag: string;
    downloadedAt: string;
    archiveHash: string;
};

const REQUIRED_STRING_FIELDS: (keyof Omit<PluginManifest, "payloadPaths">)[] = [
    "version",
    "releaseTag",
    "downloadedAt",
    "archiveHash",
];

/**
 * Parses untrusted JSON text into a manifest shape without throwing: bad
 * input (malformed JSON, non-object, missing/mistyped/empty fields) is
 * reported as `undefined`, never an exception, since callers (install,
 * update, status, remove) must treat a foreign or corrupt manifest as
 * data, not a crash.
 */
export function parseManifest(text: string): PluginManifest | undefined {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return undefined;
    }

    if (!isValidManifestShape(data)) {
        return undefined;
    }

    return data;
}

/**
 * True only when every required field (version, payload path layout,
 * resolved release tag, download timestamp, archive hash) is present,
 * correctly typed, and non-empty.
 */
export function isValidManifestShape(data: unknown): data is PluginManifest {
    if (typeof data !== "object" || data === null) {
        return false;
    }

    const record = data as Record<string, unknown>;

    for (const field of REQUIRED_STRING_FIELDS) {
        if (typeof record[field] !== "string" || record[field] === "") {
            return false;
        }
    }

    const payloadPaths = record.payloadPaths;
    if (!Array.isArray(payloadPaths) || payloadPaths.length === 0) {
        return false;
    }
    for (const path of payloadPaths) {
        if (
            typeof path !== "string" ||
            path === "" ||
            !isPayloadPathSafe(path)
        ) {
            return false;
        }
    }

    return true;
}

/**
 * Rejects anything but a single flat path segment: no `/` (or `\` on
 * Windows), and not `.` or `..`. A legitimate `payloadPaths` entry is
 * always exactly one top-level name — `Staging.ts` computes the whole
 * list with a single, non-recursive `readdir` — so this only rejects
 * crafted/corrupted data.
 *
 * This matters beyond path-escape safety: `probeTarget` resolves each
 * declared path with `lstat(join(targetDir, payloadPath))`, and `lstat`
 * only leaves its *final* path component unresolved — every
 * intermediate component is still followed as the OS walks there. A
 * multi-segment path like `payload/secret` would let a crafted manifest
 * point `payload` itself at a symlink to content outside `targetDir`
 * and still probe as present, letting a foreign directory spoof managed
 * ownership (and be acted on by `remove`) for content it doesn't
 * actually have. Confining every path to one flat segment removes any
 * intermediate component for a symlink to hide behind.
 */
function isPayloadPathSafe(path: string): boolean {
    return (
        !path.includes("/") &&
        !path.includes("\\") &&
        path !== "." &&
        path !== ".."
    );
}

/**
 * Two manifests are current with each other when their version and
 * archive hash both match — the pair `update`/`status` compare to decide
 * whether an installed or placed copy still matches the central payload.
 */
export function isCurrentWith(a: PluginManifest, b: PluginManifest): boolean {
    return a.version === b.version && a.archiveHash === b.archiveHash;
}

/**
 * Mirrors `.github/scripts/package-release.sh`'s own tag check exactly
 * (unprefixed SemVer, optional prerelease suffix) so the two never
 * silently diverge: a `v`-prefixed tag, branch name, SHA, or a version
 * with leading-zero components all fail here the same way that script
 * would reject them at release time.
 */
const RELEASE_TAG_PATTERN =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;

export type ParsedTag = {
    tag: string;
    major: number;
    minor: number;
    patch: number;
    prerelease: boolean;
};

export function parseReleaseTag(tag: string): ParsedTag | undefined {
    const match = RELEASE_TAG_PATTERN.exec(tag);
    if (!match) {
        return undefined;
    }

    return {
        tag,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] !== undefined,
    };
}
