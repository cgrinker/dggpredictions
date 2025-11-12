#!/usr/bin/env node

import { spawn } from 'node:child_process';

const defaultSuites = [
  'src/server/controllers/__tests__/operations.controller.test.ts',
  'src/server/controllers/__tests__/markets.controller.test.ts',
  'src/server/controllers/__tests__/config.controller.test.ts',
  'src/server/services/__tests__/markets.service.test.ts',
  'src/server/services/__tests__/operations.service.test.ts',
];

const suitesEnv = process.env.PLAYTEST_REGRESSION_SUITES;
const suites = suitesEnv
  ? suitesEnv
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  : defaultSuites;

if (suites.length === 0) {
  console.error('No test suites specified for regression run.');
  process.exit(1);
}

const extraArgsEnv = process.env.PLAYTEST_VITEST_ARGS;
const extraArgs = extraArgsEnv
  ? extraArgsEnv
      .split(' ')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  : [];

const runner = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['vitest', 'run', ...suites, ...extraArgs];

console.log('Running playtest regression suite with Vitest...');
console.log(`Suites: ${suites.join(', ')}`);
if (extraArgs.length > 0) {
  console.log(`Additional Vitest args: ${extraArgs.join(' ')}`);
}

const child = spawn(runner, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Regression suite terminated by signal: ${signal}`);
    process.exit(1);
    return;
  }

  if (code === 0) {
    console.log('✅ Playtest regression suite completed successfully.');
    process.exit(0);
    return;
  }

  console.error(`❌ Playtest regression suite failed with exit code ${code ?? 'unknown'}.`);
  process.exit(code ?? 1);
});
