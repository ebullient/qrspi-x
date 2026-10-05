// Bundles the CLI helper into the publishable build output:
// tools/dist/qrspi-x.mjs (generated output).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

function localVersion() {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: new URL(".", import.meta.url),
        encoding: "utf8",
    }).trim();
    const dirty = execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        { cwd: new URL(".", import.meta.url), encoding: "utf8" },
    ).trim();
    return `${pkg.version}+g${sha}${dirty === "" ? "" : ".dirty"}`;
}

const buildVersion =
    process.env.CI === "true"
        ? (process.env.QRSPI_BUILD_VERSION ?? pkg.version)
        : localVersion();

await build({
    entryPoints: [fileURLToPath(new URL("./src/bin.ts", import.meta.url))],
    outfile: fileURLToPath(new URL("./dist/qrspi-x.mjs", import.meta.url)),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // yauzl is CJS and uses a dynamic `require` esbuild can't translate
    // into ESM; left external, Node resolves it normally from
    // node_modules at runtime (it's a real "dependencies" entry, so
    // it's always present wherever this package is installed).
    external: ["yauzl"],
    define: {
        __QRSPI_VERSION__: JSON.stringify(buildVersion),
    },
    legalComments: "none",
    logLevel: "warning",
});
