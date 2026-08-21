import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateInvocation } from "./validate.js";

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
});
