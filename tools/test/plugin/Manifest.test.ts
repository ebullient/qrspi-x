import { describe, expect, it } from "vitest";
import {
    isCurrentWith,
    type PluginManifest,
    parseManifest,
    parseReleaseTag,
} from "../../src/plugin/Manifest.ts";

const valid: PluginManifest = {
    version: "1.2.3",
    payloadPaths: ["agents", "skills", "README.md"],
    releaseTag: "1.2.3",
    downloadedAt: "2026-10-01T12:00:00.000Z",
    archiveHash: "sha256:abc123",
};

describe("parseManifest", () => {
    const cases: [string, string][] = [
        ["valid manifest", JSON.stringify(valid)],
        ["missing version", JSON.stringify({ ...valid, version: undefined })],
        ["wrong-typed version", JSON.stringify({ ...valid, version: 123 })],
        ["empty version", JSON.stringify({ ...valid, version: "" })],
        [
            "missing releaseTag",
            JSON.stringify({ ...valid, releaseTag: undefined }),
        ],
        [
            "wrong-typed releaseTag",
            JSON.stringify({ ...valid, releaseTag: 123 }),
        ],
        ["empty releaseTag", JSON.stringify({ ...valid, releaseTag: "" })],
        [
            "missing downloadedAt",
            JSON.stringify({ ...valid, downloadedAt: undefined }),
        ],
        [
            "wrong-typed downloadedAt",
            JSON.stringify({ ...valid, downloadedAt: 123 }),
        ],
        ["empty downloadedAt", JSON.stringify({ ...valid, downloadedAt: "" })],
        [
            "missing archiveHash",
            JSON.stringify({ ...valid, archiveHash: undefined }),
        ],
        [
            "wrong-typed archiveHash",
            JSON.stringify({ ...valid, archiveHash: 123 }),
        ],
        ["empty archiveHash", JSON.stringify({ ...valid, archiveHash: "" })],
        [
            "missing payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: undefined }),
        ],
        [
            "wrong-typed payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: "agents" }),
        ],
        ["empty payloadPaths", JSON.stringify({ ...valid, payloadPaths: [] })],
        [
            "empty-string entry in payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: ["agents", ""] }),
        ],
        [
            "wrong-typed entry in payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: ["agents", 123] }),
        ],
        [
            "parent-traversal entry in payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: ["agents", "../escape"] }),
        ],
        [
            "nested parent-traversal entry in payloadPaths",
            JSON.stringify({
                ...valid,
                payloadPaths: ["agents/../../escape"],
            }),
        ],
        [
            "absolute entry in payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: ["/etc/passwd"] }),
        ],
        [
            "nested (non-flat) entry in payloadPaths that doesn't escape via ..",
            // Doesn't trip the ../absolute checks on its own, but
            // probeTarget's lstat(join(targetDir, payloadPath)) follows
            // every *intermediate* path component (only the final one
            // is left unresolved) — so if "payload" here were itself a
            // symlink to somewhere outside targetDir, this path would
            // still resolve and probe as present. Rejected because a
            // legitimate payloadPaths entry is always exactly one flat
            // top-level name.
            JSON.stringify({ ...valid, payloadPaths: ["payload/secret"] }),
        ],
        [
            "Windows-style nested entry in payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: ["payload\\secret"] }),
        ],
        [
            "bare '.' entry in payloadPaths",
            JSON.stringify({ ...valid, payloadPaths: ["."] }),
        ],
        ["malformed JSON", "{not json"],
        ["non-object JSON", JSON.stringify("just a string")],
        ["null JSON", "null"],
    ];

    for (const [label, text] of cases) {
        it(`${label}: ${label === "valid manifest" ? "parses" : "reports undefined, never throws"}`, () => {
            if (label === "valid manifest") {
                expect(parseManifest(text)).toEqual(valid);
            } else {
                expect(() => parseManifest(text)).not.toThrow();
                expect(parseManifest(text)).toBeUndefined();
            }
        });
    }
});

describe("isCurrentWith", () => {
    it("is true only when version and archive hash both match", () => {
        expect(isCurrentWith(valid, { ...valid })).toBe(true);
        expect(isCurrentWith(valid, { ...valid, version: "9.9.9" })).toBe(
            false,
        );
        expect(
            isCurrentWith(valid, { ...valid, archiveHash: "sha256:other" }),
        ).toBe(false);
        expect(
            isCurrentWith(valid, {
                ...valid,
                version: "9.9.9",
                archiveHash: "sha256:other",
            }),
        ).toBe(false);
    });
});

describe("parseReleaseTag", () => {
    const accepted: string[] = [
        "0.0.0",
        "1.2.3",
        "10.20.30",
        "1.2.3-beta.1",
        "1.2.3-0.alpha",
    ];
    const rejected: string[] = [
        "v1.2.3",
        "main",
        "64efce7932e16902923e34285e56a02198a61a2b",
        "01.2.3",
        "1.02.3",
        "1.2.03",
        "1.2",
        "1.2.3.4",
        "",
        "latest",
    ];

    for (const tag of accepted) {
        it(`accepts "${tag}" (matches package-release.sh's own check)`, () => {
            expect(parseReleaseTag(tag)).toBeDefined();
        });
    }

    for (const tag of rejected) {
        it(`rejects "${tag}" (package-release.sh would reject it too)`, () => {
            expect(parseReleaseTag(tag)).toBeUndefined();
        });
    }

    it("reports major/minor/patch and the prerelease flag", () => {
        expect(parseReleaseTag("1.2.3")).toEqual({
            tag: "1.2.3",
            major: 1,
            minor: 2,
            patch: 3,
            prerelease: false,
        });
        expect(parseReleaseTag("1.2.3-beta.1")?.prerelease).toBe(true);
    });
});
