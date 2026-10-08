import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Args } from "./model.js";
import { validateInvocation } from "./validate.js";

function helpTopic(positionals: string[], values: Args): string | undefined {
  const result = validateInvocation({ positionals, values });
  return result.command === "help" ? result.topic : undefined;
}

describe("validate", (): void => {
  it("returns a valid create invocation", (): void => {
    assert.deepEqual(
      validateInvocation({
        positionals: ["create", "add_users"],
        values: { directory: "db/migrations" },
      }),
      {
        command: "create",
        name: "add_users",
        values: { directory: "db/migrations" },
      },
    );
  });

  it("accepts verbose for all commands", (): void => {
    assert.doesNotThrow(() =>
      validateInvocation({
        positionals: ["create", "add_users"],
        values: { verbose: true },
      }),
    );
    assert.doesNotThrow(() =>
      validateInvocation({
        positionals: ["status"],
        values: { verbose: true },
      }),
    );
  });

  it("accepts quiet for all commands", (): void => {
    assert.doesNotThrow(() =>
      validateInvocation({
        positionals: ["create", "add_users"],
        values: { quiet: true },
      }),
    );
    assert.doesNotThrow(() =>
      validateInvocation({
        positionals: ["status"],
        values: { quiet: true },
      }),
    );
  });

  it("returns a valid migration invocation", (): void => {
    assert.deepEqual(
      validateInvocation({
        positionals: ["up"],
        values: { target: "20260811120000" },
      }),
      {
        command: "up",
        values: { target: "20260811120000" },
      },
    );
  });

  it("returns a valid repair invocation", (): void => {
    assert.deepEqual(
      validateInvocation({
        positionals: ["repair", "20260811120000"],
        values: { table: "app.schema_migrations" },
      }),
      {
        command: "repair",
        target: "20260811120000",
        values: { table: "app.schema_migrations" },
      },
    );
  });

  it("rejects an unknown command", (): void => {
    assert.throws(
      () => validateInvocation({ positionals: ["bogus"], values: {} }),
      new Error("Unknown command 'bogus'."),
    );
  });

  it("rejects missing required positionals", (): void => {
    assert.throws(
      () => validateInvocation({ positionals: ["create"], values: {} }),
      new Error("Missing required argument 'name'."),
    );
    assert.throws(
      () => validateInvocation({ positionals: ["repair"], values: {} }),
      new Error("Missing required argument 'target'."),
    );
  });

  it("rejects extra positionals", (): void => {
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["create", "add_users", "extra"],
          values: {},
        }),
      new Error("Unexpected positional 'extra'."),
    );
    assert.throws(
      () =>
        validateInvocation({ positionals: ["status", "extra"], values: {} }),
      new Error("Unexpected positional 'extra'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["repair", "20260811120000", "20260811130000"],
          values: {},
        }),
      new Error("Unexpected positional '20260811130000'."),
    );
  });

  it("rejects options the command does not accept", (): void => {
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["create", "add_users"],
          values: { url: "postgres://localhost/app" },
        }),
      new Error("Unknown option '--url'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["status"],
          values: { target: "x" },
        }),
      new Error("Unknown option '--target'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["repair", "20260811120000"],
          values: { target: "20260811120000" },
        }),
      new Error("Unknown option '--target'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["validate"],
          values: { "fail-on-pending": true },
        }),
      new Error("Unknown option '--fail-on-pending'."),
    );
  });

  it("accepts the pending flag for status", (): void => {
    assert.deepEqual(
      validateInvocation({
        positionals: ["status"],
        values: { "fail-on-pending": true },
      }),
      { command: "status", values: { "fail-on-pending": true } },
    );
  });

  it("returns the help topic for a help request", (): void => {
    assert.equal(helpTopic([], {}), "help");
    assert.equal(helpTopic(["help", "up"], {}), "up");
    assert.equal(
      helpTopic(["up"], { help: true, url: "postgres://x/db" }),
      "up",
    );
    // Help for create and repair does not require their arguments.
    assert.equal(helpTopic(["create"], { help: true }), "create");
    assert.equal(helpTopic(["repair"], { help: true }), "repair");
    assert.equal(
      helpTopic(["repair", "20260811120000"], { help: true }),
      "repair",
    );
  });

  it("rejects an unknown help topic before its options", (): void => {
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["help", "bogus"],
          values: { url: "postgres://x/db" },
        }),
      new Error("Unknown command 'bogus'."),
    );
    assert.throws(
      () =>
        validateInvocation({ positionals: ["bogus"], values: { help: true } }),
      new Error("Unknown command 'bogus'."),
    );
  });

  it("rejects arguments the help topic does not accept", (): void => {
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["help", "up", "extra"],
          values: {},
        }),
      new Error("Unexpected positional 'extra'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["status", "extra"],
          values: { help: true },
        }),
      new Error("Unexpected positional 'extra'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: ["repair", "20260811120000", "extra"],
          values: { help: true },
        }),
      new Error("Unexpected positional 'extra'."),
    );
    assert.throws(
      () =>
        validateInvocation({
          positionals: [],
          values: { help: true, url: "x" },
        }),
      new Error("Unknown option '--url'."),
    );
  });

  it("rejects options without a command or a help request", (): void => {
    for (const values of [{ quiet: true }, { url: "x" }]) {
      assert.throws(
        () => validateInvocation({ positionals: [], values }),
        new Error("Missing required argument 'command'."),
      );
    }
    assert.equal(helpTopic([], { help: true, quiet: true }), "help");
  });
});
