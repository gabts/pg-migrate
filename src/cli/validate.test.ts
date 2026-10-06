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
  });

  it("returns the help topic for a help request", (): void => {
    assert.equal(helpTopic([], {}), "help");
    assert.equal(helpTopic(["help", "up"], {}), "up");
    assert.equal(
      helpTopic(["up"], { help: true, url: "postgres://x/db" }),
      "up",
    );
    // Help for create does not require the name.
    assert.equal(helpTopic(["create"], { help: true }), "create");
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
      () => validateInvocation({ positionals: [], values: { url: "x" } }),
      new Error("Unknown option '--url'."),
    );
  });
});
