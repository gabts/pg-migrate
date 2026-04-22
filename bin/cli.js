#!/usr/bin/env node

const { cli } = require("../dist/cli.js");

Promise.resolve(cli())
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
    process.exitCode = 1;
  });
