import * as fs from "node:fs/promises";
import { migrate, repair, rollback, status, validate } from "../main.js";
import { create } from "./create.js";
import {
  formatError,
  formatFailureCause,
  formatHelpHint,
  formatMigrate,
  formatRepair,
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

// Read the flag before parsing so it also applies to parse errors. A
// terminal's hasColors uses NO_COLOR and FORCE_COLOR.
function useColors(args: string[], env: NodeJS.ProcessEnv): boolean {
  if (args.includes("--no-color")) {
    return false;
  }
  if (process.stderr.isTTY) {
    return process.stderr.hasColors(env);
  }
  // Off a terminal, such as in a CI log, only FORCE_COLOR enables colors.
  // Node enables them for these values and disables them for any other,
  // such as '0' or 'false'.
  const force = env.FORCE_COLOR;
  return force !== undefined && ["", "1", "2", "3", "true"].includes(force);
}

// A reader such as `head` or `grep -q` can exit before it reads all output.
// The rest of the output is then not needed, but the write error would crash
// the process, even partway through a migration.
function ignoreClosedReader(error: NodeJS.ErrnoException): void {
  if (error.code !== "EPIPE") {
    throw error;
  }
}

// package.json is two levels up from both src/cli and dist/cli.
async function readVersion(): Promise<string> {
  const packageJson = await fs.readFile(
    new URL("../../package.json", import.meta.url),
    "utf8",
  );
  return (JSON.parse(packageJson) as { version: string }).version;
}

async function executeInvocation(
  invocation: ResolvedInvocation,
  log: CliLogSink,
): Promise<string | undefined> {
  switch (invocation.command) {
    case "create": {
      return create({ ...invocation.options, log });
    }
    case "status": {
      const result = await status({ ...invocation.options, log });
      // Exit code 1 is for errors, so a check can tell them apart.
      if (invocation.failOnPending && result.summary.pending > 0) {
        process.exitCode = 2;
      }
      return formatStatus(result);
    }
    case "validate":
      return formatValidation(await validate({ ...invocation.options, log }));
    case "up":
      return formatMigrate(await migrate({ ...invocation.options, log }), "up");
    case "down":
      return formatMigrate(
        await rollback({ ...invocation.options, log }),
        "down",
      );
    case "repair":
      return formatRepair(await repair({ ...invocation.options, log }));
  }
}

/**
 * CLI entry point: runs the invocation and converts any error into a stderr
 * message and exit code 1. `status --fail-on-pending` exits 2 when
 * migrations are pending.
 */
export async function run(
  argv = process.argv,
  env = process.env,
): Promise<void> {
  process.stdout.on("error", ignoreClosedReader);
  process.stderr.on("error", ignoreClosedReader);
  const args = argv.slice(2);
  const colors = useColors(args, env);
  const progress = createProgressOutput(process.stderr, colors);
  let migrationFailed = false;
  let quiet = false;
  let verbose = false;
  const first = args[0];
  let helpCommand: Command | "help" | undefined = isCommand(first)
    ? first
    : "help";
  try {
    const parsed = parseArgs(args);
    quiet = parsed.values.quiet === true;
    const validated = validateInvocation(parsed);
    if (validated.command === "help") {
      process.stdout.write(getHelpText(validated.topic) + "\n");
      return;
    }
    if (validated.command === "version") {
      process.stdout.write((await readVersion()) + "\n");
      return;
    }

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
    const cause = error instanceof Error ? error.cause : undefined;
    const lines: string[] = [];
    // The failed migration's progress line names the file. Only the default
    // output prints it directly above the cause. Verbose output writes
    // rollback and disconnect lines in between.
    if (!migrationFailed || quiet || verbose || cause === undefined) {
      lines.push(formatError(message, colors));
    }
    if (cause !== undefined) {
      lines.push(formatFailureCause(cause, colors));
    }
    if (helpCommand) {
      lines.push(formatHelpHint(helpCommand));
    }
    process.stderr.write(lines.join("\n") + "\n");
    process.exitCode = 1;
  }
}
