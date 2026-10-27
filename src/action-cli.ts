#!/usr/bin/env node
import { runAction } from "./action/run.js";

/** Entry point used by action.yml: `gateseeker-action`. Inputs come from INPUT_* env vars. */
const code = await runAction({
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exitCode = code;
