import { crc32 } from "node:zlib";
import { vi } from "vitest";
import type { ExecFileFn } from "../src/plugin/GitHub.ts";
import type { Git } from "../src/workspace/Git.ts";
import type { HistoryLog } from "../src/workspace/History.ts";

export function fakeGit(
    opts: {
        clean?: boolean;
        sha?: string;
        ancestors?: string[];
        originRepo?: { owner: string; repo: string };
    } = {},
): Git {
    return {
        isClean: async () => opts.clean ?? true,
        headSha: async () => opts.sha ?? "abc123",
        isAncestor: async (commit) => opts.ancestors?.includes(commit) ?? true,
        originRepo: async () => opts.originRepo,
    };
}

/**
 * Records calls without touching disk — enough for tests that only need
 * to prove a caller passed the right filter/entry/args, not re-verify
 * History's own matching logic (that's test/workspace/History.test.ts's
 * job).
 */
export function fakeHistory(): HistoryLog & {
    append: ReturnType<typeof vi.fn>;
    conditionalAppend: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    isParked: ReturnType<typeof vi.fn>;
} {
    return {
        append: vi.fn(async () => {}),
        conditionalAppend: vi.fn(async () => true),
        read: vi.fn(async () => []),
        isParked: vi.fn(async () => false),
    };
}

/**
 * Dispatches by `args[0]`/`args[1]` so a test only has to supply the
 * subcommands it exercises; an unhandled call throws an ENOENT-shaped
 * error the same way a missing `gh` binary would, which also doubles as
 * the gh-missing fixture.
 */
export function fakeExecFile(
    handlers: Partial<{
        "release list": (
            args: readonly string[],
        ) => Promise<{ stdout: string; stderr: string }>;
        "release view": (
            args: readonly string[],
        ) => Promise<{ stdout: string; stderr: string }>;
        "release download": (
            args: readonly string[],
        ) => Promise<{ stdout: string; stderr: string }>;
        "attestation verify": (
            args: readonly string[],
        ) => Promise<{ stdout: string; stderr: string }>;
    }> = {},
): ExecFileFn {
    return async (file, args) => {
        if (file !== "gh") {
            throw new Error(`unexpected binary: ${file}`);
        }
        const key = `${args[0]} ${args[1]}`;
        const handler = handlers[key as keyof typeof handlers];
        if (!handler) {
            const err = new Error(`spawn gh ENOENT`) as Error & {
                code: string;
            };
            err.code = "ENOENT";
            throw err;
        }
        return handler(args);
    };
}

type ZipEntry = { path: string; content: string };

/**
 * Builds a minimal valid ZIP archive (STORED method, no compression) in
 * memory, just enough for yauzl to read back. Avoids depending on the
 * system `zip` binary or a zip-writing package purely for test fixtures.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.path, "utf8");
        const dataBuf = Buffer.from(entry.content, "utf8");
        const crc = crc32(dataBuf);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(dataBuf.length, 18);
        localHeader.writeUInt32LE(dataBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuf, dataBuf);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(dataBuf.length, 20);
        centralHeader.writeUInt32LE(dataBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuf);

        offset += localHeader.length + nameBuf.length + dataBuf.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const centralDirectoryOffset = offset;

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(centralDirectoryOffset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirectory, endRecord]);
}
