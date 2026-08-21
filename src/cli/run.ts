import { migrate, rollback, status, validate } from "../main.js";
import { create } from "./create.js";
import {
  formatError,
  formatFailureCause,
  formatMigrate,
  formatStatus,
  formatValidation,
} from "./format.js";
import { getHelpText } from "./help.js";
import {
  isCommand,
  type CliLogSink,
  type Command,
  type ResolvedInvocation,
} from "./model.js";
import { parseArgs } from "./parse.js";
import { createProgressOutput } from "./progress.js";
import { resolveInvocation } from "./resolve.js";
import { validateInvocation } from "./validate.js";

// GNU rules give a help request priority over all errors. Read the flag
// before parsing to include parse errors. Arguments after '--' cannot
// request help. Use the first non-option argument as the help topic.
function findHelpFlag(args: string[]): Command | "help" | null {
  const end = args.indexOf("--");
  const scanned = end === -1 ? args : args.slice(0, end);
  if (!scanned.includes("--help") && !scanned.includes("-h")) {
    return null;
  }
  const topic = scanned.find((arg) => !arg.startsWith("-"));
  return isCommand(topic) ? topic : "help";
}

// Use colors only when stderr supports them and the flag permits them.
// hasColors also uses NO_COLOR and FORCE_COLOR. Read the flag before
// parsing so it also applies to parse errors.
function useColors(argv: string[]): boolean {
  return (
    !argv.includes("--no-color") &&
    process.stderr.isTTY === true &&
    process.stderr.hasColors()
  );
}

async function executeInvocation(
  invocation: ResolvedInvocation,
  log: CliLogSink,
): Promise<string | undefined> {
  switch (invocation.command) {
    case "create": {
      return create({ ...invocation.options, log });
    }
    case "status":
      return formatStatus(await status({ ...invocation.options, log }));
    case "validate":
      return formatValidation(await validate({ ...invocation.options, log }));
    case "up":
      return formatMigrate(await migrate({ ...invocation.options, log }), "up");
    case "down":
      return formatMigrate(
        await rollback({ ...invocation.options, log }),
        "down",
      );
  }
}

/**
 * CLI entry point: runs the invocation and converts any error into a stderr
 * message and exit code 1.
 */
export async function run(
  argv = process.argv,
  env = process.env,
): Promise<void> {
  const colors = useColors(argv);
  const progress = createProgressOutput(process.stderr, colors);
  let migrationFailed = false;
  let quiet = false;
  let verbose = false;
  const first = argv[2];
  let helpCommand: Command | "help" | undefined = isCommand(first)
    ? first
    : "help";
  try {
    const helpFlag = findHelpFlag(argv.slice(2));
    if (helpFlag) {
      process.stdout.write(getHelpText(helpFlag) + "\n");
      return;
    }

    const parsed = parseArgs(argv.slice(2));
    const [command, ...commandPositionals] = parsed.positionals;
    quiet = parsed.values.quiet === true;

    if (!command) {
      if (!quiet) {
        process.stdout.write(getHelpText("help") + "\n");
      }
      return;
    }

    if (command === "help") {
      const topic = isCommand(commandPositionals[0])
        ? commandPositionals[0]
        : "help";
      process.stdout.write(getHelpText(topic) + "\n");
      return;
    }

    const validated = validateInvocation(parsed);
    helpCommand = validated.command;
    verbose = !quiet && validated.values.verbose === true;
    if (!quiet) {
      process.stderr.write(`Running pg-migrate ${validated.command}...\n`);
    }
    const resolved = await resolveInvocation(validated, env);

    helpCommand = undefined;
    const result = await executeInvocation(resolved, (event): undefined => {
      if (event.type === "migration-failed") {
        migrationFailed = true;
      }
      if (!quiet) {
        progress.log(event, verbose);
      }
    });
    progress.stop();
    if (!quiet && result !== undefined) {
      process.stdout.write(result + "\n");
    }
  } catch (error) {
    progress.fail();
    const message = error instanceof Error ? error.message : String(error);
    const formatted =
      migrationFailed && !quiet
        ? formatFailureCause(message, colors)
        : formatError(message, colors, helpCommand);
    process.stderr.write(formatted + "\n");
    process.exitCode = 1;
  }
}
