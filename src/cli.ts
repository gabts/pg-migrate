import * as fs from "fs";
import * as path from "path";

const helpText = `Usage: migratorosaurus <command> [options]

Commands:
  create            Create a new migration file

Run "migratorosaurus <command> --help" for command-specific usage.
`;

const createHelpText = `Usage: migratorosaurus create --name <migration-name> [options]

Options:
  -n, --name       Migration name
  -d, --directory  Target directory, defaults to migrations
  -h, --help       Show this help text
`;

interface CreateOptions {
  directory: string;
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
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  return opts;
}

function formatTimestamp(date = new Date()): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function createMigration(args: string[]): void {
  const opts = parseCreateArgs(args);

  if (!opts.name) {
    throw new Error("Name flag (--name, -n) is required");
  }

  if (
    opts.name.includes("/") ||
    opts.name.includes("\\") ||
    opts.name.includes("\0")
  ) {
    throw new Error("Migration name may not contain path separators or NUL");
  }

  if (
    !fs.existsSync(opts.directory) ||
    !fs.statSync(opts.directory).isDirectory()
  ) {
    throw new Error(`Migration directory does not exist: ${opts.directory}`);
  }

  const filePath = path.join(
    opts.directory,
    `${formatTimestamp()}_${opts.name}.sql`,
  );
  const fileContent = "-- migrate:up\n\n-- migrate:down\n";

  try {
    fs.writeFileSync(filePath, fileContent, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Migration file already exists: ${filePath}. Another create may have run concurrently.`,
      );
    }
    throw error;
  }
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
