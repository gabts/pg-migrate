import * as util from "node:util";
import type { ParsedArgs } from "./model.js";

const optionsDescriptors = {
  config: {
    type: "string",
    short: "c",
  },
  directory: {
    type: "string",
    short: "d",
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

/** Parses raw CLI arguments into positionals and option values. */
export function parseArgs(args: string[]): ParsedArgs {
  try {
    return util.parseArgs({
      args,
      options: optionsDescriptors,
      allowPositionals: true,
    });
  } catch (error) {
    throw firstSentenceOf(error);
  }
}
