import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHelpText } from "./help.js";

describe("help", (): void => {
  it("shows general usage and every command", (): void => {
    const help = getHelpText("help");

    assert.match(help, /pg-migrate <command> \[arguments\] \[options\]/);
    for (const command of ["create", "status", "validate", "up", "down"]) {
      assert.match(help, new RegExp(`\\b${command}\\b`));
    }
    assert.match(help, /-c, --config <path>/);
    assert.match(help, /-d, --directory <path>/);
    assert.match(help, /-q, --quiet/);
    assert.match(help, /-v, --verbose/);
    assert.match(help, /Command output, when present, goes to stdout\./);
    assert.match(help, /command header, completion messages, and errors/i);
    assert.match(help, /--verbose also shows phase progress/i);
    assert.match(help, /--quiet suppresses normal command output/i);
    assert.doesNotMatch(help, /goes here|not implemented/i);
  });

  it("shows create arguments, behavior, and output", (): void => {
    const help = getHelpText("create");

    assert.match(help, /pg-migrate create <name> \[options\]/);
    assert.match(help, /<YYYYMMDDHHMMSS>_<name>\.sql/);
    assert.match(help, /migrate:up and migrate:down/);
    assert.match(help, /created file path goes to stdout/i);
    assert.match(help, /command header and completion message go to stderr/i);
    assert.match(help, /--verbose also shows phase progress/i);
    assert.match(help, /--quiet suppresses normal command output/i);
    assert.match(help, /-q, --quiet/);
    assert.match(help, /-v, --verbose/);
    assert.doesNotMatch(help, /--url|--table|--target/);
  });

  it("shows read-only status behavior", (): void => {
    const help = getHelpText("status");

    assert.match(help, /pg-migrate status \[options\]/);
    assert.match(help, /does not create a missing history table/i);
    assert.match(help, /does not acquire the migration advisory lock/i);
    assert.match(help, /validates all migration file names, checksums/i);
    assert.match(help, /does not decode or validate migration file contents/i);
    assert.match(help, /Migration states and counts go to stdout/);
    assert.match(help, /command header and errors go to stderr/i);
    assert.match(help, /--verbose also shows phase progress/i);
    assert.match(help, /--quiet suppresses normal command output/i);
    assert.match(help, /-q, --quiet/);
    assert.match(help, /-v, --verbose/);
    assert.doesNotMatch(help, /--target/);
  });

  it("shows validation requirements", (): void => {
    const help = getHelpText("validate");

    assert.match(help, /pg-migrate validate \[options\]/);
    assert.match(help, /checks UTF-8 encoding and marker structure/i);
    assert.match(help, /does not ask PostgreSQL to parse or execute/i);
    assert.match(help, /missing history table is treated as empty history/i);
    assert.match(help, /is not created/i);
    assert.match(help, /continuous sequence/);
    assert.match(help, /filenames and checksums must match/i);
    assert.match(help, /waits for the migration advisory lock/);
    assert.match(help, /Validation confirmation and migration counts/);
    assert.match(help, /command header and errors go to stderr/i);
    assert.match(help, /--verbose also shows phase progress/i);
    assert.match(help, /--quiet suppresses normal command output/i);
    assert.match(help, /-q, --quiet/);
    assert.match(help, /-v, --verbose/);
    assert.doesNotMatch(help, /--target/);
  });

  it("shows up target behavior", (): void => {
    const help = getHelpText("up");

    assert.match(help, /pg-migrate up \[options\]/);
    assert.match(help, /including the target/);
    assert.match(help, /applies all pending migrations/);
    assert.match(help, /checks UTF-8 encoding and marker structure/i);
    assert.match(help, /filenames and checksums must match/i);
    assert.match(
      help,
      /creates a missing history table before the first migration/i,
    );
    assert.match(help, /migration count goes to stdout/i);
    assert.match(help, /empty plan leaves stdout empty/i);
    assert.match(help, /command header, completion messages, and errors/i);
    assert.match(help, /--verbose also shows phase progress/i);
    assert.match(help, /--quiet suppresses normal command output/i);
    assert.match(help, /-q, --quiet/);
    assert.match(help, /-v, --verbose/);
    assert.doesNotMatch(help, /JSON/);
  });

  it("shows down target behavior", (): void => {
    const help = getHelpText("down");

    assert.match(help, /pg-migrate down \[options\]/);
    assert.match(help, /target remains applied/);
    assert.match(help, /checks UTF-8 encoding and marker structure/i);
    assert.match(help, /empty migrate:down section runs no migration SQL/i);
    assert.match(help, /removes only the migration history row/i);
    assert.match(help, /does not restore data or reverse schema changes/i);
    assert.match(help, /later up runs the original up section again/i);
    assert.match(help, /filenames and checksums must match/i);
    assert.match(help, /reverse version order/);
    assert.match(help, /migration count goes to stdout/i);
    assert.match(help, /empty plan leaves stdout empty/i);
    assert.match(help, /command header, completion messages, and errors/i);
    assert.match(help, /--verbose also shows phase progress/i);
    assert.match(help, /--quiet suppresses normal command output/i);
    assert.match(help, /-q, --quiet/);
    assert.match(help, /-v, --verbose/);
    assert.doesNotMatch(help, /JSON/);
  });
});
