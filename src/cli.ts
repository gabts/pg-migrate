import { randomUUID } from "crypto";
import {
  assertValidTokens,
  commandName,
  parseTokens,
  type CommandName,
} from "./cli/args.js";
import { createLogger, type Logger } from "./logging/logger.js";
import { createCliLogWriter, createCliResultWriter } from "./cli/output.js";
import { events } from "./logging/events.js";
import { writeHelp } from "./cli/help.js";
import { runCommand } from "./cli/commands.js";

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Executes the CLI command and returns the process exit code.
 */
export async function cli(args = process.argv): Promise<number> {
  const tokens = args.slice(2);
  const parsed = parseTokens(tokens);

  const { globals } = parsed;

  const resultWriter = createCliResultWriter(process.stdout);
  const logSink = createCliLogWriter(process.stderr, {
    color: globals.color,
    json: globals.json,
  });

  const json = globals.json;
  const correlationId = randomUUID();
  let currentCommand: CommandName | null = null;
  const logger: Logger = createLogger({
    quiet: globals.quiet,
    correlationId,
    sink: logSink,
    verbose: globals.verbose,
  });

  try {
    const command = commandName(parsed);
    if (
      parsed.validationIssues.length === 0 &&
      (parsed.command === undefined || command !== undefined)
    ) {
      currentCommand = command ?? null;
    }

    assertValidTokens(parsed);

    if (parsed.help) {
      writeHelp(resultWriter, command, globals.json);
      return 0;
    }

    if (command === undefined) {
      writeHelp(resultWriter, command, globals.json);
      return 0;
    }

    return await runCommand(
      command,
      parsed,
      parsed.extraPositional,
      resultWriter,
      logger,
      logSink,
      {
        json: globals.json,
        quiet: globals.quiet,
        correlationId,
        verbose: globals.verbose,
      },
    );
  } catch (error) {
    logger.emit(events.commandFailed({ command: currentCommand, error }));
    if (json) {
      resultWriter.writeJson({
        command: currentCommand,
        error: formatErrorMessage(error),
        ok: false,
      });
    }
    return 1;
  }
}
