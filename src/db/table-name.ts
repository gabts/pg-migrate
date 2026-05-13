interface TableNameParts {
  schema?: string;
  table: string;
}

const conventionalTableNamePattern =
  /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;

/**
 * Parses and validates the configured migration history table name.
 */
export function parseTableName(tableName: string): TableNameParts {
  if (!tableName.match(conventionalTableNamePattern)) {
    throw new Error(
      `Invalid migration table name: ${tableName}. Must be lowercase with underscores (e.g. schema_migrations or schema_name.table_name)`,
    );
  }

  const parts = tableName.split(".");
  const [firstPart, secondPart] = parts;

  if (!secondPart) {
    return {
      table: firstPart!,
    };
  }

  return {
    schema: firstPart!,
    table: secondPart,
  };
}

/**
 * Quotes table-name parts for safe interpolation into SQL identifiers.
 */
export function qualifyTableName({ schema, table }: TableNameParts): string {
  return schema ? `"${schema}"."${table}"` : `"${table}"`;
}
