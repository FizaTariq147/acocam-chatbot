#!/usr/bin/env node
/**
 * Local quality gate — run before manual testing (no GitHub CI required).
 * Usage: npm run check:local
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(label, cmd, args, cwd = root) {
  console.log(`\n▶ ${label}`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run('Build SDK embed', 'npm', ['run', 'build', '-w', '@agent-platform/sdk-js']);
run('Typecheck + build packages', 'npm', ['run', 'build']);
run('Unit tests', 'npm', ['run', 'test', '-w', '@agent-platform/engines']);

const embed = path.join(root, 'packages/sdk-js/dist/agent-embed.js');
if (!existsSync(embed)) {
  console.error('Missing embed bundle:', embed);
  process.exit(1);
}

console.log('\n✓ Local checks passed');
console.log('Optional: npm run check:acocam-api');
