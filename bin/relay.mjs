#!/usr/bin/env node
import { main } from '../src/relay.mjs';
main(process.argv.slice(2)).catch(error => {
  console.error(`Relay: ${error.message}`);
  process.exitCode = 1;
});
