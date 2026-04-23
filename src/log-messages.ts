function displayName(file: string): string {
  return file.replace(/\.sql$/, "");
}

function dryRunSuffix(dryRun?: boolean): string {
  return dryRun ? " (dry run)" : "";
}

export const messages = {
  startedUp: (dryRun?: boolean): string => {
    return `🦖 started migration run${dryRunSuffix(dryRun)}`;
  },
  startedDown: (dryRun?: boolean): string => {
    return `🦖 started rollback${dryRunSuffix(dryRun)}`;
  },
  startedValidate: (): string => {
    return "🦖 started validation";
  },
  completedUp: (): string => {
    return "🌋 migration run complete";
  },
  completedDown: (): string => {
    return "🌋 rollback complete";
  },
  completedValidate: (): string => {
    return "🌋 validation complete";
  },
  abortedUp: (): string => {
    return "☄️ migration run aborted";
  },
  abortedDown: (): string => {
    return "☄️ rollback aborted";
  },
  abortedValidate: (): string => {
    return "☄️ validation aborted";
  },
  nothingToRollback: (): string => {
    return "- no migrations to roll back";
  },
  failureRolledBack: (): string => {
    return "🦴 current migration rolled back";
  },
  creatingTable: (): string => {
    return "🥚 creating migration history table";
  },
  pending: (count: number): string => {
    return `🧬 pending migrations: ${count}`;
  },
  validationSummary: (
    pendingUpCount: number,
    rollbackableDownCount: number,
    nextDownCount: number,
  ): string => {
    return `🧪 validation summary: pending_up=${pendingUpCount} rollbackable_down=${rollbackableDownCount} next_down=${nextDownCount}`;
  },
  target: (file: string): string => {
    return `- target version: "${displayName(file)}"`;
  },
  applying: (file: string): string => {
    return `↑ applying "${displayName(file)}" (up)`;
  },
  applied: (file: string, ms: number): string => {
    return `✓ applied "${displayName(file)}" in ${ms}ms`;
  },
  reverting: (file: string, hasSql: boolean): string => {
    return `↓ reverting "${displayName(file)}" (down${hasSql ? "" : ", no SQL"})`;
  },
  reverted: (file: string, ms: number): string => {
    return `⟲ reverted "${displayName(file)}" in ${ms}ms`;
  },
  failed: (file: string, ms: number): string => {
    return `✗ failed "${displayName(file)}" after ${ms}ms`;
  },
  errorDetails: (error: unknown): string => {
    const parts: string[] = ["☄️"];
    const code = (error as { code?: unknown })?.code;
    if (code !== undefined && code !== null && code !== "") {
      parts.push(`sqlstate=${String(code)}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    parts.push(`message=${JSON.stringify(message)}`);
    return parts.join(" ");
  },
};
