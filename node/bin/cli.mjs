#!/usr/bin/env node
import { run } from "../src/cli.mjs";
process.exit(await run(process.argv.slice(2)));
