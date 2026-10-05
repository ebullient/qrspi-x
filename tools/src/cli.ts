import * as decision from "./command/decision.ts";
import {
    type ActionHelp,
    type CommandHelp,
    type FlagHelp,
    renderHelp,
    renderToolHelp,
} from "./command/Help.ts";
import * as history from "./command/history.ts";
import * as importCmd from "./command/import.ts";
import * as log from "./command/log.ts";
import * as loop from "./command/loop.ts";
import * as nextFile from "./command/next-file.ts";
import * as plugin from "./command/plugin.ts";
import { type CommandResult, toJson } from "./command/Result.ts";
import * as start from "./command/start.ts";
import * as status from "./command/status.ts";

declare const __QRSPI_VERSION__: string;

export type Io = {
    cwd: string;
    stdout: (line: string) => void;
    stderr: (line: string) => void;
};

type Options = Record<string, string | boolean | undefined>;

export const commandHelps: CommandHelp[] = [
    decision.help,
    history.help,
    log.help,
    loop.help,
    nextFile.help,
    start.help,
    status.help,
    importCmd.help,
    plugin.help,
];

const commandNames = new Set(commandHelps.map((entry) => entry.name));

class UsageError extends Error {}

function processIo(): Io {
    return {
        cwd: process.cwd(),
        stdout: (line) => process.stdout.write(`${line}\n`),
        stderr: (line) => process.stderr.write(`${line}\n`),
    };
}

export async function main(
    argv: string[],
    io: Io = processIo(),
): Promise<number> {
    try {
        if (argv.length === 0) {
            io.stdout(renderToolHelp(commandHelps));
            return 0;
        }
        if (argv[0] === "--version") {
            io.stdout(version());
            return 0;
        }
        if (argv.includes("--help") || argv.includes("-h")) {
            const positionals: string[] = [];
            for (const arg of argv) {
                if (arg === "--help" || arg === "-h") {
                    continue;
                }
                if (arg.startsWith("-")) {
                    break;
                }
                positionals.push(arg);
            }
            return emitHelp(positionals, io);
        }

        const command = argv[0];
        if (command === undefined || !commandNames.has(command)) {
            throw new UsageError(`Unknown command "${command ?? ""}"`);
        }

        const { positionals, options } = parseOptions(argv.slice(1));
        validateOptions(command, positionals, options);
        const result =
            command === "plugin"
                ? await dispatchPlugin(positionals, options)
                : command === "import"
                  ? await dispatchImport(
                        positionals,
                        options,
                        projectAndOptionalFeature(options, io.cwd),
                    )
                  : await dispatch(
                        command,
                        positionals,
                        options,
                        projectAndFeature(options, io.cwd),
                    );
        if (typeof result === "string") {
            io.stdout(result);
        } else if (Array.isArray(result)) {
            io.stdout(JSON.stringify(result));
        } else if (typeof result.text === "string") {
            io.stdout(result.text);
        } else {
            io.stdout(JSON.stringify(toJson(result)));
        }
        return typeof result === "object" && !Array.isArray(result)
            ? (result as CommandResult).exitCode
            : 0;
    } catch (error) {
        if (error instanceof UsageError) {
            io.stderr(error.message);
            return 2;
        }
        io.stderr(
            error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
        );
        return 4;
    }
}

function emitHelp(args: string[], io: Io): number {
    const command = args[0];
    if (command === undefined) {
        io.stdout(renderToolHelp(commandHelps));
        return 0;
    }
    const help = commandHelps.find((entry) => entry.name === command);
    if (help === undefined) {
        io.stderr(`Unknown command "${command}"`);
        return 2;
    }
    const action = args[1];
    if (action === undefined) {
        io.stdout(renderHelp(help));
        return 0;
    }
    io.stdout(renderHelp(help, action));
    return 0;
}

function parseOptions(args: string[]): {
    positionals: string[];
    options: Options;
} {
    const positionals: string[] = [];
    const options: Options = {};
    for (let i = 0; i < args.length; i++) {
        const token = args[i] as string;
        if (!token.startsWith("--")) {
            positionals.push(token);
            continue;
        }
        const equals = token.indexOf("=");
        const name = equals === -1 ? token : token.slice(0, equals);
        const attached = equals === -1 ? undefined : token.slice(equals + 1);
        if (
            name === "--loop" ||
            name === "--all" ||
            name === "--copy" ||
            name === "--symlink" ||
            name === "--force"
        ) {
            setOption(options, name.slice(2), true);
            continue;
        }
        const value = attached ?? args[++i];
        if (
            value === undefined ||
            value === "" ||
            (attached === undefined && value.startsWith("--"))
        ) {
            throw new UsageError(`${name} requires a non-empty value`);
        }
        setOption(options, name.slice(2), value);
    }
    return { positionals, options };
}

function flagName(flag: string): string | undefined {
    if (!flag.startsWith("--")) return undefined;
    const token = flag.split(/[\s=]/, 1)[0] as string;
    return token.slice(2);
}

function allowedFlagNames(flags: FlagHelp[] | undefined): Set<string> {
    const names = new Set<string>();
    for (const f of flags ?? []) {
        const name = flagName(f.flag);
        if (name) names.add(name);
    }
    return names;
}

/**
 * Each command/action's `help.flags` (always including `commonOptions`) is
 * the single source of truth for what it accepts. For an action-based
 * command this also throws on an unrecognized action name, which used to be
 * duplicated as a `default` case in every one of that command's dispatch
 * switches (and in `dispatchLoop`'s own) — `help.actions` already lists the
 * same names, so one lookup here replaces all of them.
 */
function validateOptions(
    command: string,
    positionals: string[],
    options: Options,
): void {
    const help = commandHelps.find((c) => c.name === command);
    if (!help) {
        return;
    }

    let flags: FlagHelp[] | undefined;
    let scope = command;
    if (help.actions && help.actions.length > 0) {
        const actionName = positionals[0];
        const action: ActionHelp | undefined = help.actions.find(
            (a) => a.name === actionName,
        );
        if (!action) {
            throw new UsageError(
                `Unknown ${command} action "${actionName ?? ""}"`,
            );
        }
        flags = action.flags;
        scope = `${command} ${actionName}`;
    } else {
        flags = help.flags;
    }

    const allowed = allowedFlagNames(flags);
    for (const name of Object.keys(options)) {
        if (!allowed.has(name)) {
            throw new UsageError(`Unknown option "--${name}" for "${scope}"`);
        }
    }
}

function setOption(
    options: Options,
    name: string,
    value: string | boolean,
): void {
    if (options[name] !== undefined) {
        throw new UsageError(`--${name} was given more than once`);
    }
    options[name] = value;
}

function required(options: Options, name: string): string {
    const value = options[name];
    if (typeof value !== "string") {
        throw new UsageError(`--${name} is required`);
    }
    return value;
}

type Common = { feature: string; project: string };
type CommonOptional = { feature: string | undefined; project: string };

function projectAndOptionalFeature(
    options: Options,
    cwd: string,
): CommonOptional {
    const project = options.project;
    const feature = options.feature;
    return {
        feature: typeof feature === "string" ? feature : undefined,
        project: typeof project === "string" ? project : cwd,
    };
}

function projectAndFeature(options: Options, cwd: string): Common {
    const project = options.project;
    return {
        feature: required(options, "feature"),
        project: typeof project === "string" ? project : cwd,
    };
}

async function dispatch(
    command: string,
    positionals: string[],
    options: Options,
    common: Common,
): Promise<CommandResult | string | unknown[]> {
    switch (command) {
        case "status":
            return dispatchStatus(positionals, common);
        case "next-file":
            return dispatchNextFile(positionals, options, common);
        case "loop":
            return dispatchLoop(positionals, common);
        case "decision":
            return dispatchDecision(positionals, options, common);
        case "history":
            return dispatchHistory(positionals, options, common);
        case "start":
            return dispatchStart(positionals, options, common);
        case "log":
            return dispatchLog(positionals, options, common);
        default:
            throw new UsageError(`Unknown command "${command}"`);
    }
}

function dispatchStatus(
    positionals: string[],
    common: Common,
): Promise<CommandResult> {
    if (positionals.length !== 0) {
        throw new UsageError("status takes no positional arguments");
    }
    return status.run(common);
}

function dispatchNextFile(
    positionals: string[],
    options: Options,
    common: Common,
): Promise<string> {
    const type = positionals[0];
    if (type === undefined || positionals.length !== 1) {
        throw new UsageError("next-file requires exactly one type");
    }
    return nextFile.run(type, {
        ...common,
        phase: typeof options.phase === "string" ? options.phase : undefined,
        step:
            typeof options.step === "string" ? Number(options.step) : undefined,
    });
}

async function dispatchImport(
    positionals: string[],
    options: Options,
    common: CommonOptional,
): Promise<CommandResult> {
    const number = positionals[0];
    if (number === undefined || positionals.length !== 1) {
        throw new UsageError("import requires exactly one issue or PR number");
    }
    const repo = typeof options.repo === "string" ? options.repo : undefined;

    return importCmd.runImport({
        number,
        project: common.project,
        feature: common.feature,
        repo,
    });
}

async function dispatchPlugin(
    positionals: string[],
    options: Options,
): Promise<CommandResult> {
    const action = singleAction("plugin", positionals);
    switch (action) {
        case "install":
            return plugin.runInstall({ release: optional(options, "release") });
        case "init":
            return plugin.runInit({
                agent: required(options, "agent"),
                copy: options.copy === true,
                symlink: options.symlink === true,
                force: options.force === true,
            });
        case "status":
            return plugin.runStatus();
        case "update":
            return plugin.runUpdate({
                release: optional(options, "release"),
                force: options.force === true,
            });
        case "remove":
            return plugin.runRemove({
                agent: required(options, "agent"),
                force: options.force === true,
            });
        default:
            throw new UsageError(`Unknown plugin action "${action}"`);
    }
}

function singleAction(command: string, positionals: string[]): string {
    const action = positionals[0];
    if (action === undefined || positionals.length !== 1) {
        throw new UsageError(`${command} requires exactly one action`);
    }
    return action;
}

function dispatchDecision(
    positionals: string[],
    options: Options,
    common: Common,
): Promise<CommandResult | string> {
    const action = singleAction("decision", positionals);
    switch (action) {
        case "add":
            return decision.add({ ...common, text: required(options, "text") });
        case "read":
            return decision.read(common);
        default:
            throw new UsageError(`Unknown decision action "${action}"`);
    }
}

function dispatchHistory(
    positionals: string[],
    options: Options,
    common: Common,
): Promise<CommandResult | unknown[]> {
    const action = singleAction("history", positionals);
    switch (action) {
        case "add":
            return history.add({ ...common, text: required(options, "text") });
        case "read": {
            if (options.all === true && options.tail !== undefined) {
                throw new UsageError(
                    "history read cannot combine --all and --tail",
                );
            }
            return history.read({
                ...common,
                tail:
                    typeof options.tail === "string"
                        ? Number(options.tail)
                        : undefined,
                all: options.all === true,
                kind:
                    typeof options.kind === "string" ? options.kind : undefined,
                phase:
                    typeof options.phase === "string"
                        ? options.phase
                        : undefined,
            });
        }
        default:
            throw new UsageError(`Unknown history action "${action}"`);
    }
}

function dispatchStart(
    positionals: string[],
    options: Options,
    common: Common,
): Promise<CommandResult> {
    const action = singleAction("start", positionals);
    const task = {
        ...common,
        phase: required(options, "phase"),
        loop: options.loop === true,
        base: typeof options.base === "string" ? options.base : undefined,
    };
    switch (action) {
        case "implement":
            return start.implement(task);
        case "review":
            return start.review(task);
        case "repair":
            return start.repair(task);
        default:
            throw new UsageError(`Unknown start action "${action}"`);
    }
}

function dispatchLog(
    positionals: string[],
    options: Options,
    common: Common,
): Promise<CommandResult> {
    const action = singleAction("log", positionals);
    switch (action) {
        case "implement":
            return log.implement({
                ...common,
                phase: required(options, "phase"),
                reason: optional(options, "reason"),
            });
        case "repair":
            return log.repair({
                ...common,
                phase: required(options, "phase"),
                reason: optional(options, "reason"),
            });
        case "review":
            return log.review({ ...common, label: required(options, "label") });
        case "park":
            return log.park({ ...common, reason: optional(options, "reason") });
        default:
            throw new UsageError(`Unknown log action "${action}"`);
    }
}

async function dispatchLoop(
    positionals: string[],
    common: Common,
): Promise<CommandResult> {
    const action = positionals[0];
    const arg = positionals[1];
    switch (action) {
        case "start": {
            if (arg === undefined || positionals.length !== 2) {
                throw new UsageError(
                    "loop start requires exactly one selector",
                );
            }
            return loop.start({ ...common, selector: arg });
        }
        case "advance": {
            if (positionals.length !== 1) {
                throw new UsageError("loop advance takes no arguments");
            }
            return loop.advance(common);
        }
        case "stop": {
            if (arg === undefined || positionals.length !== 2) {
                throw new UsageError("loop stop requires exactly one reason");
            }
            return loop.stop({ ...common, reason: arg });
        }
        case "ok": {
            if (positionals.length > 2) {
                throw new UsageError("loop ok takes at most one reason");
            }
            return loop.loopOk({ ...common, reason: arg });
        }
        case "abandon": {
            if (arg === undefined || positionals.length !== 2) {
                throw new UsageError(
                    "loop abandon requires exactly one reason",
                );
            }
            return loop.abandon({ ...common, reason: arg });
        }
        default:
            throw new UsageError(`Unknown loop action "${action ?? ""}"`);
    }
}

function optional(options: Options, name: string): string | undefined {
    return typeof options[name] === "string" ? options[name] : undefined;
}

function version(): string {
    return typeof __QRSPI_VERSION__ === "string"
        ? __QRSPI_VERSION__
        : "0.0.0-dev";
}
