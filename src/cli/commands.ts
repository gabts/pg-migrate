import { events } from "../logging/events.js";
import type { Logger } from "../logging/logger.js";
import type { LogSink } from "../logging/writers.js";
import {
  down,
  status,
  up,
  validate,
  type MigrationStatusResult,
} from "../main.js";
import { createMigration } from "../migrations/create.js";
import type { CommandName, ParsedTokens } from "./args.js";
import {
  buildCreateOptions,
  buildDatabaseRunOptions,
  buildMigrationRunOptions,
} from "./options.js";
import type { CliResultWriter } from "./output.js";

interface CliRuntimeOptions {
  correlationId: string;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
}

/**
 * Handlers used to execute command side effects.
 */
export interface CommandHandlers {
  createMigration: typeof createMigration;
  down: typeof down;
  status: typeof status;
  up: typeof up;
  validate: typeof validate;
}

const defaultCommandHandlers: CommandHandlers = {
  createMigration,
  down,
  status,
  up,
  validate,
};

function formatStatusResult(result: MigrationStatusResult): string {
  const current = result.current?.file ?? "(none)";
  const next = result.next?.file ?? "(none)";
  const maxNameLength = Math.max(
    0,
    ...result.migrations.map(({ name }): number => name.length),
  );
  const lines = [
    `Table: ${result.table}`,
    `Directory: ${result.directory}`,
    `Initialized: ${result.initialized}`,
    `Current: ${current}`,
    `Next: ${next}`,
    `Applied: ${result.summary.applied}`,
    `Pending: ${result.summary.pending}`,
    `Total: ${result.summary.total}`,
  ];

  if (result.migrations.length > 0) {
    lines.push(
      "",
      ...result.migrations.map((migration): string => {
        const appliedAt = migration.appliedAt ?? "-";
        const name = migration.name.padEnd(maxNameLength);
        return `${migration.state.padEnd(7)} ${migration.version} ${name} ${appliedAt}`;
      }),
    );
  }

  return lines.join("\n");
}

/**
 * Runs a parsed CLI command and writes the command result.
 */
export async function runCommand(
  command: CommandName,
  parsed: ParsedTokens,
  extraPositional: readonly string[],
  resultWriter: CliResultWriter,
  logger: Logger,
  logSink: LogSink,
  runtime: CliRuntimeOptions,
  handlers: CommandHandlers = defaultCommandHandlers,
): Promise<number> {
  if (command === "create") {
    const options = await buildCreateOptions(parsed, extraPositional);

    logger.emit(
      events.commandOptions({
        command: "create",
        directory: options.directory,
        name: options.name ?? null,
      }),
    );

    const filePath = await handlers.createMigration(options);

    if (runtime.json) {
      resultWriter.writeJson({
        command: "create",
        file: filePath,
      });
    } else {
      resultWriter.writeText(filePath);
    }

    return 0;
  }

  if (command === "validate") {
    const runOptions = await buildDatabaseRunOptions(
      parsed,
      extraPositional,
      command,
    );

    await handlers.validate(runOptions.clientConfig, {
      directory: runOptions.directory,
      logSink,
      quiet: runtime.quiet,
      correlationId: runtime.correlationId,
      table: runOptions.table,
      verbose: runtime.verbose,
    });

    if (runtime.json) {
      resultWriter.writeJson({
        command,
        ok: true,
      });
    }

    return 0;
  }

  if (command === "status") {
    const runOptions = await buildDatabaseRunOptions(
      parsed,
      extraPositional,
      command,
    );

    const result = await handlers.status(runOptions.clientConfig, {
      directory: runOptions.directory,
      logSink,
      quiet: runtime.quiet,
      correlationId: runtime.correlationId,
      table: runOptions.table,
      verbose: runtime.verbose,
    });

    if (runtime.json) {
      resultWriter.writeJson({
        command,
        ok: true,
        ...result,
      });
    } else {
      resultWriter.writeText(formatStatusResult(result));
    }

    return 0;
  }

  const runOptions = await buildMigrationRunOptions(
    parsed,
    extraPositional,
    command,
  );
  const runFn = command === "up" ? handlers.up : handlers.down;

  await runFn(runOptions.clientConfig, {
    directory: runOptions.directory,
    dryRun: runOptions.dryRun,
    logSink,
    quiet: runtime.quiet,
    correlationId: runtime.correlationId,
    table: runOptions.table,
    target: runOptions.target,
    verbose: runtime.verbose,
  });

  if (runtime.json) {
    resultWriter.writeJson({
      command,
      dryRun: runOptions.dryRun,
      ok: true,
      target: runOptions.target ?? null,
    });
  }

  return 0;
}
