#!/usr/bin/env node

const { cli } = require("../dist/cli.js");

Promise.resolve(cli()).catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
