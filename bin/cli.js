#!/usr/bin/env node

const { cli } = require("../dist/cli.js");

try {
  cli();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
}
