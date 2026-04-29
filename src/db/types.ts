import type * as pg from "pg";

/**
 * Allowed database client configuration inputs.
 */
export type ClientConfig = string | pg.ClientConfig;
