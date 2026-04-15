import * as assert from "assert";
import { messages } from "./log-messages.js";

describe("log-messages", (): void => {
  describe("lifecycle", (): void => {
    it("formats migration-run lifecycle", (): void => {
      assert.equal(messages.startedUp(), "🦖 started migration run");
      assert.equal(messages.completedUp(), "🌋 migration run complete");
      assert.equal(messages.abortedUp(), "☄️ migration run aborted");
    });

    it("formats rollback lifecycle", (): void => {
      assert.equal(messages.startedDown(), "🦖 started rollback");
      assert.equal(messages.completedDown(), "🌋 rollback complete");
      assert.equal(messages.abortedDown(), "☄️ rollback aborted");
    });

    it("formats session and no-op messages", (): void => {
      assert.equal(
        messages.creatingTable(),
        "🥚 creating migration history table",
      );
      assert.equal(
        messages.nothingToRollback(),
        "- no migrations to roll back",
      );
      assert.equal(
        messages.failureRolledBack(),
        "🦴 current migration rolled back",
      );
    });
  });

  describe("metadata", (): void => {
    it("formats pending migration count", (): void => {
      assert.equal(messages.pending(0), "🧬 pending migrations: 0");
      assert.equal(messages.pending(2), "🧬 pending migrations: 2");
    });

    it("formats target version with quoted name and strips .sql", (): void => {
      assert.equal(
        messages.target("0-create.sql"),
        '- target version: "0-create"',
      );
    });
  });

  describe("per-step", (): void => {
    it("formats applying with a quoted, .sql-stripped name", (): void => {
      assert.equal(
        messages.applying("0-create.sql"),
        '↑ applying "0-create" (up)',
      );
    });

    it("formats applied with timing", (): void => {
      assert.equal(
        messages.applied("0-create.sql", 41),
        '✓ applied "0-create" in 41ms',
      );
    });

    it("formats reverting with and without a down section", (): void => {
      assert.equal(
        messages.reverting("0-create.sql", true),
        '↓ reverting "0-create" (down)',
      );
      assert.equal(
        messages.reverting("0-backfill.sql", false),
        '↓ reverting "0-backfill" (down, no SQL)',
      );
    });

    it("formats reverted with timing", (): void => {
      assert.equal(
        messages.reverted("1-insert.sql", 18),
        '⟲ reverted "1-insert" in 18ms',
      );
    });

    it("formats failed with timing", (): void => {
      assert.equal(
        messages.failed("2-break.sql", 228),
        '✗ failed "2-break" after 228ms',
      );
    });
  });

  describe("errorDetails", (): void => {
    it("includes sqlstate when the error has a .code", (): void => {
      const error = Object.assign(new Error("duplicate key"), {
        code: "23505",
      });
      assert.equal(
        messages.errorDetails(error),
        '☄️ sqlstate=23505 message="duplicate key"',
      );
    });

    it("omits sqlstate when the error has no .code", (): void => {
      assert.equal(
        messages.errorDetails(new Error("runner failed")),
        '☄️ message="runner failed"',
      );
    });

    it("escapes double quotes in the message", (): void => {
      assert.equal(
        messages.errorDetails(new Error('bad "thing"')),
        '☄️ message="bad \\"thing\\""',
      );
    });

    it("escapes newlines so multi-line errors stay on one log line", (): void => {
      assert.equal(
        messages.errorDetails(new Error("line one\nline two")),
        '☄️ message="line one\\nline two"',
      );
    });

    it("stringifies non-Error values", (): void => {
      assert.equal(
        messages.errorDetails("plain string"),
        '☄️ message="plain string"',
      );
    });
  });
});
