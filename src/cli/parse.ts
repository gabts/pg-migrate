import * as util from "node:util";
import { isCommand, type Command, type ParsedArgs } from "./model.js";

type ParseResult = { help: Command | "help" } | { invocation: ParsedArgs };

const optionsDescriptors = {
  config: {
    type: "string",
    short: "c",
  },
  directory: {
    type: "string",
    short: "d",
  },
  help: {
    type: "boolean",
    short: "h",
  },
  "no-color": {
    type: "boolean",
  },
  quiet: {
    type: "boolean",
    short: "q",
  },
  table: {
    type: "string",
    short: "t",
  },
  target: {
    type: "string",
  },
  url: {
    type: "string",
    short: "u",
  },
  verbose: {
    type: "boolean",
    short: "v",
  },
} as const satisfies util.ParseArgsConfig["options"];

function getHelpCommand(
  positionals: string[],
  requested: boolean,
): Command | "help" | null {
  if (!requested) {
    return null;
  }
  const topic = positionals[0];
  return isCommand(topic) ? topic : "help";
}

function parseHelpAfterError(args: string[]): Command | "help" | null {
  const terminator = args.indexOf("--");
  const insertion = terminator === -1 ? args.length : terminator;
  try {
    // The empty value lets parsing finish after an incomplete string option.
    const result = util.parseArgs({
      args: args.toSpliced(insertion, 0, ""),
      options: optionsDescriptors,
      allowPositionals: true,
      strict: false,
    });
    return getHelpCommand(result.positionals, result.values.help === true);
  } catch {
    return null;
  }
}

// util.parseArgs adds an explanation about '--'. Keep only the first
// sentence to use the CLI error style.
function firstSentenceOf(error: unknown): unknown {
  if (
    error instanceof TypeError &&
    "code" in error &&
    String(error.code).startsWith("ERR_PARSE_ARGS")
  ) {
    const [sentence = error.message] = error.message.split(". ");
    return new Error(sentence.endsWith(".") ? sentence : `${sentence}.`);
  }
  return error;
}

/** Parses raw CLI arguments into an invocation or explicit help request. */
export function parseArgs(args: string[]): ParseResult {
  try {
    const result = util.parseArgs({
      args,
      options: optionsDescriptors,
      allowPositionals: true,
    });
    const help = getHelpCommand(
      result.positionals,
      result.values.help === true,
    );
    return help ? { help } : { invocation: result };
  } catch (error) {
    const help = parseHelpAfterError(args);
    if (help) {
      return { help };
    }
    throw firstSentenceOf(error);
  }
}
