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

// Use colors only when stderr supports them and the flag permits them.
// hasColors also uses NO_COLOR and FORCE_COLOR. Read the flag before
// parsing so it also applies to parse errors.
function useColors(args: string[]): boolean {
  return (
    !args.includes("--no-color") &&
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
  const args = argv.slice(2);
  const colors = useColors(args);
  const progress = createProgressOutput(process.stderr, colors);
  let migrationFailed = false;
  let quiet = false;
  let verbose = false;
  const first = args[0];
  let helpCommand: Command | "help" | undefined = isCommand(first)
    ? first
    : "help";
  try {
    const parsedResult = parseArgs(args);
    if ("help" in parsedResult) {
      process.stdout.write(getHelpText(parsedResult.help) + "\n");
      return;
    }

    const parsed = parsedResult.invocation;
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
