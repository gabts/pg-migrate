import * as fs from "fs";
import * as path from "path";
import {
  migrationFilePattern,
  parseMigrationIndex,
  POSTGRES_MAX_INDEX,
} from "./migration-files.js";

const helpText = `Usage: migratorosaurus <command> [options]

Commands:
  create            Create a new migration file

Run "migratorosaurus <command> --help" for command-specific usage.
`;

const createHelpText = `Usage: migratorosaurus create --name <migration-name> [options]

Options:
  -n, --name       Migration name, letters/numbers/_/-
  -d, --directory  Target directory, defaults to migrations
  -p, --pad-width  Zero-pad index width, 0-7, defaults to 3
  -h, --help       Show this help text
`;

interface CreateOptions {
  directory: string;
  padWidth: number;
  name?: string;
}

function showHelp(text: string): never {
  process.stdout.write(text);
  process.exit(0);
}

function getFlagValue(
  label: string,
  flags: string,
  args: string[],
  index: number,
): string {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${label} flag (${flags}) requires a value`);
  }
  return value;
}

function parseCreateArgs(args: string[]): CreateOptions {
  const opts: CreateOptions = {
    directory: "migrations",
    padWidth: 3,
  };

  if (args.slice(3).includes("-h") || args.slice(3).includes("--help")) {
    showHelp(createHelpText);
  }

  let i = 3;

  while (i < args.length) {
    switch (args[i]) {
      case "-d":
      case "--directory":
        opts.directory = getFlagValue("Directory", "--directory, -d", args, i);
        i += 2;
        break;
      case "-n":
      case "--name":
        opts.name = getFlagValue("Name", "--name, -n", args, i).replace(
          /\.sql$/,
          "",
        );
        i += 2;
        break;
      case "-p":
      case "--pad-width": {
        const padWidthValue = getFlagValue(
          "Pad width",
          "--pad-width, -p",
          args,
          i,
        );

        if (!padWidthValue.match(/^(0|[1-9][0-9]*)$/)) {
          throw new Error(
            "Pad width flag (--pad-width, -p) must be an integer from 0 to 7",
          );
        }

        const padWidth = Number.parseInt(padWidthValue, 10);

        if (!Number.isInteger(padWidth) || padWidth < 0 || padWidth > 7) {
          throw new Error(
            "Pad width flag (--pad-width, -p) must be an integer from 0 to 7",
          );
        }

        opts.padWidth = padWidth;
        i += 2;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  return opts;
}

function createMigration(args: string[]): void {
  const opts = parseCreateArgs(args);

  if (!opts.name) {
    throw new Error("Name flag (--name, -n) is required");
  }

  if (!opts.name.match(/^[A-Za-z0-9_-]+$/)) {
    throw new Error("Migration name may only use letters, numbers, _ and -");
  }

  if (
    !fs.existsSync(opts.directory) ||
    !fs.statSync(opts.directory).isDirectory()
  ) {
    throw new Error(`Migration directory does not exist: ${opts.directory}`);
  }

  let index = 1;
  const files = fs.readdirSync(opts.directory);
  const sqlFiles = files.filter((file): boolean => file.endsWith(".sql"));

  const invalidFile = sqlFiles.find(
    (file): boolean => !file.match(migrationFilePattern),
  );

  if (invalidFile) {
    throw new Error(`Invalid migration file name: ${invalidFile}`);
  }

  for (const file of sqlFiles) {
    const fileIndex = parseMigrationIndex(file);
    if (fileIndex >= index) {
      index = fileIndex + 1;
    }
  }

  if (index > POSTGRES_MAX_INDEX) {
    throw new Error(
      `Next migration index ${index} exceeds PostgreSQL integer range`,
    );
  }

  const indexString =
    opts.padWidth === 0
      ? String(index)
      : String(index).padStart(opts.padWidth, "0");
  const filePath = path.join(opts.directory, `${indexString}-${opts.name}.sql`);
  const fileContent = "-- % up-migration % --\n\n-- % down-migration % --\n";

  fs.writeFileSync(filePath, fileContent, { flag: "wx" });
  process.stdout.write(`${filePath}\n`);
}

export function cli(args = process.argv): void {
  const command = args[2];

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
      showHelp(helpText);
      break;
    case "create":
      createMigration(args);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
