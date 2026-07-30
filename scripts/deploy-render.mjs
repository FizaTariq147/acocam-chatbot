#!/usr/bin/env node
/**
 * Render deploy helper — Docker Hub path (no GitHub).
 * Usage: node scripts/deploy-render.mjs
 *        node scripts/deploy-render.mjs --user yourdockerhubname
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function run(cmd, args, label) {
  console.log(`\n==> ${label}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function dockerOk() {
  const r = spawnSync('docker', ['info'], { stdio: 'pipe', shell: true });
  return r.status === 0;
}

const userArg = process.argv.find((a) => a.startsWith('--user='));
let dockerUser = userArg ? userArg.slice('--user='.length).trim() : '';

console.log('\n==> ACOCAM chatbot — Render deploy prep\n');

run('npm', ['run', 'check:prod'], '1. Production checklist');

console.log('\n==> 2. Render environment variables (copy to dashboard)\n');
run('node', ['scripts/render-env-export.mjs'], '');

console.log('==> 3. Docker check...\n');
if (!dockerOk()) {
  console.error(`
Docker engine is not running.

  1. Open Docker Desktop and wait for "Engine running"
  2. Run: docker info
  3. Re-run: npm run deploy:render

See docs/RENDER_LIVE_NOW.md
`);
  process.exit(1);
}

if (!dockerUser) {
  dockerUser = await ask('Docker Hub username: ');
}
if (!dockerUser) {
  console.error('Docker Hub username required.');
  process.exit(1);
}

const image = `${dockerUser}/acocam-chatbot-api:latest`;

console.log(`\n==> 4. Building image: ${image}`);
console.log('    (first build may take 5-10 minutes)\n');
run('docker', ['build', '-t', image, '.'], '');

console.log('\n==> 5. Push to Docker Hub (login if prompted)...\n');
run('docker', ['push', image], '');

console.log(`
==> Image pushed successfully!

Next — Render Dashboard (no credit card for Free plan):
  1. https://dashboard.render.com → New + → Web Service
  2. Deploy an existing image from a registry
  3. Image: docker.io/${image}
  4. Instance type: Free
  5. Health check path: /v1/health
  6. Paste env vars from step 2 above (mark _KEY vars as Secret)
  7. Create Web Service

Test after deploy:
  Invoke-RestMethod https://YOUR-SERVICE.onrender.com/v1/health

Full guide: docs/RENDER_LIVE_NOW.md
`);
